"""Step 4: Dimensionality Reduction — PCA + UMAP with visualizations."""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import scanpy as sc
from utils import save_figure, get_categorical_columns, get_top_variable_markers, print_section_header


def run_dim_reduction(adata, data_type, output_dir):
    """Run PCA and UMAP with comprehensive visualizations.

    Args:
        adata: AnnData object (normalized and scaled)
        data_type: 'cytof', 'scrnaseq', or 'flow'
        output_dir: Directory for saving figures

    Returns:
        dict: Dimensionality reduction summary
    """
    print_section_header("Dimensionality Reduction", 4)

    stats = {}

    # --- PCA ---
    n_components = min(50, adata.shape[1] - 1, adata.shape[0] - 1)
    print(f"Running PCA with {n_components} components...")

    # For scRNA-seq with HVGs, use only HVGs for PCA
    use_hvg = (data_type == 'scrnaseq' and 'highly_variable' in adata.var.columns
               and adata.var['highly_variable'].sum() > 10)

    sc.tl.pca(adata, n_comps=n_components, use_highly_variable=use_hvg)

    variance_ratio = adata.uns['pca']['variance_ratio']
    cumulative_var = np.cumsum(variance_ratio)
    n_pcs_90 = int(np.searchsorted(cumulative_var, 0.9) + 1)
    stats['n_pcs_90pct_var'] = n_pcs_90
    stats['variance_explained_pc1'] = float(variance_ratio[0])

    print(f"  PC1 explains {variance_ratio[0]*100:.1f}% of variance")
    print(f"  {n_pcs_90} PCs needed for 90% cumulative variance")

    # Scree plot
    _plot_scree(variance_ratio, cumulative_var, output_dir)

    # PCA loadings
    _plot_pca_loadings(adata, output_dir)

    # --- UMAP ---
    n_pcs_umap = min(n_pcs_90, 30)
    print(f"\nComputing neighbors (n_pcs={n_pcs_umap})...")
    sc.pp.neighbors(adata, n_pcs=n_pcs_umap)

    print("Computing UMAP...")
    sc.tl.umap(adata)

    # UMAP colored by metadata
    cat_cols = get_categorical_columns(adata)
    if cat_cols:
        _plot_umap_metadata(adata, cat_cols, output_dir)
        stats['umap_color_columns'] = cat_cols

    # UMAP colored by top variable markers
    top_markers = get_top_variable_markers(adata, n=12)
    if top_markers:
        _plot_umap_markers(adata, top_markers, output_dir)
        stats['top_variable_markers'] = top_markers

    return stats


def _plot_scree(variance_ratio, cumulative_var, output_dir):
    """Scree plot with cumulative variance."""
    n_show = min(30, len(variance_ratio))

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))

    ax1.bar(range(1, n_show + 1), variance_ratio[:n_show] * 100, color='steelblue')
    ax1.set_xlabel('Principal Component')
    ax1.set_ylabel('Variance Explained (%)')
    ax1.set_title('Scree Plot')

    ax2.plot(range(1, n_show + 1), cumulative_var[:n_show] * 100,
             'o-', color='steelblue', markersize=4)
    ax2.axhline(y=90, color='red', linestyle='--', alpha=0.7, label='90%')
    ax2.set_xlabel('Number of PCs')
    ax2.set_ylabel('Cumulative Variance (%)')
    ax2.set_title('Cumulative Variance')
    ax2.legend()

    plt.tight_layout()
    save_figure(fig, f'{output_dir}/figures/pca_scree.png')


def _plot_pca_loadings(adata, output_dir):
    """Plot PCA loadings for top PCs."""
    loadings = adata.varm['PCs']
    var_names = list(adata.var_names)
    n_pcs = min(4, loadings.shape[1])
    n_top = min(15, len(var_names))

    fig, axes = plt.subplots(1, n_pcs, figsize=(5 * n_pcs, 6))
    if n_pcs == 1:
        axes = [axes]

    for pc_idx in range(n_pcs):
        ax = axes[pc_idx]
        pc_loadings = loadings[:, pc_idx]
        top_idx = np.argsort(np.abs(pc_loadings))[-n_top:][::-1]

        names = [var_names[i] for i in top_idx]
        values = pc_loadings[top_idx]
        colors = ['salmon' if v < 0 else 'steelblue' for v in values]

        ax.barh(range(len(names)), values, color=colors)
        ax.set_yticks(range(len(names)))
        ax.set_yticklabels(names, fontsize=7)
        ax.set_title(f'PC{pc_idx + 1} Loadings', fontsize=10)
        ax.invert_yaxis()

    plt.tight_layout()
    save_figure(fig, f'{output_dir}/figures/pca_loadings.png')


def _plot_umap_metadata(adata, cat_cols, output_dir):
    """UMAP colored by categorical metadata columns."""
    n_plots = min(6, len(cat_cols))
    cols_to_plot = cat_cols[:n_plots]

    n_cols = min(3, n_plots)
    n_rows = (n_plots + n_cols - 1) // n_cols

    fig, axes = plt.subplots(n_rows, n_cols, figsize=(6 * n_cols, 5 * n_rows))
    if n_plots == 1:
        axes = np.array([axes])
    axes = axes.flatten()

    for i, col in enumerate(cols_to_plot):
        sc.pl.umap(adata, color=col, ax=axes[i], show=False,
                    title=col, frameon=True, legend_loc='right margin',
                    legend_fontsize=6)

    for j in range(n_plots, len(axes)):
        axes[j].set_visible(False)

    fig.suptitle('UMAP colored by metadata', fontsize=14, y=1.02)
    plt.tight_layout()
    save_figure(fig, f'{output_dir}/figures/umap_metadata.png')


def _plot_umap_markers(adata, markers, output_dir):
    """UMAP colored by marker expression."""
    # Use raw values for coloring if available
    valid_markers = [m for m in markers if m in adata.var_names]
    if not valid_markers:
        return

    n_markers = min(12, len(valid_markers))
    markers_to_plot = valid_markers[:n_markers]

    n_cols = min(4, n_markers)
    n_rows = (n_markers + n_cols - 1) // n_cols

    fig, axes = plt.subplots(n_rows, n_cols, figsize=(5 * n_cols, 4 * n_rows))
    if n_markers == 1:
        axes = np.array([axes])
    axes = axes.flatten()

    for i, marker in enumerate(markers_to_plot):
        sc.pl.umap(adata, color=marker, ax=axes[i], show=False,
                    title=marker, frameon=True, cmap='viridis',
                    use_raw=True if adata.raw is not None else False)

    for j in range(n_markers, len(axes)):
        axes[j].set_visible(False)

    fig.suptitle('UMAP colored by marker expression', fontsize=14, y=1.02)
    plt.tight_layout()
    save_figure(fig, f'{output_dir}/figures/umap_markers.png')
