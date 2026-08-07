// Submission readiness — deterministic, pure function.
// Ready is DERIVED and reversible; Submitted is a historical human action and
// is never auto-reverted (handled by the service, not here).

/**
 * @param {object} ctx
 * @param {Array<{required, status, archived_at}>} ctx.items           checklist items
 * @param {'none'|'current'|'stale'} ctx.freezeState                   latest freeze state
 * @param {boolean} ctx.requiredSectionsComplete                       manuscript completeness
 * @param {number} ctx.coreClaimsMissingEvidence                       from evidence summary
 * @param {boolean} ctx.hasOpenCriticalReview                          from review summary
 * @param {{required: number, passed: number}|null} ctx.submissionStageGates
 * @returns {{ready: boolean, blockers: Array<{code: string, message: string}>}}
 */
export const submissionReadiness = ({
  items = [],
  freezeState = 'none',
  requiredSectionsComplete = false,
  coreClaimsMissingEvidence = 0,
  hasOpenCriticalReview = false,
  submissionStageGates = null,
} = {}) => {
  const blockers = [];

  const requiredItems = items.filter((item) => item.required && !item.archived_at);
  const incompleteRequired = requiredItems.filter((item) => item.status !== 'done' && item.status !== 'waived');
  if (incompleteRequired.length > 0) {
    blockers.push({
      code: 'checklist_incomplete',
      message: `${incompleteRequired.length} required checklist item(s) incomplete`,
      count: incompleteRequired.length,
    });
  }

  if (freezeState === 'none') {
    blockers.push({ code: 'no_valid_freeze', message: 'No valid Results Freeze exists' });
  } else if (freezeState === 'stale') {
    blockers.push({ code: 'freeze_stale', message: 'Results Freeze is stale' });
  }

  if (!requiredSectionsComplete) {
    blockers.push({ code: 'manuscript_incomplete', message: 'Required manuscript sections are not all at draft or better' });
  }

  if (hasOpenCriticalReview) {
    blockers.push({ code: 'critical_review_comments_open', message: 'Unresolved Critical review comment(s) exist' });
  }

  if (coreClaimsMissingEvidence > 0) {
    blockers.push({ code: 'core_claim_missing_evidence', message: `${coreClaimsMissingEvidence} core claim(s) missing evidence` });
  }

  if (submissionStageGates && submissionStageGates.required > 0 && submissionStageGates.passed !== submissionStageGates.required) {
    blockers.push({
      code: 'submission_stage_gates_incomplete',
      message: 'Submission stage required gates are incomplete',
      passed: submissionStageGates.passed,
      required: submissionStageGates.required,
    });
  }

  return { ready: blockers.length === 0, blockers };
};
