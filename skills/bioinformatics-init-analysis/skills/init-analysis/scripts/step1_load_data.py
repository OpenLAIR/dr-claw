"""Step 1: Data Loading — Load various single-cell data formats into AnnData."""

import os
import numpy as np
import pandas as pd
import scanpy as sc
import anndata as ad
from utils import print_section_header


def load_data(input_path, data_type='auto', subsample=500, random_seed=42):
    """Load single-cell data into AnnData with optional subsampling.

    Args:
        input_path: Path to file or directory
        data_type: 'cytof', 'scrnaseq', 'flow', or 'auto'
        subsample: Max cells per group (0 = no subsampling)
        random_seed: Random seed for reproducibility

    Returns:
        tuple: (adata, data_type_detected, load_stats)
    """
    print_section_header("Data Loading", 1)
    np.random.seed(random_seed)

    if data_type == 'auto':
        from detect_data_type import detect_data_type
        data_type = detect_data_type(input_path)
        print(f"Auto-detected data type: {data_type}")

    if data_type == 'cytof':
        adata, stats = _load_cytof(input_path, subsample, random_seed)
    elif data_type == 'scrnaseq':
        adata, stats = _load_scrnaseq(input_path, subsample, random_seed)
    elif data_type == 'flow':
        adata, stats = _load_flow(input_path, subsample, random_seed)
    else:
        raise ValueError(f"Unknown data type: {data_type}. Use --data-type to specify.")

    adata.uns['data_type'] = data_type
    adata.uns['load_stats'] = stats

    print(f"\nLoaded AnnData: {adata.shape[0]:,} cells x {adata.shape[1]} features")
    print(f"Observation columns: {list(adata.obs.columns)}")
    if stats.get('original_cells'):
        print(f"Original cells: {stats['original_cells']:,} (subsampled to {adata.shape[0]:,})")

    return adata, data_type, stats


def _load_cytof(input_path, subsample, random_seed):
    """Load CyTOF data from CSV files."""
    stats = {'original_cells': 0, 'n_groups': 0, 'group_counts': {}}

    if os.path.isdir(input_path):
        # Directory of per-cell-line CSV files (or subdirectories)
        all_dfs = []
        csv_dirs = []

        # Check for subdirectories (like the DREAM challenge structure)
        for item in sorted(os.listdir(input_path)):
            subpath = os.path.join(input_path, item)
            if os.path.isdir(subpath):
                csv_dirs.append((item, subpath))

        if not csv_dirs:
            csv_dirs = [('', input_path)]

        for folder_name, folder_path in csv_dirs:
            for fname in sorted(os.listdir(folder_path)):
                if not fname.endswith('.csv'):
                    continue
                df = pd.read_csv(os.path.join(folder_path, fname))
                group_name = fname.replace('.csv', '')
                stats['group_counts'][group_name] = len(df)
                stats['original_cells'] += len(df)
                stats['n_groups'] += 1

                if subsample > 0 and len(df) > subsample:
                    df = df.sample(n=subsample, random_state=random_seed)

                if folder_name:
                    df['source_folder'] = folder_name
                all_dfs.append(df)

        combined = pd.concat(all_dfs, ignore_index=True)
    else:
        # Single CSV file
        combined = pd.read_csv(input_path)
        stats['original_cells'] = len(combined)
        stats['n_groups'] = 1

        if subsample > 0 and 'cell_line' in combined.columns:
            groups = []
            for name, group in combined.groupby('cell_line'):
                stats['group_counts'][name] = len(group)
                if len(group) > subsample:
                    group = group.sample(n=subsample, random_state=random_seed)
                groups.append(group)
            combined = pd.concat(groups, ignore_index=True)

    # Separate metadata from marker columns
    meta_candidates = ['treatment', 'cell_line', 'time', 'cellID', 'fileID',
                        'source_folder', 'sample', 'condition', 'batch', 'plate']
    meta_cols = [c for c in combined.columns if c in meta_candidates]
    marker_cols = [c for c in combined.columns if c not in meta_candidates]

    adata = ad.AnnData(
        X=combined[marker_cols].values.astype(np.float32),
        obs=combined[meta_cols].reset_index(drop=True).astype(str),
        var=pd.DataFrame(index=marker_cols)
    )

    return adata, stats


def _load_scrnaseq(input_path, subsample, random_seed):
    """Load scRNA-seq data from h5ad, h5, or mtx."""
    stats = {'original_cells': 0, 'n_groups': 0, 'group_counts': {}}

    ext = os.path.splitext(input_path)[1].lower()

    if ext == '.h5ad':
        adata = sc.read_h5ad(input_path)
    elif ext == '.h5':
        adata = sc.read_10x_h5(input_path)
    elif ext == '.mtx':
        # Look for barcodes and features files
        data_dir = os.path.dirname(input_path)
        adata = sc.read_10x_mtx(data_dir)
    else:
        raise ValueError(f"Unsupported scRNA-seq format: {ext}")

    stats['original_cells'] = adata.shape[0]
    adata.var_names_make_unique()

    # Subsample
    if subsample > 0 and adata.shape[0] > subsample * 10:
        # For scRNA-seq, subsample globally if no group info
        n_total = min(subsample * 10, adata.shape[0])
        sc.pp.subsample(adata, n_obs=n_total, random_state=random_seed)

    return adata, stats


def _load_flow(input_path, subsample, random_seed):
    """Load flow cytometry data from FCS or CSV."""
    stats = {'original_cells': 0, 'n_groups': 0, 'group_counts': {}}

    ext = os.path.splitext(input_path)[1].lower()

    if ext == '.fcs':
        try:
            import fcsparser
            meta, data = fcsparser.parse(input_path)
            adata = ad.AnnData(X=data.values.astype(np.float32),
                               var=pd.DataFrame(index=data.columns))
        except ImportError:
            raise ImportError("Install fcsparser to read FCS files: pip install fcsparser")
    elif ext == '.csv':
        df = pd.read_csv(input_path)
        meta_candidates = ['sample', 'patient', 'condition', 'treatment', 'time', 'batch']
        meta_cols = [c for c in df.columns if c.lower() in meta_candidates]
        marker_cols = [c for c in df.columns if c not in meta_cols]
        adata = ad.AnnData(
            X=df[marker_cols].values.astype(np.float32),
            obs=df[meta_cols].reset_index(drop=True).astype(str),
            var=pd.DataFrame(index=marker_cols)
        )
    else:
        raise ValueError(f"Unsupported flow cytometry format: {ext}")

    stats['original_cells'] = adata.shape[0]

    if subsample > 0 and adata.shape[0] > subsample:
        sc.pp.subsample(adata, n_obs=subsample, random_state=random_seed)

    return adata, stats
