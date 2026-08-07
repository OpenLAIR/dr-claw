// Experiment run aggregation — deterministic, pure function.
//
// Summarizes an experiment from its runs. It reports observable counts only
// and NEVER invents statistical/scientific conclusions (Phase 3 §5): e.g.
// "4 completed, 1 failed" does not imply the hypothesis is supported.

/**
 * @param {Array<{status: string, seed: string|null, metrics_json: string|null}>} runs
 * @returns {object} summary
 */
export const summarizeExperiment = (runs = []) => {
  const count = (status) => runs.filter((run) => run.status === status).length;
  const seeds = [...new Set(runs.map((run) => run.seed).filter(Boolean))];

  const completed = count('completed');
  const failed = count('failed');
  const running = count('running');

  return {
    total: runs.length,
    planned: count('planned'),
    running,
    completed,
    failed,
    cancelled: count('cancelled'),
    seeds,
    seedCount: seeds.length,
    hasMetrics: runs.some((run) => run.metrics_json),
    completionState: totalState(count, runs.length),
    failureState: failed > 0,
    // Observability note for humans only — never an automatic conclusion.
    allRunsFinished: runs.length > 0 && runs.every((run) => run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled'),
  };
};

const totalState = (count, total) => {
  if (total === 0) return 'none';
  if (count('completed') === total) return 'all_completed';
  if (count('running') > 0) return 'in_progress';
  return 'partial';
};
