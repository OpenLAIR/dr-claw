---
name: init-analysis
description: This skill should be used when the user asks to "run initial analysis", "analyze single-cell data", "QC my data", "run bioinformatics pipeline", "generate analysis report", "explore my dataset", "do exploratory data analysis", "initial data analysis", or needs to perform quality control, dimensionality reduction, clustering, or marker analysis on single-cell biology data (CyTOF, scRNA-seq, flow cytometry, proteomics).
version: 0.1.0
---

# Bioinformatics Initial Data Analysis

Automated 7-step analysis pipeline for high-dimensional single-cell biology data with plain-language report generation.

## Supported Data Types

The pipeline auto-detects input data type:

| Data Type | File Formats | Detection Pattern |
|-----------|-------------|-------------------|
| **scRNA-seq** | `.h5ad`, `.h5` (10X), `.mtx` + barcodes | Gene names, count matrix |
| **CyTOF** | `.csv`, `.h5ad` | Phospho-markers (p.ERK, p.AKT, etc.) |
| **Flow cytometry** | `.fcs`, `.csv` | Surface markers, scatter channels |

## Approach 1: Full Pipeline (Recommended)

Run the complete 7-step analysis:

```bash
python3 scripts/run_pipeline.py <input_path> \
    [--data-type auto|cytof|scrnaseq|flow] \
    [--subsample 500] \
    [--output-dir ./analysis_output] \
    [--report-style clinical|technical]
```

**Arguments:**
- `input_path`: Path to data file (`.h5ad`, `.csv`, `.h5`) or directory of CSV files
- `--data-type`: Data type override (default: `auto` for auto-detection)
- `--subsample`: Max cells per group for tractable analysis (default: 500)
- `--output-dir`: Output directory (default: `./analysis_output`)
- `--report-style`: `clinical` for plain-language medical summaries, `technical` for bioinformatics detail (default: `clinical`)

**Output Files:**
```
analysis_output/
├── figures/                    # All generated plots (PNG)
├── processed/
│   └── adata_processed.h5ad   # Processed AnnData object
├── report.html                 # Complete analysis report
└── analysis_summary.json       # Machine-readable summary statistics
```

## Approach 2: Modular Steps

For custom workflows, import individual step modules:

```python
from step1_load_data import load_data
from step2_qc import run_qc
from step3_normalize import normalize_data
from step4_dim_reduction import run_dim_reduction
from step5_clustering import run_clustering
from step6_marker_analysis import run_marker_analysis
from step7_report import generate_report
```

Each step function accepts an AnnData object and returns the modified AnnData plus a dictionary of results/figures.

## Pipeline Steps

### Step 1: Data Loading
Load data from various formats into AnnData. For directories of CSVs (e.g., CyTOF per-cell-line files), automatically concatenate with metadata. Apply subsampling if dataset is large.

### Step 2: Quality Control
**Data-type-aware QC:**
- **CyTOF**: MAD-based outlier detection per marker, signal distributions, batch effects across cell lines
- **scRNA-seq**: Mitochondrial %, genes per cell, counts per cell, doublet detection
- **Universal**: Missing value assessment, distribution violin plots, outlier flagging

### Step 3: Normalization
- **CyTOF**: Data is typically pre-transformed (arcsinh). Verify transformation, apply z-score for dim. reduction.
- **scRNA-seq**: Library size normalization (CPM) -> log1p -> HVG selection -> z-score scaling
- Store raw values in `adata.raw` for downstream differential analysis.

### Step 4: Dimensionality Reduction
PCA with scree plot and loadings analysis, followed by UMAP visualization colored by all available metadata and key markers.

### Step 5: Clustering
Leiden graph-based clustering at multiple resolutions. Evaluate with ARI, NMI, Silhouette scores if reference labels exist. Visualize cluster composition across metadata categories.

### Step 6: Marker Analysis
Wilcoxon rank-sum differential expression per cluster. Marker correlation heatmap. If treatment/condition metadata exists: treatment response analysis with boxplots and effect heatmaps. If time metadata exists: time-course dynamics.

### Step 7: Report Generation
Generate HTML report with embedded figures and interpretations. Two styles:
- **Clinical**: Written for medical doctors and non-bioinformaticians. Each plot includes "What this shows", "Key findings", and "Clinical relevance" sections.
- **Technical**: Standard bioinformatics report with methods, parameters, and statistical details.

## Reference Files

For detailed guidance, consult:
- **`references/plot_interpretation_guide.md`** - How to explain each plot type to non-experts
- **`references/cytof_specifics.md`** - CyTOF-specific QC, normalization, and markers
- **`references/scrnaseq_specifics.md`** - scRNA-seq-specific processing details
- **`references/statistical_methods.md`** - Plain-language glossary of statistical methods

## Important Notes

- **CyTOF data is often pre-transformed**: Check value ranges before applying arcsinh. Values in range [-1, 15] indicate arcsinh-transformed data.
- **Large datasets**: Always subsample for initial exploration. Use 500-2000 cells per group.
- **NaN handling**: Always run `nan_to_num` after z-score scaling — constant-value features produce NaN.
- **Leiden timeout**: For >50K cells, Leiden clustering may take >10 minutes. Reduce subsample size.
- **Report audience**: Default to clinical style unless user requests technical detail.
