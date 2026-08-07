// ResearchFlow domain entry point.
//
// Wiring helpers for production (server/index.js) and tests:
//   const service = createResearchFlowServiceFor(db);

import { createResearchFlowRepository } from './repositories.js';
import { createResearchFlowService } from './service.js';
import { runResearchFlowMigrations, getRegisteredMigrations } from './migrations.js';

/**
 * Build the full ResearchFlow service stack on top of a better-sqlite3 db.
 * Tests inject their own isolated db instance here.
 */
export const createResearchFlowServiceFor = (dbInstance) => {
  const repo = createResearchFlowRepository(dbInstance);
  return createResearchFlowService({ db: dbInstance, repo });
};

export {
  runResearchFlowMigrations,
  getRegisteredMigrations,
  createResearchFlowRepository,
  createResearchFlowService,
};
