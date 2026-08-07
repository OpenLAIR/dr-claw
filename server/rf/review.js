// Internal review summary — deterministic, pure function.
// Never auto-resolves comments; resolve/reopen are explicit human actions.

/**
 * @param {Array<{severity, status, archived_at}>} comments
 */
export const reviewSummary = (comments = []) => {
  const active = comments.filter((comment) => !comment.archived_at);
  const open = (status) => status === 'open' || status === 'in_progress';
  return {
    total: active.length,
    openCritical: active.filter((comment) => open(comment.status) && comment.severity === 'critical').length,
    openMajor: active.filter((comment) => open(comment.status) && comment.severity === 'major').length,
    openMinor: active.filter((comment) => open(comment.status) && comment.severity === 'minor').length,
    resolvedComments: active.filter((comment) => comment.status === 'resolved').length,
    hasOpenCritical: active.some((comment) => open(comment.status) && comment.severity === 'critical'),
  };
};
