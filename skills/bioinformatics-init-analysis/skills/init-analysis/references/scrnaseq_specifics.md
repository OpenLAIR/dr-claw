# Single-Cell RNA-seq Specifics

## What is scRNA-seq?

Single-cell RNA sequencing measures gene expression (mRNA levels) in individual cells. Unlike CyTOF which measures ~40 proteins, scRNA-seq measures thousands of genes simultaneously, providing a comprehensive transcriptomic profile.

## Data Characteristics

- **Measurements**: 20,000-30,000 genes per cell (most near zero)
- **Cell counts**: Hundreds to millions of cells
- **Value type**: Count data (number of RNA molecules detected)
- **Sparsity**: ~90-95% of values are zero ("dropout")

## Common File Formats

| Format | Description | Typical Source |
|--------|-------------|----------------|
| `.h5ad` | AnnData HDF5 | Processed datasets, GEO |
| `.h5` | 10X HDF5 | Cell Ranger output |
| `.mtx` + barcodes + features | Market Matrix | Cell Ranger output |

## Normalization Pipeline

### Step 1: Library Size Normalization
Each cell has different total RNA captured. Normalize to counts per 10,000 (CP10K):
```
normalized = (counts / total_counts_per_cell) * 10,000
```

### Step 2: Log Transformation
```
log_normalized = log(normalized + 1)
```
This stabilizes variance and makes the data more normally distributed.

### Step 3: Highly Variable Gene (HVG) Selection
Select the top 2,000-5,000 most variable genes for dimensionality reduction. This removes noise from non-varying genes while retaining biological signal.

### Step 4: Z-Score Scaling
Scale each gene to mean=0, variance=1 for PCA. **Important:** Genes with zero variance produce NaN — replace with 0.

## QC Metrics and Thresholds

### Per-Cell Metrics

| Metric | Good Range | Red Flag |
|--------|-----------|----------|
| Total counts | 1,000-50,000 | <500 or >100,000 |
| Genes detected | 200-5,000 | <200 or >8,000 |
| Mitochondrial % | <10% | >20% |
| Ribosomal % | 5-40% | Context-dependent |

### What These Metrics Mean

- **Low total counts**: Cell may be empty droplet or debris
- **Very high counts**: Possible doublet (two cells captured together)
- **Low genes detected**: Poor quality cell, low complexity
- **Very high genes detected**: Likely doublet
- **High mitochondrial %**: Dying or stressed cell (cytoplasmic RNA degrades, mitochondrial persists)

### Mitochondrial Gene Patterns
- Human: genes starting with `MT-` (e.g., MT-CO1, MT-ND1)
- Mouse: genes starting with `mt-` (e.g., mt-Co1, mt-Nd1)

### Ribosomal Gene Patterns
- Human: `RPL` (large subunit) and `RPS` (small subunit)
- Mouse: `Rpl` and `Rps`

## Common QC Issues

1. **Empty droplets**: Very low counts, few genes — filter by minimum counts/genes
2. **Doublets**: Abnormally high counts AND genes — use scrublet or DoubletFinder
3. **Ambient RNA contamination**: Background RNA from lysed cells; tools like SoupX or CellBender can correct
4. **Cell cycle effects**: May dominate variation; can regress out if not biologically relevant
5. **Batch effects**: Different sequencing runs may cluster separately; use integration methods (Harmony, scVI)

## Analysis Tips

- **HVG selection**: Use `seurat_v3` flavor for raw counts, `seurat` for log-normalized
- **PCA components**: Typically 15-50 PCs capture meaningful variation
- **Leiden resolution**: Higher resolution (1.0-2.0) often needed due to higher dimensionality
- **DE testing**: Wilcoxon rank-sum is robust for scRNA-seq; works well with sparse data
- **Cell type annotation**: After clustering, compare top markers to known cell type databases (CellMarker, PanglaoDB)

## Differences from CyTOF

| Feature | CyTOF | scRNA-seq |
|---------|-------|-----------|
| Molecules measured | Proteins | mRNA |
| Features per cell | 30-50 | 20,000+ |
| Sparsity | Low | Very high (~95%) |
| Transformation | arcsinh | log1p |
| HVG selection | Not needed | Essential |
| Typical cell count | 100K-1M | 1K-100K |
