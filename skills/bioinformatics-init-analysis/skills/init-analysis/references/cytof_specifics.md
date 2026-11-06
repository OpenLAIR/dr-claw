# CyTOF (Mass Cytometry) Specifics

## What is CyTOF?

Mass cytometry (CyTOF = Cytometry by Time-Of-Flight) measures protein expression in individual cells using metal-tagged antibodies instead of fluorescent labels. This allows simultaneous measurement of 30-50+ proteins per cell with minimal signal overlap.

## Data Characteristics

- **Measurements**: Typically 30-50 protein markers per cell
- **Cell counts**: Thousands to millions of cells per sample
- **Value range**: Raw ion counts, then typically arcsinh-transformed
- **Common markers**: Phosphoproteins (p.ERK, p.AKT, p.S6, etc.), surface markers, cell state markers

## Arcsinh Transformation

CyTOF data is typically transformed using the inverse hyperbolic sine function with a cofactor of 5:

```
transformed = arcsinh(raw_counts / 5)
```

**How to tell if data is already transformed:**
- Raw data: values range from 0 to ~10,000+
- Arcsinh-transformed: values typically range from ~-1 to ~15
- The pipeline checks this automatically

**Important:** Do NOT double-transform data. If values are already in the [-1, 15] range, skip transformation.

## Typical Marker Categories

### Phosphoproteins (Signaling)
These measure activation state of signaling pathways:
- **MAPK pathway**: p.ERK1/2, p.MEK1/2, p.p38, p.JNK
- **PI3K/AKT/mTOR**: p.AKT, p.S6, p.4EBP1, p.mTOR
- **JAK/STAT**: p.STAT1, p.STAT3, p.STAT5
- **Other kinases**: p.SRC, p.FAK, p.PLCg2
- **Transcription factors**: p.CREB, p.NFkB

### Cellular State Markers
- **Proliferation**: Ki-67, CyclinB1, IdU (DNA synthesis)
- **Apoptosis**: Cleaved caspase-3, cleaved PARP
- **Housekeeping**: GAPDH (loading control)

### Surface Markers
- **Lineage**: CD45, CD3, CD4, CD8, CD19, CD56
- **Receptors**: HER2, EGFR, CD44

## QC Considerations

### MAD-Based Outlier Detection
- Median Absolute Deviation (MAD) identifies cells with extreme values
- Default threshold: 5 MADs from median per marker
- Cells flagged in 5+ markers simultaneously are strong outlier candidates

### Common QC Issues
1. **Dead cells/debris**: Unusually low signal across most markers
2. **Doublets**: Two cells measured as one; abnormally high for multiple markers
3. **Bead contamination**: Extreme values in specific metal channels
4. **Oxidation artifacts**: Systematic signal drift over acquisition time

### Batch Effects
- **Bead normalization**: Should be applied before analysis (usually done during data acquisition)
- **Between-sample variation**: Compare median marker values across samples using heatmap
- **Reference samples**: Include biological controls to assess batch consistency

## Normalization Notes

- **Pre-transformed data**: Most published CyTOF datasets are already arcsinh-transformed
- **Z-score scaling**: Applied for PCA/UMAP to give equal weight to all markers
- **Caution**: Constant markers (no variation) produce NaN after z-scoring; the pipeline replaces these with 0

## Analysis Tips

- **Subsampling**: For >100K cells, subsample 500-2000 cells per group for initial exploration
- **Leiden resolution**: Start with 0.5-1.0; CyTOF data often needs lower resolution than scRNA-seq
- **Treatment effects**: Phosphoprotein markers are most responsive to kinase inhibitors
- **Signaling networks**: Correlation analysis on phosphoproteins reveals pathway dependencies
