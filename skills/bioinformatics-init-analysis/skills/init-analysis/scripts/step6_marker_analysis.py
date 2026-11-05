"""Step 6: Marker Analysis — Differential expression, correlation, treatment response."""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import scanpy as sc
import seaborn as sns
from scipy import stats as scipy_stats
from utils import (save_figure, detect_metadata_columns, get_top_variable_markers,
                   print_section_header)


def run_marker_analysis(adata, data_type, output_dir):
    """Run marker/gene analysis including DE, correlation, and treatment response.

    Args:
        adata: AnnData object (clustered)
        data_type: 'cytof', 'scrnaseq', or 'flow'
        output_dir: Directory for saving figures

    Returns:
        dict: Marker analysis summary
    """
    print_section_header("Marker Analysis", 6)

    stats = {}
    meta = detect_metadata_columns(adata)

    # 1. Differential expression per cluster
    de_stats = _differential_expression(adata, data_type, output_dir)
    stats.update(de_stats)

    # 2. Marker correlation heatmap
    _plot_correlation_heatmap(adata, output_dir)

    # 3. Treatment response analysis (if treatment metadata exists)
    if meta.get('treatment') and adata.obs[meta['treatment']].nunique() > 1:
        treat_stats = _treatment_response(adata, meta['treatment'], output_dir)
        stats['treatment_analysis'] = treat_stats

    # 4. Time-course analysis (if time metadata exists)
    if meta.get('time'):
        time_stats = _time_course(adata, meta['time'], output_dir)
        stats['time_course'] = time_stats

    return stats


def _differential_expression(adata, data_type, output_dir):
    """Wilcoxon rank-sum DE per cluster."""
    stats = {}

    print("Running differential expression (Wilcoxon rank-sum)...")

    # Use raw data for DE if available
    use_raw = adata.raw is not None
    sc.tl.rank_genes_groups(adata, groupby='leiden', method='wilcoxon',
                            use_raw=use_raw)

    # Extract top markers per cluster
    n_clusters = adata.obs['leiden'].nunique()
    top_markers = {}
    for cluster in sorted(adata.obs['leiden'].unique(), key=lambda x: int(x)):
        try:
            df = sc.get.rank_genes_groups_df(adata, group=str(cluster))
            top = df.head(10)
            top_markers[str(cluster)] = list(top['names'].values)
            sig_count = (top['pvals_adj'] < 0.05).sum()
            print(f"  Cluster {cluster}: {sig_count} significant markers (top: {', '.join(top['names'][:3])})")
        except Exception:
            continue

    stats['top_markers_per_cluster'] = top_markers
    stats['n_clusters_analyzed'] = n_clusters

    # Dotplot of top markers
    _plot_de_dotplot(adata, output_dir)

    return stats


def _plot_de_dotplot(adata, output_dir):
    """Dotplot of top DE markers per cluster."""
    try:
        fig, ax = plt.subplots(figsize=(14, max(6, adata.obs['leiden'].nunique() * 0.5)))
        sc.pl.rank_genes_groups_dotplot(adata, n_genes=5, show=False, ax=ax)
        plt.tight_layout()
        save_figure(fig, f'{output_dir}/figures/marker_dotplot.png')
    except Exception as e:
        print(f"  Could not generate dotplot: {e}")

        # Fallback: heatmap of top markers
        try:
            top_genes = []
            for cluster in sorted(adata.obs['leiden'].unique(), key=lambda x: int(x)):
                df = sc.get.rank_genes_groups_df(adata, group=str(cluster))
                top_genes.extend(df.head(3)['names'].tolist())
            top_genes = list(dict.fromkeys(top_genes))  # deduplicate, keep order

            fig, ax = plt.subplots(figsize=(max(10, len(top_genes) * 0.4), 6))
            sc.pl.heatmap(adata, var_names=top_genes[:30], groupby='leiden',
                          show=False, ax=ax, cmap='RdBu_r')
            plt.tight_layout()
            save_figure(fig, f'{output_dir}/figures/marker_heatmap.png')
        except Exception:
            print("  Could not generate fallback heatmap either.")


def _plot_correlation_heatmap(adata, output_dir):
    """Spearman correlation heatmap of markers."""
    print("Computing marker correlations...")

    # Use raw values for correlation
    if adata.raw is not None:
        data = pd.DataFrame(adata.raw.X, columns=adata.raw.var_names)
    else:
        data = pd.DataFrame(adata.X, columns=adata.var_names)

    # Limit to top variable markers if too many
    if data.shape[1] > 50:
        top = get_top_variable_markers(adata, n=40)
        data = data[top]

    corr = data.corr(method='spearman')

    fig, ax = plt.subplots(figsize=(max(10, len(corr) * 0.35),
                                     max(8, len(corr) * 0.3)))
    mask = np.triu(np.ones_like(corr, dtype=bool), k=1)
    sns.heatmap(corr, mask=mask, cmap='RdBu_r', center=0, vmin=-1, vmax=1,
                square=True, linewidths=0.1, annot=False,
                xticklabels=True, yticklabels=True, ax=ax)
    ax.set_title('Marker Spearman Correlation', fontsize=12)
    plt.xticks(fontsize=6, rotation=90)
    plt.yticks(fontsize=6)
    plt.tight_layout()
    save_figure(fig, f'{output_dir}/figures/marker_correlation.png')


