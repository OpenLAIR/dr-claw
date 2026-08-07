// ResearchFlow progress domain — pure functions, no I/O.
//
// PRODUCT_SPEC §14:
//   StageProgress = 0.70 × RequiredGateCompletion + 0.30 × WeightedTaskCompletion
//   Stage Completed ⟺ ALL required gates are passed
//
// These functions are the single source of truth; the UI must never re-implement
// them (Implementation Prompt §5). Task weighting uses priority: critical 4,
// high 3, medium 2, low 1.

// --- Task priority weights --------------------------------------------------

export const PRIORITY_WEIGHTS = { critical: 4, high: 3, medium: 2, low: 1 };

/**
 * Fraction of required gates passed, in [0, 1].
 * @param {Array<{is_required: number, is_passed: number}>} gates
 */
export const requiredGateCompletion = (gates) => {
  const required = gates.filter((gate) => gate.is_required);
  if (required.length === 0) return 0;
  const passed = required.filter((gate) => gate.is_passed).length;
  return passed / required.length;
};

/**
 * Fraction of task weight completed, in [0, 1].
 * - Only non-cancelled tasks count toward the denominator.
 * - A stage with no tasks returns 1 (neutral: an empty task list must not drag
 *   stage progress down).
 * @param {Array<{status: string, priority: string}>} tasks
 */
export const weightedTaskCompletion = (tasks) => {
  const relevant = tasks.filter((task) => task.status !== 'cancelled');
  if (relevant.length === 0) return 1;
  const weightOf = (task) => PRIORITY_WEIGHTS[task.priority] || 1;
  const total = relevant.reduce((sum, task) => sum + weightOf(task), 0);
  const done = relevant
    .filter((task) => task.status === 'done')
    .reduce((sum, task) => sum + weightOf(task), 0);
  return total === 0 ? 1 : done / total;
};

/**
 * Stage visual progress in [0, 1] (PRODUCT_SPEC §14.2).
 * @param {Array<{is_required: number, is_passed: number}>} gates
 * @param {Array<{status: string, priority: string}>} tasks
 */
export const stageProgress = (gates, tasks) => {
  return 0.70 * requiredGateCompletion(gates) + 0.30 * weightedTaskCompletion(tasks);
};

/**
 * Stage completion is a state-machine condition, not a visual percentage:
 * ALL required gates must be passed. Tasks alone can never complete a stage.
 * @param {Array<{is_required: number, is_passed: number}>} gates
 */
export const isStageCompleted = (gates) => {
  const required = gates.filter((gate) => gate.is_required);
  if (required.length === 0) return false;
  return required.every((gate) => gate.is_passed);
};

/**
 * Overall project progress in [0, 1] (PRODUCT_SPEC §14.1): weighted sum of
 * stage progress over the total weight of non-skipped stages.
 * @param {Array<{weight: number, status: string, progress: number}>} stages
 *   - completed stages contribute 1
 *   - current stage contributes its visual progress
 *   - pending stages contribute 0
 *   - skipped stages are excluded from the denominator
 */
export const overallProgress = (stages) => {
  const considered = stages.filter((stage) => stage.status !== 'skipped');
  const totalWeight = considered.reduce((sum, stage) => sum + stage.weight, 0);
  if (totalWeight === 0) return 0;
  const numerator = considered.reduce((sum, stage) => {
    const value = stage.status === 'completed' ? 1 : stage.progress;
    return sum + stage.weight * value;
  }, 0);
  return numerator / totalWeight;
};
