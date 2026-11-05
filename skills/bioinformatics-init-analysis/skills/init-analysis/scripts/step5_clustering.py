"""Step 5: Clustering — Leiden clustering with evaluation metrics."""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import scanpy as sc
import seaborn as sns
from utils import save_figure, get_categorical_columns, detect_metadata_columns, print_section_header


def run_clustering(adata, data_type, output_dir):
    """Run Leiden clustering at multiple resolutions with evaluation.

    Args:
        adata: AnnData object (with neighbors computed)
        data_type: 'cytof', 'scrnaseq', or 'flow'
        output_dir: Directory for saving figures

    Returns:
        dict: Clustering summary statistics
    """
    print_section_header("Clustering", 5)

    stats = {}

    # Leiden clustering at two resolutions
    resolutions = [0.5, 1.0]
    for res in resolutions:
        key = f'leiden_{res}'
        print(f"Running Leiden clustering (resolution={res})...")
        sc.tl.leiden(adata, resolution=res, key_added=key)
        n_clusters = adata.obs[key].nunique()
        stats[f'n_clusters_res{res}'] = n_clusters
        print(f"  Found {n_clusters} clusters at resolution {res}")

    # Use resolution 1.0 as primary
    adata.obs['leiden'] = adata.obs['leiden_1.0']
    stats['primary_resolution'] = 1.0
    stats['n_clusters'] = stats['n_clusters_res1.0']

    # UMAP with clusters
    _plot_cluster_umap(adata, resolutions, output_dir)

    # Evaluate against reference labels if available
    meta = detect_metadata_columns(adata)
    label_col = meta.get('label') or meta.get('group')

    if label_col and adata.obs[label_col].nunique() > 1:
        eval_stats = _evaluate_clustering(adata, label_col)
        stats.update(eval_stats)

    # Cluster composition analysis
    cat_cols = get_categorical_columns(adata)
    if cat_cols:
        _plot_cluster_composition(adata, cat_cols[:4], output_dir)

    # Cluster sizes
    cluster_sizes = adata.obs['leiden'].value_counts().to_dict()
    stats['cluster_sizes'] = {str(k): int(v) for k, v in cluster_sizes.items()}

    return stats


def _plot_cluster_umap(adata, resolutions, output_dir):
    """UMAP showing clusters at different resolutions."""
    n_plots = len(resolutions)
    fig, axes = plt.subplots(1, n_plots, figsize=(7 * n_plots, 5))
    if n_plots == 1:
        axes = [axes]

    for i, res in enumerate(resolutions):
        key = f'leiden_{res}'
        sc.pl.umap(adata, color=key, ax=axes[i], show=False,
                    title=f'Leiden (res={res}, n={adata.obs[key].nunique()})',
                    frameon=True, legend_loc='right margin', legend_fontsize=6)

    plt.tight_layout()
    save_figure(fig, f'{output_dir}/figures/clustering_umap.png')


def _evaluate_clustering(adata, label_col):
    """Evaluate clustering quality against reference labels."""
    stats = {}

    try:
        from sklearn.metrics import adjusted_rand_score, normalized_mutual_info_score, silhouette_score

        labels_true = adata.obs[label_col].astype(str).values
        labels_pred = adata.obs['leiden'].values

        ari = adjusted_rand_score(labels_true, labels_pred)
        nmi = normalized_mutual_info_score(labels_true, labels_pred)
        stats['ARI'] = float(round(ari, 4))
        stats['NMI'] = float(round(nmi, 4))

        print(f"\nClustering evaluation vs '{label_col}':")
        print(f"  ARI (Adjusted Rand Index): {ari:.4f}")
        print(f"  NMI (Normalized Mutual Info): {nmi:.4f}")

        # Silhouette score on UMAP embedding (sample if large)
        if adata.shape[0] > 10000:
            idx = np.random.choice(adata.shape[0], 10000, replace=False)
            embedding = adata.obsm['X_umap'][idx]
            labels = labels_pred[idx]
        else:
            embedding = adata.obsm['X_umap']
            labels = labels_pred

        sil = silhouette_score(embedding, labels)
        stats['silhouette_score'] = float(round(sil, 4))
        print(f"  Silhouette Score: {sil:.4f}")

    except ImportError:
        print("  sklearn not available, skipping evaluation metrics")

    return stats


def _plot_cluster_composition(adata, cat_cols, output_dir):
    """Stacked bar charts showing cluster composition by metadata."""
    n_plots = min(4, len(cat_cols))
    fig, axes = plt.subplots(1, n_plots, figsize=(6 * n_plots, 5))
    if n_plots == 1:
        axes = [axes]

    for i, col in enumerate(cat_cols[:n_plots]):
        ax = axes[i]
        ct = pd.crosstab(adata.obs['leiden'], adata.obs[col], normalize='index')

        ct.plot(kind='bar', stacked=True, ax=ax, legend=True, width=0.8)
        ax.set_title(f'Cluster composition by {col}', fontsize=10)
        ax.set_xlabel('Leiden Cluster')
        ax.set_ylabel('Proportion')
        ax.legend(fontsize=5, bbox_to_anchor=(1.05, 1), loc='upper left')
        ax.tick_params(axis='x', rotation=45, labelsize=7)

    plt.tight_layout()
    save_figure(fig, f'{output_dir}/figures/cluster_composition.png')
