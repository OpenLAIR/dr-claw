// Claim-Evidence health — deterministic, pure functions.
//
// This module reports EVIDENCE HEALTH for traceability and research
// completeness. It NEVER mutates claim.status: scientific conclusion remains
// an explicit human/service action (Phase 3 §6/§9).

/**
 * Evidence health for a single claim.
 *
 * @param {object} claim  { id, importance }
 * @param {Array<{relation_type: string, strength: string}>} relations  claim-evidence links
 * @returns {{ health: string, evidenceCount: number, strengths: string[], hasContradictory: boolean }}
 *   health ∈ no_evidence | weak_only | partial | supported_by_evidence |
 *            has_contradictory_evidence | critical_missing_evidence
 */
export const claimEvidenceHealth = (claim, relations = []) => {
  const supports = relations.filter((r) => r.relation_type === 'supports');
  const contradicts = relations.filter((r) => r.relation_type === 'contradicts');
  const strengths = supports.map((r) => r.strength).filter(Boolean);

  const evidenceCount = relations.length;
  if (evidenceCount === 0) {
    return {
      health: claim.importance === 'core' ? 'critical_missing_evidence' : 'no_evidence',
      evidenceCount,
      strengths: [],
      hasContradictory: false,
    };
  }

  const hasContradictory = contradicts.length > 0;
  let health = 'supported_by_evidence';
  if (hasContradictory) {
    health = 'has_contradictory_evidence';
  } else if (strengths.length === 0 || strengths.every((s) => s === 'weak')) {
    health = 'weak_only';
  } else if (strengths.some((s) => s === 'weak')) {
    // Mixed strengths: partially supported.
    health = 'partial';
  }

  return { health, evidenceCount, strengths, hasContradictory };
};

/**
 * Project-level evidence summary (Phase 3 §9).
 *
 * @param {Array<{id: string, importance: string, status: string}>} claims
 * @param {Array<{claim_id: string, relation_type: string, strength: string}>} claimEvidenceRows
 * @returns {object} counts used by the dashboard:
 *   coreClaimsTotal, coreClaimsMissingEvidence, claimsWithContradictoryEvidence,
 *   claimsSupported, claimsPartial, claimsWithEvidence
 */
export const projectEvidenceSummary = (claims = [], claimEvidenceRows = []) => {
  const byClaim = new Map();
  for (const row of claimEvidenceRows) {
    if (!byClaim.has(row.claim_id)) byClaim.set(row.claim_id, []);
    byClaim.get(row.claim_id).push(row);
  }

  let coreClaimsTotal = 0;
  let coreClaimsMissingEvidence = 0;
  let claimsWithContradictoryEvidence = 0;
  let claimsSupported = 0;
  let claimsPartial = 0;
  let claimsWithEvidence = 0;

  for (const claim of claims) {
    if (claim.archived_at) continue;
    const relations = byClaim.get(claim.id) || [];
    const health = claimEvidenceHealth(claim, relations);
    if (claim.importance === 'core') {
      coreClaimsTotal += 1;
      if (health.evidenceCount === 0) coreClaimsMissingEvidence += 1;
    }
    if (health.hasContradictory) claimsWithContradictoryEvidence += 1;
    if (health.health === 'supported_by_evidence' || health.health === 'partial') claimsPartial += 1;
    if (health.health === 'supported_by_evidence') claimsSupported += 1;
    if (health.evidenceCount > 0) claimsWithEvidence += 1;
  }

  return {
    coreClaimsTotal,
    coreClaimsMissingEvidence,
    claimsWithContradictoryEvidence,
    claimsSupported,
    claimsPartial,
    claimsWithEvidence,
  };
};
