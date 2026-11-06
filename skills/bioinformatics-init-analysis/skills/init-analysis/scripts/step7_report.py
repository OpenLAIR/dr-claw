"""Step 7: Report Generation — HTML report with clinical or technical style."""

import os
import json
import base64
import glob
from datetime import datetime
from utils import print_section_header


def generate_report(adata, data_type, output_dir, all_stats, report_style='clinical'):
    """Generate an HTML report with embedded figures.

    Args:
        adata: AnnData object (fully processed)
        data_type: 'cytof', 'scrnaseq', or 'flow'
        output_dir: Directory containing figures
        all_stats: Dict of stats from all pipeline steps
        report_style: 'clinical' or 'technical'

    Returns:
        str: Path to generated report
    """
    print_section_header("Report Generation", 7)

    report_path = os.path.join(output_dir, 'report.html')

    # Collect all figures
    figures_dir = os.path.join(output_dir, 'figures')
    figure_files = sorted(glob.glob(os.path.join(figures_dir, '*.png')))

    # Build report sections
    sections = []

    # Title and overview
    sections.append(_section_overview(adata, data_type, all_stats))

    # QC section
    sections.append(_section_qc(data_type, all_stats.get('qc', {}),
                                 figure_files, report_style))

    # Normalization section
    sections.append(_section_normalization(all_stats.get('normalization', {}),
                                           report_style))

    # Dimensionality reduction
    sections.append(_section_dim_reduction(all_stats.get('dim_reduction', {}),
                                           figure_files, report_style))

    # Clustering
    sections.append(_section_clustering(all_stats.get('clustering', {}),
                                        figure_files, report_style))

    # Marker analysis
    sections.append(_section_markers(all_stats.get('markers', {}),
                                     figure_files, report_style))

    # Save summary JSON
    summary_path = os.path.join(output_dir, 'analysis_summary.json')
    _save_summary_json(all_stats, summary_path)

    # Assemble HTML
    html = _build_html(sections, figure_files, data_type, report_style)

    with open(report_path, 'w') as f:
        f.write(html)

    print(f"\nReport saved: {report_path}")
    print(f"Summary JSON: {summary_path}")
    print(f"Figures: {len(figure_files)} plots in {figures_dir}/")

    return report_path


def _embed_image(filepath):
    """Convert image file to base64-embedded HTML img tag."""
    if not os.path.exists(filepath):
        return f'<p class="missing">[Image not found: {os.path.basename(filepath)}]</p>'
    with open(filepath, 'rb') as f:
        data = base64.b64encode(f.read()).decode('utf-8')
    return f'<img src="data:image/png;base64,{data}" class="figure" />'


def _find_figure(figure_files, pattern):
    """Find a figure file matching a pattern."""
    matches = [f for f in figure_files if pattern in os.path.basename(f)]
    return matches[0] if matches else None


def _section_overview(adata, data_type, all_stats):
    """Generate overview section."""
    load_stats = all_stats.get('loading', {})

    type_names = {'cytof': 'Mass Cytometry (CyTOF)', 'scrnaseq': 'Single-Cell RNA-seq',
                  'flow': 'Flow Cytometry'}

    html = f"""
    <section id="overview">
        <h2>1. Data Overview</h2>
        <div class="key-finding">
            <strong>Dataset Summary:</strong>
            {adata.shape[0]:,} cells &times; {adata.shape[1]} features
            | Data type: {type_names.get(data_type, data_type)}
        </div>
        <table class="stats-table">
            <tr><td>Total cells analyzed</td><td>{adata.shape[0]:,}</td></tr>
            <tr><td>Number of features/markers</td><td>{adata.shape[1]}</td></tr>
            <tr><td>Data type</td><td>{type_names.get(data_type, data_type)}</td></tr>
            <tr><td>Metadata columns</td><td>{', '.join(adata.obs.columns)}</td></tr>
    """
    if load_stats.get('original_cells'):
        html += f'<tr><td>Original cells (before subsampling)</td><td>{load_stats["original_cells"]:,}</td></tr>'
    if load_stats.get('n_groups'):
        html += f'<tr><td>Number of groups/samples</td><td>{load_stats["n_groups"]}</td></tr>'

    html += "</table></section>"
    return html


