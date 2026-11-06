"""Step 2: Quality Control — Data-type-aware QC with visualizations."""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import scanpy as sc
import seaborn as sns
from utils import mad_outliers, save_figure, print_section_header


def run_qc(adata, data_type, output_dir):
    """Run quality control appropriate for the data type.

    Args:
        adata: AnnData object
        data_type: 'cytof', 'scrnaseq', or 'flow'
        output_dir: Directory for saving figures

    Returns:
        dict: QC summary statistics
    """
    print_section_header("Quality Control", 2)

    qc_stats = {
        'n_cells_before': adata.shape[0],
        'n_features': adata.shape[1],
        'missing_values': int(np.isnan(adata.X).sum()),
        'data_range': [float(np.nanmin(adata.X)), float(np.nanmax(adata.X))],
    }

    print(f"Cells: {qc_stats['n_cells_before']:,}")
    print(f"Features: {qc_stats['n_features']}")
    print(f"Missing values: {qc_stats['missing_values']}")
    print(f"Data range: [{qc_stats['data_range'][0]:.3f}, {qc_stats['data_range'][1]:.3f}]")

    # Universal: marker distribution violin plots
    _plot_marker_distributions(adata, output_dir)

    if data_type == 'cytof':
        qc_stats.update(_qc_cytof(adata, output_dir))
    elif data_type == 'scrnaseq':
        qc_stats.update(_qc_scrnaseq(adata, output_dir))
    elif data_type == 'flow':
        qc_stats.update(_qc_cytof(adata, output_dir))  # Similar to CyTOF

    return qc_stats


def _plot_marker_distributions(adata, output_dir):
    """Violin plots for all markers."""
    n_markers = adata.shape[1]
    n_cols = min(10, n_markers)
    n_rows = (n_markers + n_cols - 1) // n_cols

    fig, axes = plt.subplots(n_rows, n_cols, figsize=(2.5 * n_cols, 3 * n_rows))
    axes = axes.flatten() if n_markers > 1 else [axes]

    for i in range(n_markers):
        vals = adata.X[:, i]
        vals = vals[~np.isnan(vals)]
        if len(vals) > 0:
            axes[i].violinplot(vals, showmedians=True)
        axes[i].set_title(adata.var_names[i], fontsize=7)
        axes[i].tick_params(labelsize=5)

    for j in range(n_markers, len(axes)):
        axes[j].set_visible(False)

    fig.suptitle('Feature signal distributions', fontsize=12, y=1.02)
    plt.tight_layout()
    save_figure(fig, f'{output_dir}/figures/qc_marker_distributions.png')


def _qc_cytof(adata, output_dir):
    """CyTOF-specific QC: MAD outliers + batch effects heatmap."""
    stats = {}

    # MAD-based outlier detection per marker
    outlier_counts = {}
    for i, marker in enumerate(adata.var_names):
        vals = adata.X[:, i]
        outliers = mad_outliers(vals, threshold=5)
        outlier_counts[marker] = int(outliers.sum())

    stats['outlier_counts_per_marker'] = outlier_counts

    # Flag cells that are outliers in multiple markers
    outlier_mask = np.zeros(adata.shape[0], dtype=int)
    for i in range(adata.shape[1]):
        outlier_mask += mad_outliers(adata.X[:, i]).astype(int)

    adata.obs['n_outlier_markers'] = outlier_mask
    stats['cells_5plus_outlier_markers'] = int((outlier_mask >= 5).sum())
    stats['cells_10plus_outlier_markers'] = int((outlier_mask >= 10).sum())

    print(f"Cells with 5+ outlier markers: {stats['cells_5plus_outlier_markers']} "
          f"({stats['cells_5plus_outlier_markers'] / adata.shape[0] * 100:.1f}%)")

    # Batch effects heatmap (median per group)
    group_col = None
    for col in ['cell_line', 'sample', 'patient', 'batch']:
        if col in adata.obs.columns:
            group_col = col
            break

    if group_col and adata.obs[group_col].nunique() > 1:
        median_df = pd.DataFrame(adata.X, columns=list(adata.var_names))
        median_df[group_col] = adata.obs[group_col].values
        median_per_group = median_df.groupby(group_col).median()

        fig, ax = plt.subplots(figsize=(max(14, len(median_per_group) * 0.3), 10))
        sns.heatmap(median_per_group.T, cmap='RdBu_r', center=0,
                    xticklabels=True, yticklabels=True, linewidths=0.1, ax=ax)
        ax.set_title(f'Median marker expression per {group_col}', fontsize=12)
        plt.xticks(fontsize=6, rotation=90)
        plt.yticks(fontsize=7)
        plt.tight_layout()
        save_figure(fig, f'{output_dir}/figures/qc_batch_effects_heatmap.png')

    return stats


def _qc_scrnaseq(adata, output_dir):
    """scRNA-seq-specific QC: mito%, genes/cell, counts/cell."""
    stats = {}

    # Calculate QC metrics
    adata.var['mt'] = adata.var_names.str.startswith(('MT-', 'mt-'))
    adata.var['ribo'] = adata.var_names.str.startswith(('RPL', 'RPS', 'Rpl', 'Rps'))
    sc.pp.calculate_qc_metrics(adata, qc_vars=['mt', 'ribo'],
                                percent_top=None, log1p=False, inplace=True)

    stats['median_counts'] = float(adata.obs['total_counts'].median())
    stats['median_genes'] = float(adata.obs['n_genes_by_counts'].median())
    stats['median_mito_pct'] = float(adata.obs['pct_counts_mt'].median())

    print(f"Median counts/cell: {stats['median_counts']:.0f}")
    print(f"Median genes/cell: {stats['median_genes']:.0f}")
    print(f"Median mito %: {stats['median_mito_pct']:.1f}%")

    # QC distribution plots
    fig, axes = plt.subplots(2, 3, figsize=(15, 8))

    # Histograms
    axes[0, 0].hist(adata.obs['total_counts'], bins=50, color='steelblue')
    axes[0, 0].set_title('Total counts per cell')
    axes[0, 0].set_xlabel('Counts')

    axes[0, 1].hist(adata.obs['n_genes_by_counts'], bins=50, color='steelblue')
    axes[0, 1].set_title('Genes detected per cell')
    axes[0, 1].set_xlabel('N genes')

    axes[0, 2].hist(adata.obs['pct_counts_mt'], bins=50, color='salmon')
    axes[0, 2].set_title('Mitochondrial %')
    axes[0, 2].set_xlabel('MT %')

    # Scatter plots
    axes[1, 0].scatter(adata.obs['total_counts'], adata.obs['n_genes_by_counts'],
                        s=1, alpha=0.3)
    axes[1, 0].set_xlabel('Total counts')
    axes[1, 0].set_ylabel('N genes')

    axes[1, 1].scatter(adata.obs['total_counts'], adata.obs['pct_counts_mt'],
                        s=1, alpha=0.3, c='salmon')
    axes[1, 1].set_xlabel('Total counts')
    axes[1, 1].set_ylabel('MT %')

    axes[1, 2].scatter(adata.obs['n_genes_by_counts'], adata.obs['pct_counts_mt'],
                        s=1, alpha=0.3, c='salmon')
    axes[1, 2].set_xlabel('N genes')
    axes[1, 2].set_ylabel('MT %')

    fig.suptitle('scRNA-seq Quality Control Metrics', fontsize=14)
    plt.tight_layout()
    save_figure(fig, f'{output_dir}/figures/qc_scrnaseq_metrics.png')

    return stats
