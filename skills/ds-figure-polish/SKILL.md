---
name: ds-figure-polish
description: Use when a research project needs a polished data figure (results chart, paper figure, appendix figure, progress summary plot) made with matplotlib, or a render-inspect-revise pass before treating a figure as final.
skill_role: companion
license: MIT
metadata:
  author: ResearAI/DeepScientist
  version: "1.0.0"
---

# Figure Polish

Use this skill when a figure matters beyond transient debugging.

This includes:

- a main-experiment summary image shared in chat or a progress report
- an aggregated analysis-campaign chart
- a paper-facing main figure
- an appendix / supplementary figure
- any figure that will be stored as a durable artifact or cited in writing

Do not use this skill for disposable debug plots unless the user explicitly asks for them to be polished.

## Core principle

Research figures should feel academic, restrained, and clear.

The goal is not to make a plot “fancy”.
The goal is to make the intended comparison obvious without visual clutter.

Use one dominant message per figure.
If multiple unrelated claims are competing inside the same image, split the figure instead of cramming everything into one panel.

## Surface classes

First classify the figure:

- `progress_update`
  - quick summary image for a chat message or progress report
  - usually `png`
  - message-first and minimal
- `paper_main`
  - core paper figure
  - export `pdf` or `svg` plus a `png` preview
  - must remain readable after likely single-column or double-column placement
- `appendix`
  - supplementary figure
  - may contain slightly more detail, but still avoid dashboard clutter
- `internal_review`
  - used for local diagnosis and internal comparison
  - can be lighter-weight, but still should follow the same visual discipline if it may later be promoted

## Style contract

Prefer the bundled Matplotlib style asset when plotting in Python:

- `assets/deepscientist-academic.mplstyle` (in this skill's folder; use its absolute path, since the skill folder is linked into the project)

If you need a custom script, start from that style instead of inventing a fresh bright theme.

Default visual rules:

- white or near-white background
- muted Morandi palette only
- no neon colors
- no rainbow / jet-like colormaps
- no heavy shadows, glossy gradients, or thick black borders
- top and right spines removed unless a special plot truly needs them
- light grid only when it helps reading values
- legend minimal; prefer direct labeling when it is clearer
- main method should be visually dominant
- baseline or comparison lines should be slightly more neutral than the main method

## Chart selection

Choose the chart by the research question:

- line chart
  - trends over steps, epochs, budgets, or ordered scales
- bar chart
  - a small number of categorical end-point comparisons with a meaningful zero baseline
- point-range / dot plot
  - comparisons where uncertainty, confidence intervals, or seed spread matter
- box / violin / histogram
  - only for true distribution questions with enough samples
- heatmap
  - only when the matrix structure itself is the result

Do not use heatmaps or crowded dashboards just because they look “richer”.

## Continuous color rules

- ordered magnitude -> sequential muted palette
- signed delta around zero or a reference -> diverging muted palette with a neutral midpoint
- categories -> discrete palette only

Avoid any colormap whose lightness jumps back and forth or whose hue changes overwhelm numeric ordering.

## Mandatory render-inspect-revise workflow

If a figure is intended for progress reporting, paper drafting, appendix use, or durable artifact storage, you must follow this sequence:

1. render a first draft
2. open the rendered figure yourself with the available file / image inspection capability
3. inspect the actual result, not just the plotting code
4. revise the figure if readability or composition is weak
5. re-export the final version

Do not treat a figure as final if you have not inspected the rendered result.
Do not assume “the code looks fine” means “the figure looks fine”.

## Mandatory self-review checklist

When reviewing the rendered figure, check at least:

- is the main message obvious in under a few seconds?
- are labels, units, and baselines explicit?
- is the legend unnecessary, too large, or blocking data?
- is the text still readable after realistic down-scaling?
- is the main method visually dominant and the comparison hierarchy clear?
- are line widths, marker sizes, and error bars balanced?
- are ticks too dense or labels colliding?
- is the grid too strong or completely unnecessary?
- would the figure still make sense in grayscale or for color-vision-deficient readers?
- does the figure avoid decorative clutter that does not help the claim?

If any answer is negative, revise before calling the figure complete.

## Export discipline

- `progress_update`
  - normally export `png`
  - keep the message narrow and immediate
- `paper_main`
  - export `pdf` or `svg`
  - also export one `png` preview for visual review and UI display
  - avoid rasterizing line art or text when vector output is possible
- `appendix`
  - usually export vector + preview as above

Prefer deterministic export names and record the generating script path.

## Durable recording

Whenever a figure is accepted as durable, record:

- source data path
- generating script path
- final export paths
- surface class
- the main claim or comparison the figure is meant to support
- one short note on what changed during the self-review fix pass

For paper work, keep a small figure catalog next to the figures (for example `Publication/paper/figures/figure_catalog.json`) with these fields, and keep it in sync.

## Suggested Python pattern

If plotting in Python, prefer:

- `plt.style.use("<absolute path to this skill>/assets/deepscientist-academic.mplstyle")`
- explicit figure size in inches
- explicit export of both vector and preview files when paper-facing

Do not rely entirely on defaults.

## Practical figure sizes

Use restrained paper-like sizes by default:

- small progress summary: around `5.2 x 3.2 in`
- single-column paper figure: around `3.5 x 2.4 in`
- double-column paper figure: around `7.2 x 3.2 in`

Adjust only when the content truly needs it.

## Related skills

- `inno-experiment-analysis`: decide which results and statistics a figure should show.
- `ml-paper-writing`: figure and caption guidance for the paper itself.
- `inno-figure-gen`: conceptual diagrams and teaser images (needs an image-generation API key); this skill is for data plots.

Adapted from DeepScientist's figure-polish skill (MIT).
