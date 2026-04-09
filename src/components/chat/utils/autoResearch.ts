/**
 * Check whether a scenario ID represents an autoresearch workflow.
 */
export function isAutoResearchScenario(scenarioId: string | undefined | null): boolean {
  return typeof scenarioId === 'string' && scenarioId.startsWith('autoresearch-');
}
