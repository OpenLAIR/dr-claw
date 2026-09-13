# Output versioning (Workflow M extract)

Write reports first as `.aris/meta/META_OPTIMIZATION_REPORT_<YYYYMMDD_HHmmss>.md`,
then copy to `.aris/meta/META_OPTIMIZATION_REPORT.md`. Preserve old reports.
Pending diffs are individually named and indexed in `pending/manifest.jsonl`.
Event, optimization and bottleneck JSONL ledgers are append-only, not timestamped
copies. Last-run markers are explicitly replaced only after a completed analysis.

Workflow M is maintenance, not a new research pipeline stage. It does not move
existing research outputs or migrate project layouts.