def _section_qc(data_type, qc_stats, figure_files, style):
    """Generate QC section."""
    html = '<section id="qc"><h2>2. Quality Control</h2>'

    # Marker distribution figure
    fig = _find_figure(figure_files, 'qc_marker_distributions')
    if fig:
        if style == 'clinical':
            html += """
            <div class="interpretation">
                <h4>What this shows</h4>
                <p>Each violin shape shows the distribution of signal intensity for one marker across all cells.
                A wider section means more cells have that intensity level. The white dot shows the median.</p>
                <h4>What to look for</h4>
                <p>Ideally, markers should show a range of values (indicating biological variation).
                Markers with very narrow distributions may be uninformative.
                Extremely skewed distributions or unusual spikes may indicate technical artifacts.</p>
            </div>
            """
        html += _embed_image(fig)

    # Data-type-specific QC
    if data_type in ('cytof', 'flow'):
        if qc_stats.get('cells_5plus_outlier_markers') is not None:
            html += f"""
            <div class="key-finding">
                <strong>Outlier Detection:</strong>
                {qc_stats.get('cells_5plus_outlier_markers', 'N/A')} cells flagged as outliers
                in 5+ markers ({qc_stats.get('cells_5plus_outlier_markers', 0) / max(qc_stats.get('n_cells_before', 1), 1) * 100:.1f}%)
            </div>
            """
        fig = _find_figure(figure_files, 'qc_batch_effects')
        if fig:
            if style == 'clinical':
                html += """
                <div class="interpretation">
                    <h4>Batch Effects Heatmap</h4>
                    <p>This heatmap shows the median signal for each marker (rows) across different
                    sample groups (columns). Consistent colors across columns indicate good consistency.
                    Columns that look very different from others may have batch effects.</p>
                </div>
                """
            html += _embed_image(fig)

    elif data_type == 'scrnaseq':
        fig = _find_figure(figure_files, 'qc_scrnaseq')
        if fig:
            if style == 'clinical':
                html += """
                <div class="interpretation">
                    <h4>scRNA-seq Quality Metrics</h4>
                    <p>These plots show three key quality indicators: total RNA molecules detected per cell,
                    number of unique genes detected, and the percentage of mitochondrial RNA.
                    High mitochondrial percentage often indicates dying or stressed cells.</p>
                </div>
                """
            html += _embed_image(fig)

        if qc_stats.get('median_mito_pct') is not None:
            html += f"""
            <table class="stats-table">
                <tr><td>Median counts per cell</td><td>{qc_stats.get('median_counts', 'N/A'):.0f}</td></tr>
                <tr><td>Median genes per cell</td><td>{qc_stats.get('median_genes', 'N/A'):.0f}</td></tr>
                <tr><td>Median mitochondrial %</td><td>{qc_stats.get('median_mito_pct', 'N/A'):.1f}%</td></tr>
            </table>
            """

    html += '</section>'
    return html


def _section_normalization(norm_stats, style):
    """Generate normalization section."""
    html = '<section id="normalization"><h2>3. Normalization</h2>'

    method = norm_stats.get('method', 'unknown')
    transformation = norm_stats.get('transformation', 'N/A')

    if style == 'clinical':
        html += """
        <div class="interpretation">
            <h4>Why normalize?</h4>
            <p>Normalization adjusts the raw measurements so that cells can be fairly compared.
            Without normalization, technical differences (like how much total material was captured)
            could be mistaken for biological differences.</p>
        </div>
        """

    html += f"""
    <table class="stats-table">
        <tr><td>Method</td><td>{method}</td></tr>
        <tr><td>Transformation applied</td><td>{transformation}</td></tr>
    """

    if norm_stats.get('n_hvg'):
        html += f'<tr><td>Highly variable genes selected</td><td>{norm_stats["n_hvg"]}</td></tr>'
    if norm_stats.get('nan_markers_after_scale'):
        html += f'<tr><td>Constant markers (set to 0)</td><td>{len(norm_stats["nan_markers_after_scale"])}</td></tr>'

    html += '</table></section>'
    return html


