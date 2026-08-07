// Activity log writer. Always called inside the same transaction as the state
// mutation it records (see service.js) so a successful mutation can never lose
// its audit trail (Implementation Prompt §9).

import { randomUUID } from 'node:crypto';

/**
 * Insert one activity entry. Must be invoked within an active transaction when
 * describing a state mutation (the service layer guarantees this).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} entry
 * @param {string} entry.projectId
 * @param {string} entry.action          e.g. 'project_created' | 'stage_changed' | 'gate_passed'
 * @param {string} [entry.entityType]    e.g. 'project' | 'stage' | 'gate' | 'task'
 * @param {string} [entry.entityId]
 * @param {string} [entry.message]
 * @param {object} [entry.metadata]
 */
export const logActivity = (db, { projectId, action, entityType, entityId, message, metadata }) => {
  db.prepare(`
    INSERT INTO rf_activity_log (id, project_id, action, entity_type, entity_id, message, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    projectId,
    action,
    entityType || null,
    entityId || null,
    message || null,
    metadata ? JSON.stringify(metadata) : null
  );
};
