# Plot Interpretation Guide

A guide for explaining each plot type to non-bioinformaticians (e.g., medical doctors, clinical researchers).

## Violin Plots (Marker Distributions)

**What this shows:** Each "violin" shape represents the distribution of signal intensity for one marker across all cells. The width indicates how many cells have that particular intensity level. A wider section means more cells measured at that value.

**How to read it:**
- The white dot in the center is the **median** (typical value)
- Wider parts = more cells at that intensity
- Very narrow violins mean most cells have similar values
- Bimodal shapes (two wide sections) suggest two distinct cell populations

**What good looks like:** Markers should show biological variation — a range of values across cells. Some bimodal distributions are expected for signaling markers (active vs inactive cells).

**What bad looks like:**
- All violins extremely narrow → data may lack biological variation or was over-normalized
- Extreme outlier spikes → possible technical artifacts or debris
- All markers identical shape → possible normalization issue

**Clinical relevance:** The shape of marker distributions can reveal whether a protein is constitutively active, stimulus-responsive, or binary (on/off) in behavior.

---

## Heatmaps

### Batch Effects Heatmap

**What this shows:** A grid where each row is a marker and each column is a sample group (e.g., cell line, patient). Colors represent the median signal intensity — red/warm colors mean higher expression, blue/cool colors mean lower.

**How to read it:**
- Look for **columns** that look drastically different from others → may indicate batch effects
- Look for **rows** (markers) that vary consistently across groups → biologically meaningful
- Consistent color patterns across columns = good technical consistency

**What good looks like:** Some variation across columns (biological) but no single column dramatically different from all others.

**What bad looks like:** One or more columns entirely different color from rest → technical batch effect, not biology.

### Correlation Heatmap

**What this shows:** How markers relate to each other across all cells. Red = positive correlation (both go up together), blue = negative correlation (one goes up, other goes down), white = no relationship.

**How to read it:**
- Strong red blocks = markers in the same signaling pathway
- Blue pairs = markers with opposing activity
- Clusters of correlated markers = signaling modules

**Clinical relevance:** Correlated marker groups often represent functional signaling pathways. Understanding these networks can identify drug targets or resistance mechanisms.

---

## UMAP (Cell Similarity Map)

**What this shows:** A two-dimensional map where each dot is a single cell, positioned so that cells with similar molecular profiles appear close together. This is a dimensionality reduction — compressing dozens of measurements into a 2D picture.

**How to read it:**
- **Clusters** of dots = groups of similar cells
- **Distance** between clusters = degree of molecular difference
- **Colors** represent different categories (cell lines, treatments, etc.) or marker intensity

**What good looks like:**
- Clear, well-separated clusters = distinct cell populations
- Cells from same category clustering together = strong biological signal
- Some overlap between categories = shared molecular features

**What bad looks like:**
- One giant undifferentiated blob = poor separation, possibly under-clustered
- Perfect separation by batch/plate = technical artifact dominating biology
- Scattered single dots everywhere = possible quality issues

**Important caveat:** UMAP preserves local structure (nearby cells are truly similar) but distances between distant clusters are NOT meaningful. Two clusters far apart are not necessarily more different than two clusters that are close.

**Clinical relevance:** The UMAP reveals the landscape of cell heterogeneity. In cancer, distinct clusters may represent different tumor subtypes with different treatment responses.

---

## PCA Scree Plot

**What this shows:** How much information each principal component (PC) captures. The bar chart shows individual contribution; the line chart shows cumulative contribution.

**How to read it:**
- A steep drop-off after PC1-2 = most variation explained by few patterns
- Gradual decline = many patterns contribute to data complexity
- The "elbow" where bars level off = natural dimensionality of the data

**What good looks like:** First 10-20 PCs capture 80-90% of variance, indicating structured data with clear biological signals.

**Clinical relevance:** When few PCs capture most variance, the data has strong, interpretable structure — often corresponding to known biology (cell types, treatment effects).

---

## PCA Loadings

**What this shows:** Which markers contribute most to each principal component. Longer bars = stronger contribution. Blue = positive, red = negative direction.

**How to read it:**
- Top markers in PC1 = the single most important axis of variation
- Markers appearing in multiple PCs = broadly variable
- Opposing markers (one positive, one negative) in the same PC = anti-correlated biology

**Clinical relevance:** Loadings identify the markers driving cell population differences. These are often the most diagnostically or therapeutically relevant molecules.

---

## Dotplot (Differential Expression)

**What this shows:** Marker expression across clusters. Dot size = fraction of cells expressing the marker. Dot color = mean expression level.

**How to read it:**
- Large, dark dots = marker strongly and consistently expressed in that cluster
- Small, light dots = marker weakly or rarely expressed
- Markers unique to one cluster = "signature" markers for that population

**Clinical relevance:** Cluster-defining markers can serve as diagnostic biomarkers or therapeutic targets specific to certain cell populations.

---

## Boxplots (Treatment Response)

**What this shows:** Distribution of marker expression across different treatment conditions. Each box shows the middle 50% of values, with whiskers extending to the range.

**How to read it:**
- Boxes at different heights = treatment changes marker level
- Wide boxes = high variability in response
- Outlier dots beyond whiskers = cells with extreme responses

**Clinical relevance:** Treatment-responsive markers are potential drug targets or biomarkers for treatment monitoring.

---

## Cluster Composition (Stacked Bar Charts)

**What this shows:** What proportion of each cluster comes from different sample categories (cell lines, treatments, time points).

**How to read it:**
- Evenly mixed bars = cluster not driven by any single category
- Bars dominated by one color = cluster specific to that category
- Similar composition across clusters = categories don't define cell groupings

**What good looks like:** Clusters reflecting biology (cell types) rather than technical factors (batch, plate).

**Clinical relevance:** Clusters enriched for specific subtypes or treatment conditions may represent therapeutically targetable populations.

---

## Time-Course Line Plots

**What this shows:** How marker expression changes over time (e.g., minutes after drug treatment).

**How to read it:**
- Rising lines = marker activation over time
- Falling lines = marker suppression
- Peak followed by decline = transient response
- Flat lines = no time-dependent change

**Clinical relevance:** Temporal dynamics reveal signaling cascade order — early responders are often upstream in pathways, making them potential intervention points.