def _section_dim_reduction(dr_stats, figure_files, style):
    """Generate dimensionality reduction section."""
    html = '<section id="dim-reduction"><h2>4. Dimensionality Reduction</h2>'

    # PCA
    fig = _find_figure(figure_files, 'pca_scree')
    if fig:
        if style == 'clinical':
            html += """
            <div class="interpretation">
                <h4>PCA Scree Plot</h4>
                <p>Principal Component Analysis finds the main patterns (or "axes of variation") in the data.
                The scree plot shows how much each pattern contributes to the overall variation.
                The first few components usually capture the most important biological signals.</p>
            </div>
            """
        html += _embed_image(fig)

    fig = _find_figure(figure_files, 'pca_loadings')
    if fig:
        if style == 'clinical':
            html += """
            <div class="interpretation">
                <h4>PCA Loadings</h4>
                <p>This shows which markers drive each principal component. Markers with long bars
                are the most important for that pattern. Blue bars indicate positive contribution,
                red bars indicate negative (inverse) contribution.</p>
            </div>
            """
        html += _embed_image(fig)

    # UMAP
    fig = _find_figure(figure_files, 'umap_metadata')
    if fig:
        if style == 'clinical':
            html += """
            <div class="interpretation">
                <h4>Cell Similarity Map (UMAP)</h4>
                <p>This map arranges all cells so that similar cells appear close together.
                Each dot is a single cell, and colors represent different sample categories.
                Cells that cluster together share similar molecular profiles.</p>
                <h4>What to look for</h4>
                <p>Distinct groups of cells suggest different cell states or types.
                If cells from the same category cluster together, it indicates strong biological identity.
                Mixing of categories within clusters suggests shared molecular features.</p>
            </div>
            """
        html += _embed_image(fig)

    fig = _find_figure(figure_files, 'umap_markers')
    if fig:
        if style == 'clinical':
            html += """
            <div class="interpretation">
                <h4>UMAP with Marker Expression</h4>
                <p>Same cell map as above, but now colored by the intensity of specific markers.
                Bright/yellow areas show high expression; dark/purple shows low expression.
                This reveals which markers define different cell populations.</p>
            </div>
            """
        html += _embed_image(fig)

    if dr_stats.get('n_pcs_90pct_var'):
        html += f"""
        <div class="key-finding">
            <strong>Key metrics:</strong>
            PC1 explains {dr_stats.get('variance_explained_pc1', 0)*100:.1f}% of variance |
            {dr_stats['n_pcs_90pct_var']} PCs for 90% cumulative variance
        </div>
        """

    html += '</section>'
    return html


def _section_clustering(clust_stats, figure_files, style):
    """Generate clustering section."""
    html = '<section id="clustering"><h2>5. Clustering Analysis</h2>'

    if style == 'clinical':
        html += """
        <div class="interpretation">
            <h4>What is clustering?</h4>
            <p>Clustering automatically groups cells with similar molecular profiles.
            Each cluster represents a distinct cell population. The algorithm finds natural
            groupings without being told what to look for.</p>
        </div>
        """

    fig = _find_figure(figure_files, 'clustering_umap')
    if fig:
        html += _embed_image(fig)

    if clust_stats.get('n_clusters'):
        html += f"""
        <div class="key-finding">
            <strong>Found {clust_stats['n_clusters']} cell clusters</strong>
        </div>
        """

    # Evaluation metrics
    if clust_stats.get('ARI') is not None:
        html += '<h3>Clustering Quality</h3>'
        if style == 'clinical':
            html += """
            <div class="interpretation">
                <p>These scores measure how well the automatic clustering matches known labels.
                Values closer to 1.0 indicate better agreement.</p>
            </div>
            """
        html += f"""
        <table class="stats-table">
            <tr><td>Adjusted Rand Index (ARI)</td><td>{clust_stats['ARI']:.4f}</td></tr>
            <tr><td>Normalized Mutual Info (NMI)</td><td>{clust_stats['NMI']:.4f}</td></tr>
        """
        if clust_stats.get('silhouette_score') is not None:
            html += f'<tr><td>Silhouette Score</td><td>{clust_stats["silhouette_score"]:.4f}</td></tr>'
        html += '</table>'

    fig = _find_figure(figure_files, 'cluster_composition')
    if fig:
        if style == 'clinical':
            html += """
            <div class="interpretation">
                <h4>Cluster Composition</h4>
                <p>These stacked bar charts show what proportion of each cluster comes from
                different sample categories. This reveals whether clusters are driven by
                biology (interesting) or batch effects (problematic).</p>
            </div>
            """
        html += _embed_image(fig)

    html += '</section>'
    return html


def _section_markers(marker_stats, figure_files, style):
    """Generate marker analysis section."""
    html = '<section id="markers"><h2>6. Marker Analysis</h2>'

    # DE dotplot/heatmap
    fig = _find_figure(figure_files, 'marker_dotplot') or _find_figure(figure_files, 'marker_heatmap')
    if fig:
        if style == 'clinical':
            html += """
            <div class="interpretation">
                <h4>Cluster-Defining Markers</h4>
                <p>This shows which markers best distinguish each cluster from the others.
                Large, dark dots indicate markers that are strongly and consistently expressed
                in that cluster. These are the molecular "signatures" of each cell group.</p>
            </div>
            """
        html += _embed_image(fig)

    # Correlation heatmap
    fig = _find_figure(figure_files, 'marker_correlation')
    if fig:
        if style == 'clinical':
            html += """
            <div class="interpretation">
                <h4>Marker Correlation Network</h4>
                <p>This heatmap shows which markers tend to increase or decrease together.
                Red indicates positive correlation (both go up together), blue indicates
                negative correlation (one goes up when the other goes down). Strong correlations
                suggest these markers may be part of the same signaling pathway.</p>
            </div>
            """
        html += _embed_image(fig)

    # Treatment response
    fig = _find_figure(figure_files, 'treatment_heatmap')
    if fig:
        if style == 'clinical':
            html += """
            <div class="interpretation">
                <h4>Treatment Response</h4>
                <p>This heatmap shows how each marker's average level changes across
                different treatment conditions. Differences in color indicate that
                the treatment is affecting that marker's activity.</p>
            </div>
            """
        html += _embed_image(fig)

    fig = _find_figure(figure_files, 'treatment_boxplots')
    if fig:
        html += _embed_image(fig)

    # Time course
    fig = _find_figure(figure_files, 'time_course')
    if fig:
        if style == 'clinical':
            html += """
            <div class="interpretation">
                <h4>Time-Course Dynamics</h4>
                <p>These line plots show how marker expression changes over time.
                Rising or falling trends indicate dynamic cellular responses.
                Markers that change rapidly may be early responders to treatment.</p>
            </div>
            """
        html += _embed_image(fig)

    html += '</section>'
    return html