def _treatment_response(adata, treatment_col, output_dir):
    """Analyze marker changes across treatments."""
    print(f"\nTreatment response analysis (column: {treatment_col})...")
    stats = {'treatment_column': treatment_col}

    treatments = adata.obs[treatment_col].unique()
    stats['n_treatments'] = len(treatments)
    print(f"  Found {len(treatments)} treatments: {list(treatments)[:10]}")

    # Use raw values
    if adata.raw is not None:
        expr_data = pd.DataFrame(adata.raw.X, columns=adata.raw.var_names)
    else:
        expr_data = pd.DataFrame(adata.X, columns=adata.var_names)

    expr_data[treatment_col] = adata.obs[treatment_col].values

    # Median expression per treatment
    medians = expr_data.groupby(treatment_col).median()

    # Treatment effect heatmap
    fig, ax = plt.subplots(figsize=(max(14, len(medians) * 0.5), 10))
    sns.heatmap(medians.T, cmap='RdBu_r', center=medians.values.mean(),
                xticklabels=True, yticklabels=True, linewidths=0.1, ax=ax)
    ax.set_title(f'Median marker expression per {treatment_col}', fontsize=12)
    plt.xticks(fontsize=7, rotation=90)
    plt.yticks(fontsize=6)
    plt.tight_layout()
    save_figure(fig, f'{output_dir}/figures/treatment_heatmap.png')

    # Top variable markers boxplots across treatments
    top_markers = get_top_variable_markers(adata, n=6)
    if top_markers:
        n_markers = len(top_markers)
        n_cols = min(3, n_markers)
        n_rows = (n_markers + n_cols - 1) // n_cols

        fig, axes = plt.subplots(n_rows, n_cols, figsize=(5 * n_cols, 4 * n_rows))
        if n_markers == 1:
            axes = np.array([axes])
        axes_flat = axes.flatten()

        for i, marker in enumerate(top_markers):
            ax = axes_flat[i]
            plot_data = expr_data[[marker, treatment_col]].copy()
            plot_data.boxplot(column=marker, by=treatment_col, ax=ax)
            ax.set_title(marker, fontsize=10)
            ax.set_xlabel('')
            ax.tick_params(axis='x', rotation=45, labelsize=6)

        for j in range(n_markers, len(axes_flat)):
            axes_flat[j].set_visible(False)

        fig.suptitle('Top markers across treatments', fontsize=14)
        plt.tight_layout()
        save_figure(fig, f'{output_dir}/figures/treatment_boxplots.png')

    return stats


def _time_course(adata, time_col, output_dir):
    """Analyze marker dynamics over time."""
    print(f"\nTime-course analysis (column: {time_col})...")
    stats = {'time_column': time_col}

    # Convert time to numeric if possible
    time_vals = pd.to_numeric(adata.obs[time_col], errors='coerce')
    valid_mask = ~time_vals.isna()

    if valid_mask.sum() < 10:
        print("  Not enough valid numeric time points, skipping.")
        return stats

    if adata.raw is not None:
        expr_data = pd.DataFrame(adata.raw.X[valid_mask], columns=adata.raw.var_names)
    else:
        expr_data = pd.DataFrame(adata.X[valid_mask], columns=adata.var_names)

    expr_data['time'] = time_vals[valid_mask].values

    # Median per time point
    time_medians = expr_data.groupby('time').median()
    stats['n_timepoints'] = len(time_medians)

    # Line plots of top markers over time
    top_markers = get_top_variable_markers(adata, n=8)
    valid_markers = [m for m in top_markers if m in time_medians.columns]

    if valid_markers:
        fig, ax = plt.subplots(figsize=(10, 6))
        for marker in valid_markers:
            ax.plot(time_medians.index, time_medians[marker], 'o-',
                    label=marker, markersize=4, linewidth=1.5)
        ax.set_xlabel('Time')
        ax.set_ylabel('Median Expression')
        ax.set_title('Marker dynamics over time')
        ax.legend(fontsize=7, bbox_to_anchor=(1.05, 1), loc='upper left')
        plt.tight_layout()
        save_figure(fig, f'{output_dir}/figures/time_course.png')

    return stats
