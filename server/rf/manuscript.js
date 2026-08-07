// Manuscript completeness — deterministic, pure functions.
// Workflow completeness only: no writing-quality or LLM judgment.

export const SECTION_RANK = {
  not_started: 0,
  outline: 1,
  draft: 2,
  internal_review: 3,
  revised: 4,
  final: 5,
};

/**
 * @param {object} ctx
 * @param {Array<{id, is_optional, status, archived_at}>} ctx.sections
 * @param {Array<{id}>} ctx.claims
 * @param {Array<{id, type}>} ctx.figuresTables
 * @param {Array<{sourceType, sourceId, targetType, targetId}>} ctx.links  serialized entity links
 */
export const manuscriptCompleteness = ({ sections = [], claims = [], figuresTables = [], links = [] } = {}) => {
  const activeSections = sections.filter((section) => !section.archived_at);
  const requiredSections = activeSections.filter((section) => !section.is_optional);
  const activeClaims = claims.filter((claim) => !claim.archived_at);
  const activeArtifacts = figuresTables.filter((artifact) => !artifact.archived_at);

  const countStatus = (status) => activeSections.filter((section) => section.status === status).length;
  const draftOrBetter = activeSections.filter((section) => SECTION_RANK[section.status] >= SECTION_RANK.draft);

  const requiredSectionsComplete = requiredSections.length > 0
    && requiredSections.every((section) => SECTION_RANK[section.status] >= SECTION_RANK.draft);

  // A claim/figure/table is "assigned" when a manuscript_section link points at it.
  const assignedClaimIds = new Set(
    links.filter((link) => link.sourceType === 'manuscript_section' && link.targetType === 'claim')
      .map((link) => link.targetId)
  );
  const assignedArtifactIds = new Set(
    links.filter((link) => link.sourceType === 'manuscript_section' && link.targetType === 'figure_table')
      .map((link) => link.targetId)
  );

  return {
    totalRequiredSections: requiredSections.length,
    totalSections: activeSections.length,
    sectionsNotStarted: countStatus('not_started'),
    sectionsDraftOrBetter: draftOrBetter.length,
    sectionsUnderReview: countStatus('internal_review'),
    sectionsFinal: countStatus('final'),
    requiredSectionsComplete,
    claimsNotAssignedToSection: activeClaims.filter((claim) => !assignedClaimIds.has(claim.id)).length,
    figuresNotAssignedToSection: activeArtifacts.filter((artifact) => artifact.type === 'figure' && !assignedArtifactIds.has(artifact.id)).length,
    tablesNotAssignedToSection: activeArtifacts.filter((artifact) => artifact.type === 'table' && !assignedArtifactIds.has(artifact.id)).length,
  };
};