def _save_summary_json(all_stats, filepath):
    """Save analysis summary as JSON."""
    # Make JSON-serializable
    def _clean(obj):
        if isinstance(obj, dict):
            return {str(k): _clean(v) for k, v in obj.items()}
        elif isinstance(obj, (list, tuple)):
            return [_clean(v) for v in obj]
        elif isinstance(obj, (int, float, str, bool, type(None))):
            return obj
        elif hasattr(obj, 'item'):
            return obj.item()
        else:
            return str(obj)

    clean_stats = _clean(all_stats)

    with open(filepath, 'w') as f:
        json.dump(clean_stats, f, indent=2, default=str)


def _build_html(sections, figure_files, data_type, report_style):
    """Assemble the full HTML report."""
    type_names = {'cytof': 'Mass Cytometry (CyTOF)', 'scrnaseq': 'Single-Cell RNA-seq',
                  'flow': 'Flow Cytometry'}
    style_label = 'Clinical Report' if report_style == 'clinical' else 'Technical Report'

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Initial Data Analysis — {type_names.get(data_type, data_type)}</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6; color: #333; max-width: 1100px;
            margin: 0 auto; padding: 20px 40px;
            background: #fafafa;
        }}
        header {{
            background: linear-gradient(135deg, #2c3e50, #3498db);
            color: white; padding: 30px 40px; margin: -20px -40px 30px;
            border-radius: 0 0 8px 8px;
        }}
        header h1 {{ font-size: 1.8em; margin-bottom: 5px; }}
        header .subtitle {{ opacity: 0.85; font-size: 0.95em; }}
        section {{
            background: white; border-radius: 8px; padding: 25px 30px;
            margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }}
        h2 {{
            color: #2c3e50; border-bottom: 2px solid #3498db;
            padding-bottom: 8px; margin-bottom: 20px; font-size: 1.4em;
        }}
        h3 {{ color: #34495e; margin: 15px 0 10px; font-size: 1.1em; }}
        h4 {{ color: #2c3e50; margin: 10px 0 5px; font-size: 1em; }}
        .key-finding {{
            background: #eaf4fc; border-left: 4px solid #3498db;
            padding: 12px 18px; margin: 15px 0; border-radius: 0 6px 6px 0;
            font-size: 0.95em;
        }}
        .interpretation {{
            background: #f8f9fa; border: 1px solid #e9ecef;
            padding: 15px 20px; margin: 15px 0; border-radius: 6px;
            font-size: 0.9em; color: #555;
        }}
        .interpretation h4 {{ color: #2c3e50; margin-top: 0; }}
        .stats-table {{
            width: 100%; border-collapse: collapse; margin: 15px 0;
        }}
        .stats-table td {{
            padding: 8px 12px; border-bottom: 1px solid #eee;
        }}
        .stats-table td:first-child {{
            font-weight: 500; color: #555; width: 45%;
        }}
        .stats-table td:last-child {{ color: #2c3e50; }}
        .figure {{
            max-width: 100%; height: auto; display: block;
            margin: 15px auto; border: 1px solid #eee; border-radius: 4px;
        }}
        .missing {{ color: #999; font-style: italic; }}
        footer {{
            text-align: center; padding: 20px; color: #999;
            font-size: 0.85em; border-top: 1px solid #eee; margin-top: 30px;
        }}
        @media print {{
            body {{ max-width: 100%; padding: 10px; }}
            section {{ box-shadow: none; border: 1px solid #ddd; }}
            .figure {{ max-width: 90%; }}
        }}
    </style>
</head>
<body>
    <header>
        <h1>Initial Data Analysis Report</h1>
        <div class="subtitle">
            {type_names.get(data_type, data_type)} | {style_label} |
            Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}
        </div>
    </header>

    {''.join(sections)}

    <footer>
        Generated by bioinformatics-init-analysis pipeline<br>
        {len(figure_files)} figures | {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
    </footer>
</body>
</html>"""

    return html
