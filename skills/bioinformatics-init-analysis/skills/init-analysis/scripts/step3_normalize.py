"""Step 3: Normalization — Data-type-aware normalization and scaling."""

import numpy as np
import scanpy as sc
from utils import safe_scale, print_section_header


def normalize_data(adata, data_type, output_dir):
    """Normalize data appropriate for the data type.

    Args:
        adata: AnnData object
        data_type: 'cytof', 'scrnaseq', or 'flow'
        output_dir: Directory for saving figures

    Returns:
        dict: Normalization summary statistics
    """
    print_section_header("Normalization", 3)

    # Store raw values before any transformation
    adata.raw = adata.copy()

    if data_type == 'cytof':
        norm_stats = _normalize_cytof(adata)
    elif data_type == 'scrnaseq':
        norm_stats = _normalize_scrnaseq(adata)
    elif data_type == 'flow':
        norm_stats = _normalize_flow(adata)
    else:
        norm_stats = _normalize_generic(adata)

    # Z-score scaling for dimensionality reduction
    nan_markers = safe_scale(adata, max_value=10)
    norm_stats['nan_markers_after_scale'] = nan_markers
    if nan_markers:
        print(f"  Warning: {len(nan_markers)} constant markers set to 0 after scaling: "
              f"{nan_markers[:5]}{'...' if len(nan_markers) > 5 else ''}")

    print(f"\nPost-normalization data range: [{adata.X.min():.3f}, {adata.X.max():.3f}]")
    print(f"Shape: {adata.shape[0]:,} cells x {adata.shape[1]} features")

    return norm_stats


def _normalize_cytof(adata):
    """CyTOF normalization: verify arcsinh transformation."""
    stats = {'method': 'cytof'}

    data_min = float(np.nanmin(adata.X))
    data_max = float(np.nanmax(adata.X))
    stats['raw_range'] = [data_min, data_max]

    # Check if data is already arcsinh-transformed
    # Arcsinh-transformed CyTOF data typically ranges from ~-1 to ~15
    if data_min >= -2 and data_max <= 20:
        print("  Data appears already arcsinh-transformed (range within [-2, 20]).")
        print(f"  Range: [{data_min:.3f}, {data_max:.3f}]")
        stats['already_transformed'] = True
        stats['transformation'] = 'none (already arcsinh)'
    else:
        # Apply arcsinh transformation with cofactor 5
        print("  Applying arcsinh transformation (cofactor=5)...")
        adata.X = np.arcsinh(adata.X / 5.0)
        stats['already_transformed'] = False
        stats['transformation'] = 'arcsinh(x/5)'
        new_min = float(np.nanmin(adata.X))
        new_max = float(np.nanmax(adata.X))
        print(f"  Post-transform range: [{new_min:.3f}, {new_max:.3f}]")
        stats['transformed_range'] = [new_min, new_max]

    return stats


def _normalize_scrnaseq(adata):
    """scRNA-seq normalization: CPM -> log1p -> HVG selection."""
    stats = {'method': 'scrnaseq'}

    # Library size normalization (counts per million)
    print("  Normalizing total counts (CPM)...")
    sc.pp.normalize_total(adata, target_sum=1e4)

    # Log transformation
    print("  Log1p transformation...")
    sc.pp.log1p(adata)
    stats['transformation'] = 'CPM + log1p'

    # Highly variable gene selection
    n_genes = adata.shape[1]
    if n_genes > 2000:
        print("  Selecting highly variable genes...")
        sc.pp.highly_variable_genes(adata, n_top_genes=min(2000, n_genes),
                                     flavor='seurat_v3' if 'counts' in adata.layers else 'seurat')
        n_hvg = adata.var['highly_variable'].sum()
        stats['n_hvg'] = int(n_hvg)
        print(f"  Selected {n_hvg} highly variable genes out of {n_genes}")

        # Keep all genes but mark HVGs
        stats['hvg_selection'] = True
    else:
        stats['hvg_selection'] = False
        print(f"  Skipping HVG selection ({n_genes} genes, threshold 2000)")

    return stats


def _normalize_flow(adata):
    """Flow cytometry normalization: similar to CyTOF."""
    stats = {'method': 'flow'}

    data_min = float(np.nanmin(adata.X))
    data_max = float(np.nanmax(adata.X))
    stats['raw_range'] = [data_min, data_max]

    # Flow data may need logicle or arcsinh transformation
    if data_max > 1000:
        print("  Applying arcsinh transformation (cofactor=150 for flow data)...")
        adata.X = np.arcsinh(adata.X / 150.0)
        stats['transformation'] = 'arcsinh(x/150)'
    else:
        print("  Data appears already transformed.")
        stats['transformation'] = 'none (already transformed)'

    return stats


def _normalize_generic(adata):
    """Fallback normalization."""
    stats = {'method': 'generic', 'transformation': 'none'}
    print("  No specific normalization applied for unknown data type.")
    print("  Data will be z-score scaled for dimensionality reduction.")
    return stats
