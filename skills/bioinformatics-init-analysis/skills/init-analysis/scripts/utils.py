"""Shared utilities for the bioinformatics init analysis pipeline."""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import os


def mad_outliers(x, threshold=5):
    """Identify outliers using Median Absolute Deviation.

    Args:
        x: 1D array of values
        threshold: Number of MADs from median to flag as outlier

    Returns:
        Boolean array where True = outlier
    """
    med = np.nanmedian(x)
    mad = np.nanmedian(np.abs(x - med))
    if mad == 0:
        return np.zeros(len(x), dtype=bool)
    modified_z = 0.6745 * (x - med) / mad
    return np.abs(modified_z) > threshold


def safe_scale(adata, max_value=10):
    """Z-score scale with NaN safety check.

    After scanpy's sc.pp.scale(), constant features produce NaN.
    This function replaces them with 0.

    Args:
        adata: AnnData object (modified in-place)
        max_value: Clip values beyond this threshold

    Returns:
        List of marker names that had NaN values
    """
    import scanpy as sc
    sc.pp.scale(adata, max_value=max_value)

    nan_mask = np.isnan(adata.X)
    nan_markers = []
    if nan_mask.any():
        var_names = list(adata.var_names)
        nan_markers = [var_names[i] for i in range(adata.shape[1]) if nan_mask[:, i].any()]
        adata.X = np.nan_to_num(adata.X, nan=0.0)

    return nan_markers


def detect_metadata_columns(adata):
    """Auto-detect treatment, time, group, and label columns in obs.

    Returns:
        dict with keys: 'treatment', 'time', 'group', 'label', 'batch'
        Values are column names or None if not detected.
    """
    obs_cols = [c.lower() for c in adata.obs.columns]
    original_cols = list(adata.obs.columns)

    result = {
        'treatment': None,
        'time': None,
        'group': None,
        'label': None,
        'batch': None,
    }

    treatment_keywords = ['treatment', 'condition', 'drug', 'stimulus', 'perturbation', 'inhibitor']
    time_keywords = ['time', 'timepoint', 'time_point', 'hour', 'minute']
    group_keywords = ['group', 'sample', 'patient', 'subject', 'donor', 'cell_line', 'cellline']
    label_keywords = ['label', 'cell_type', 'celltype', 'annotation', 'cluster_label',
                       'classification', 'subtype', 'pam50']
    batch_keywords = ['batch', 'plate', 'experiment', 'run', 'lane', 'source_folder']

    for key, keywords in [
        ('treatment', treatment_keywords),
        ('time', time_keywords),
        ('group', group_keywords),
        ('label', label_keywords),
        ('batch', batch_keywords),
    ]:
        for kw in keywords:
            for i, col_lower in enumerate(obs_cols):
                if kw in col_lower and result[key] is None:
                    result[key] = original_cols[i]
                    break
            if result[key]:
                break

    return result


def get_categorical_columns(adata, max_categories=50):
    """Find categorical columns suitable for coloring plots.

    Returns list of column names with <= max_categories unique values.
    """
    cats = []
    for col in adata.obs.columns:
        if col in ['cellID', 'fileID']:
            continue
        try:
            n_unique = adata.obs[col].nunique()
            if 2 <= n_unique <= max_categories:
                cats.append(col)
        except Exception:
            continue
    return cats


def get_top_variable_markers(adata, n=12):
    """Get the top N most variable markers for visualization.

    Uses variance of the raw (pre-scaled) data if available.
    """
    if adata.raw is not None:
        data = pd.DataFrame(adata.raw.X, columns=adata.raw.var_names)
    else:
        data = pd.DataFrame(adata.X, columns=adata.var_names)

    variances = data.var()
    top = variances.nlargest(min(n, len(variances)))
    return list(top.index)


def save_figure(fig, filepath, dpi=150):
    """Save figure with consistent settings.

    Args:
        fig: matplotlib Figure
        filepath: Output path (will create parent dirs)
        dpi: Resolution
    """
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    fig.savefig(filepath, dpi=dpi, bbox_inches='tight', facecolor='white')
    plt.close(fig)
    print(f"  Saved: {filepath}")


def print_section_header(title, step_num=None):
    """Print a formatted section header for console output."""
    if step_num:
        header = f"Step {step_num}: {title}"
    else:
        header = title
    print(f"\n{'='*60}")
    print(f"  {header}")
    print(f"{'='*60}\n")
