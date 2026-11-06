# Statistical Methods Glossary

A plain-language guide to the statistical methods used in this pipeline. Written for medical professionals and researchers who need to understand the results without deep computational background.

---

## PCA — Principal Component Analysis

**Plain language:** "Finding the most important patterns in the data."

**What it does:** Imagine measuring 40 different proteins in each cell. PCA finds the handful of "super-measurements" that capture most of the variation. The first principal component (PC1) is the single best summary of differences between cells; PC2 is the next best (independent of PC1), and so on.

**Analogy:** Like summarizing a patient's health — instead of listing 100 lab values, you might say "cardiovascular status" and "metabolic status," which together capture most of the clinical picture.

**Output:** Each PC is a weighted combination of original markers. The **loadings** tell you which markers contribute most to each pattern.

**Key numbers:**
- **Variance explained**: How much of the total data variation each PC captures (e.g., PC1=25% means the top pattern accounts for a quarter of all variation)
- **Cumulative variance**: Running total — how many PCs you need to capture 90% of variation

---

## UMAP — Uniform Manifold Approximation and Projection

**Plain language:** "Creating a map of cell similarities."

**What it does:** Converts high-dimensional data (40+ measurements per cell) into a 2D picture where similar cells appear near each other. It's like taking a 40-dimensional space and projecting it onto a flat surface while preserving the neighborhood relationships.

**Important limitations:**
- Nearby cells ARE similar — this is reliable
- Far-apart cells may or may not be very different — distances between clusters are NOT proportional to biological difference
- UMAP is non-deterministic — running it twice gives slightly different layouts
- It's for visualization only, not for statistical testing

**Analogy:** Like arranging photos of faces — similar-looking faces naturally group together, but the exact position on the table doesn't have special meaning.

---

## Leiden Clustering

**Plain language:** "Automatically grouping similar cells."

**What it does:** Builds a network where cells are connected to their most similar neighbors, then finds communities (densely connected groups) in this network. Each community becomes a cluster.

**Resolution parameter:**
- Low resolution (0.5) = fewer, larger clusters
- High resolution (1.0-2.0) = more, smaller clusters
- There is no single "correct" resolution — it depends on the biological question

**Analogy:** Like identifying friend groups in a social network — people who interact more frequently get grouped together.

---

## Wilcoxon Rank-Sum Test

**Plain language:** "Testing which markers differ between groups."

**What it does:** For each marker and each cluster, it asks: "Are the values in this cluster systematically higher or lower than in all other cells?" It ranks all values and checks whether one group's ranks are disproportionately high or low.

**Why this test?**
- Doesn't assume normal distribution (important for biological data)
- Robust to outliers
- Works well with the sparse, skewed distributions common in single-cell data

**Key outputs:**
- **Log fold-change**: How much higher/lower the marker is in this cluster vs others (log2 scale — a value of 1 means ~2x higher)
- **P-value**: Probability of seeing this difference by chance alone
- **Adjusted p-value (FDR)**: P-value corrected for testing many markers simultaneously

---

## MAD — Median Absolute Deviation

**Plain language:** "Identifying unusual cells."

**What it does:** For each marker, it calculates how far each cell's value is from the typical (median) value. It uses the "median absolute deviation" as the unit of measurement (similar to standard deviation, but more robust to outliers).

**Threshold:** Cells more than 5 MADs from the median are flagged as potential outliers. This is intentionally conservative — only extreme values are flagged.

**Why MAD instead of standard deviation?**
- Standard deviation is strongly affected by outliers (the very things we're trying to find)
- MAD is resistant to outliers, making it a more reliable measure of "normal" spread

**Formula:** `Modified Z-score = 0.6745 × (value - median) / MAD`

---

## ARI — Adjusted Rand Index

**Plain language:** "How well does automatic grouping match known labels?"

**What it does:** Compares two sets of labels — the automatic clusters and known categories (e.g., cell types). It counts how often pairs of cells are correctly grouped together or correctly separated.

**Score interpretation:**
- **1.0** = perfect match
- **0.0** = random agreement (no better than chance)
- **Negative** = worse than random (actively mismatching)

**When is this used?** Only when you have ground-truth labels to compare against (e.g., known cell line identity, expert annotations).

---

## NMI — Normalized Mutual Information

**Plain language:** "How much do the clusters tell us about the true labels?"

**What it does:** Measures the information shared between cluster assignments and known labels. High NMI means knowing the cluster reliably tells you the true label.

**Score interpretation:**
- **1.0** = clusters perfectly predict labels
- **0.0** = clusters provide no information about labels

**Difference from ARI:** NMI focuses on information content; ARI focuses on pair-wise agreement. Both are useful — they often agree but can differ when cluster sizes vary widely.

---

## Silhouette Score

**Plain language:** "How distinct are the clusters?"

**What it does:** For each cell, it measures:
1. How close the cell is to others in its own cluster (cohesion)
2. How far it is from the nearest other cluster (separation)

**Score interpretation:**
- **+1.0** = cells are well-matched to their cluster and poorly matched to neighbors
- **0.0** = cells are on the boundary between clusters
- **-1.0** = cells are probably in the wrong cluster

**Average score guidelines:**
- \>0.5 = strong clustering structure
- 0.25-0.5 = reasonable structure
- <0.25 = weak or overlapping clusters

---

## Spearman Correlation

**Plain language:** "Do two markers move together?"

**What it does:** Measures whether two markers tend to increase and decrease together across cells. Unlike Pearson correlation, Spearman works on ranks — it detects any monotonic relationship, not just linear ones.

**Score interpretation:**
- **+1.0** = perfect positive correlation (both always increase together)
- **0.0** = no relationship
- **-1.0** = perfect negative correlation (one increases when other decreases)

**Biological meaning:** Strongly correlated markers often belong to the same signaling pathway or are co-regulated. Anti-correlated markers may represent competing or inhibitory pathways.

---

## FDR — False Discovery Rate (Benjamini-Hochberg)

**Plain language:** "Correcting for multiple testing."

**The problem:** When testing hundreds of markers simultaneously, some will appear significant by chance. If you test 1,000 markers at p<0.05, you'd expect ~50 false positives even if nothing is truly different.

**The solution:** FDR correction adjusts p-values upward to account for the number of tests performed. An FDR of 0.05 means you accept that ~5% of your "significant" findings may be false positives.

**Rule of thumb:** Use adjusted p-value (FDR) < 0.05 for declaring significance in multi-marker analyses.

---

## Arcsinh Transformation

**Plain language:** "Compressing the data scale."

**What it does:** The inverse hyperbolic sine function (arcsinh) compresses large values while preserving small ones. For CyTOF data: `arcsinh(x / cofactor)` where cofactor is typically 5.

**Why needed?** Raw CyTOF values span several orders of magnitude (0 to 10,000+). Without transformation, a few highly expressed markers would dominate the analysis. Arcsinh brings values to a manageable range (~-1 to 15) while preserving relative differences.

**Comparison to log:** Similar to log transformation but handles zero and negative values (log(0) is undefined; arcsinh(0) = 0).
