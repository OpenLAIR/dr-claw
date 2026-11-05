# bioinformatics-init-analysis

A Claude Code plugin that automates initial data analysis for high-dimensional single-cell biology data. Supports CyTOF (mass cytometry), scRNA-seq, and flow cytometry with automatic data type detection and plain-language clinical report generation.

## Features

- **7-step pipeline**: Load → QC → Normalize → PCA/UMAP → Cluster → Marker Analysis → Report
- **Auto-detection**: Identifies CyTOF, scRNA-seq, or flow cytometry from file format and marker patterns
- **Clinical reports**: HTML reports with plain-language explanations for medical doctors and non-bioinformaticians
- **Data-type-aware**: QC, normalization, and interpretation adapt to data type
- **Modular**: Run the full pipeline or import individual steps

## Installation

Clone into your Claude Code plugins directory:

```bash
git clone https://github.com/<your-username>/bioinformatics-init-analysis.git \
    ~/.claude/plugins/bioinformatics-init-analysis
```

### Dependencies

```bash
pip install scanpy anndata matplotlib seaborn scipy scikit-learn pandas numpy
# Optional: fcsparser (for .fcs flow cytometry files)
```

## Usage

### As a Claude Code Plugin

Once installed, trigger the skill in Claude Code with phrases like:
- "Run initial analysis on my CyTOF data"
- "QC my single-cell data"
- "Analyze and generate a report for my dataset"

### Command Line

```bash
python3 skills/init-analysis/scripts/run_pipeline.py <input_path> \
    [--data-type auto|cytof|scrnaseq|flow] \
    [--subsample 500] \
    [--output-dir ./analysis_output] \
    [--report-style clinical|technical]
```

### Examples

```bash
# CyTOF directory of CSVs (auto-detected)
python3 skills/init-analysis/scripts/run_pipeline.py /path/to/cytof_csvs/

# scRNA-seq h5ad file with technical report
python3 skills/init-analysis/scripts/run_pipeline.py /path/to/data.h5ad --report-style technical

# Flow cytometry with more cells per sample
python3 skills/init-analysis/scripts/run_pipeline.py /path/to/data.fcs --subsample 2000
```

## Output

```
analysis_output/
├── figures/                    # All generated plots (PNG)
├── processed/
│   └── adata_processed.h5ad   # Processed AnnData object
├── report.html                 # HTML report with embedded figures
└── analysis_summary.json       # Machine-readable summary statistics
```

## Plugin Structure

```
bioinformatics-init-analysis/
└── skills/
    └── init-analysis/              # The skill directory (linked into projects as-is)
        ├── SKILL.md                # Skill definition (triggers, usage)
        ├── scripts/
        │   ├── run_pipeline.py         # Main CLI entry point
        │   ├── detect_data_type.py     # Auto-detection logic
        │   ├── utils.py                # Shared utilities
        │   ├── step1_load_data.py      # Universal data loader
        │   ├── step2_qc.py             # Data-type-aware QC
        │   ├── step3_normalize.py      # Normalization (arcsinh/CPM+log1p)
        │   ├── step4_dim_reduction.py  # PCA + UMAP
        │   ├── step5_clustering.py     # Leiden clustering + evaluation
        │   ├── step6_marker_analysis.py# DE, correlation, treatment response
        │   └── step7_report.py         # HTML report generator
        └── references/
            ├── plot_interpretation_guide.md  # How to read each plot type
            ├── cytof_specifics.md            # CyTOF data handling
            ├── scrnaseq_specifics.md         # scRNA-seq data handling
            └── statistical_methods.md        # Stats glossary for non-experts
```

Scripts and references sit inside the skill directory because Dr. Claw links
only that directory into a project.

## License

MIT
