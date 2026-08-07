// ResearchFlow domain tests — pure service-level coverage with an isolated
// temporary-file database. No HTTP, no real HOME, no ~/.gemini / ~/.claude.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runResearchFlowMigrations, createResearchFlowServiceFor } from '../rf/index.js';
import { RfConflictError, RfValidationError, RfNotFoundError } from '../rf/errors.js';
import { DEFAULT_LIFECYCLE } from '../rf/lifecycle.js';

const USER_ID = 1;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let tmpDir;
let dbPath;
let db;
let service;

const reopenDb = () => {
  if (db) db.close();
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  runResearchFlowMigrations(db);
  service = createResearchFlowServiceFor(db);
  return db;
};

const createProject = () => service.createProject(USER_ID, { name: 'Test Project' });

const passAllGates = (projectId, stage) => {
  for (const gate of stage.gates) {
    service.patchGate(USER_ID, gate.id, { isPassed: true });
  }
};

beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'rf-domain-'));
  dbPath = path.join(tmpDir, 'rf.db');
  reopenDb();
});

afterAll(async () => {
  if (db) db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

describe('ResearchFlow domain core', () => {
  it('creates a project with a stable UUID and 10 stages', () => {
    const detail = createProject();
    expect(detail.project.id).toMatch(UUID_RE);
    expect(detail.stages).toHaveLength(10);
    expect(detail.stages[0].status).toBe('current');
    expect(detail.currentStageId).toBe(detail.stages[0].id);

    const keys = detail.stages.map((stage) => stage.key);
    expect(new Set(keys).size).toBe(10);
    expect(keys).toEqual(DEFAULT_LIFECYCLE.map((template) => template.key));
  });

  it('initialization is idempotent across projects (no duplicate stages/gates)', () => {
    const first = createProject();
    const second = createProject();
    expect(first.project.id).not.toBe(second.project.id);

    for (const detail of [first, second]) {
      expect(detail.stages).toHaveLength(10);
      const keys = detail.stages.map((stage) => stage.key);
      expect(new Set(keys).size).toBe(10);
      const gateCount = detail.stages.reduce((sum, stage) => sum + stage.gates.length, 0);
      expect(gateCount).toBe(63);
    }
  });

  it('project identity is stable across lookups', () => {
    const detail = createProject();
    const again = service.getProject(USER_ID, detail.project.id);
    expect(again.project.id).toBe(detail.project.id);
    expect(again.stages).toHaveLength(10);
  });

  it('required gates block stage completion until all are passed', () => {
    const { project, stages } = createProject();
    const stage = stages[0];

    expect(() => service.completeStage(USER_ID, stage.id)).toThrow(RfConflictError);

    passAllGates(project.id, stage);
    const completed = service.completeStage(USER_ID, stage.id);
    expect(completed.status).toBe('completed');

    // Completing again is idempotent.
    const again = service.completeStage(USER_ID, stage.id);
    expect(again.status).toBe('completed');

    // The next stage is automatically activated so the lifecycle keeps moving.
    const detail = service.getProject(USER_ID, project.id);
    expect(detail.stages[1].status).toBe('current');
  });

  it('unpassing a gate rolls back a completed stage', () => {
    const { project, stages } = createProject();
    const stage = stages[0];
    passAllGates(project.id, stage);
    service.completeStage(USER_ID, stage.id);

    service.patchGate(USER_ID, stage.gates[0].id, { isPassed: false });
    const detail = service.getProject(USER_ID, project.id);
    // The stage is reopened as the current stage (project returns to it).
    expect(detail.stages[0].status).toBe('current');

    // Re-pass everything and complete again.
    passAllGates(project.id, detail.stages[0]);
    const completed = service.completeStage(USER_ID, detail.stages[0].id);
    expect(completed.status).toBe('completed');
  });

  it('does not corrupt another project\'s current stage', () => {
    const first = createProject();
    const second = createProject();

    expect(first.stages[0].status).toBe('current');
    expect(second.stages[0].status).toBe('current');

    passAllGates(first.project.id, first.stages[0]);
    service.completeStage(USER_ID, first.stages[0].id);

    const firstDetail = service.getProject(USER_ID, first.project.id);
    const secondDetail = service.getProject(USER_ID, second.project.id);
    expect(firstDetail.stages[1].status).toBe('current');
    // The other project's stage must remain current (project-scoped demotion).
    expect(secondDetail.stages[0].status).toBe('current');
  });

  it('advance-stage moves current -> completed and activates the next stage', () => {
    const { project, stages } = createProject();
    const first = stages[0];
    passAllGates(project.id, first);

    const detail = service.advanceStage(USER_ID, project.id);
    expect(detail.stages[0].status).toBe('completed');
    expect(detail.stages[1].status).toBe('current');
    expect(detail.currentStageId).toBe(detail.stages[1].id);

    // Advancing again without passing the new stage's gates is rejected.
    expect(() => service.advanceStage(USER_ID, project.id)).toThrow(RfConflictError);
  });

  it('stage progress follows the 0.70/0.30 formula', () => {
    const { stages } = createProject();
    const stage = stages[0];

    // 0 required gates passed, no tasks -> 0.7*0 + 0.3*1 = 0.3
    expect(stage.progress).toBeCloseTo(0.3, 5);
    expect(stage.completed).toBe(false);

    // Pass 2 of 5 required gates -> 0.7*0.4 + 0.3*1 = 0.58
    service.patchGate(USER_ID, stage.gates[0].id, { isPassed: true });
    service.patchGate(USER_ID, stage.gates[1].id, { isPassed: true });
    const refreshed = service.getProject(USER_ID, stage.projectId);
    expect(refreshed.stages[0].progress).toBeCloseTo(0.58, 5);

    // All gates passed -> 1.0
    passAllGates(stage.projectId, refreshed.stages[0]);
    const done = service.getProject(USER_ID, stage.projectId);
    expect(done.stages[0].progress).toBeCloseTo(1.0, 5);
    expect(done.stages[0].completed).toBe(true);
  });

  it('task completion is priority-weighted', () => {
    const { project, stages } = createProject();
    const stageId = stages[0].id;

    service.createTask(USER_ID, project.id, { title: 'Heavy', priority: 'critical', stageId });
    service.createTask(USER_ID, project.id, { title: 'Light', priority: 'low', stageId });
    const { tasks } = service.listTasks(USER_ID, project.id);
    expect(tasks).toHaveLength(2);

    // critical done (4) of critical+low (4+1=5) -> weighted completion 0.8
    service.updateTask(USER_ID, tasks.find((task) => task.priority === 'critical').id, { status: 'done' });
    const detail = service.getProject(USER_ID, project.id);
    const stage = detail.stages.find((item) => item.id === stageId);
    // gates 0/5 -> 0.7*0 + 0.3*0.8 = 0.24
    expect(stage.progress).toBeCloseTo(0.24, 5);
  });

  it('task dependencies reject self, duplicates and cycles', () => {
    const { project, tasks } = createTaskPair();
    const [taskA, taskB] = tasks;

    // A depends on B — OK
    const dep = service.createDependency(USER_ID, taskA.id, { dependsOnTaskId: taskB.id });
    expect(dep.dependsOnTaskId).toBe(taskB.id);

    // self dependency — rejected
    expect(() => service.createDependency(USER_ID, taskA.id, { dependsOnTaskId: taskA.id }))
      .toThrow(RfValidationError);

    // duplicate — rejected
    expect(() => service.createDependency(USER_ID, taskA.id, { dependsOnTaskId: taskB.id }))
      .toThrow(RfConflictError);

    // cycle (B would depend on A while A depends on B) — rejected
    expect(() => service.createDependency(USER_ID, taskB.id, { dependsOnTaskId: taskA.id }))
      .toThrow(RfConflictError);

    const deps = service.listDependencies(USER_ID, project.id);
    expect(deps).toHaveLength(1);
  });

  it('task links enforce controlled relation types and uniqueness', () => {
    const { project, tasks } = createTaskPair();
    const task = tasks[0];

    const link = service.createTaskLink(USER_ID, task.id, {
      relationType: 'experiment',
      relationId: 'EXP-001',
    });
    expect(link.relationType).toBe('experiment');

    // Unknown relation type — rejected at the service layer.
    expect(() => service.createTaskLink(USER_ID, task.id, {
      relationType: 'banana',
      relationId: 'EXP-002',
    })).toThrow(RfValidationError);

    // Duplicate triple — rejected.
    expect(() => service.createTaskLink(USER_ID, task.id, {
      relationType: 'experiment',
      relationId: 'EXP-001',
    })).toThrow(RfConflictError);

    const links = service.listTaskLinks(USER_ID, project.id);
    expect(links).toHaveLength(1);
  });

  it('activity log records key mutations', () => {
    const { project, stages } = createProject();

    const created = service.listActivity(USER_ID, project.id);
    expect(created.some((entry) => entry.action === 'project_created')).toBe(true);

    service.patchGate(USER_ID, stages[0].gates[0].id, { isPassed: true });
    service.patchGate(USER_ID, stages[0].gates[0].id, { isPassed: false });
    const task = service.createTask(USER_ID, project.id, { title: 'Log me' });
    service.updateTask(USER_ID, task.id, { status: 'blocked' });
    service.updateTask(USER_ID, task.id, { status: 'done' });

    const entries = service.listActivity(USER_ID, project.id);
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain('gate_passed');
    expect(actions).toContain('gate_unpassed');
    expect(actions).toContain('task_created');
    expect(actions).toContain('task_blocked');
    expect(actions).toContain('task_completed');
  });

  it('data survives a database reopen', () => {
    const detail = createProject();
    const task = service.createTask(USER_ID, detail.project.id, { title: 'Persisted' });

    reopenDb();

    const reloaded = service.getProject(USER_ID, detail.project.id);
    expect(reloaded.project.id).toBe(detail.project.id);
    expect(reloaded.stages).toHaveLength(10);
    const { tasks } = service.listTasks(USER_ID, detail.project.id);
    expect(tasks.some((item) => item.id === task.id)).toBe(true);
  });

  it('migration rerun is a no-op', () => {
    const applied = runResearchFlowMigrations(db);
    expect(applied).toBe(0);
  });

  it('archived projects are hidden and inaccessible', () => {
    const detail = createProject();
    service.archiveProject(USER_ID, detail.project.id);

    const projects = service.listProjects(USER_ID);
    expect(projects.some((project) => project.id === detail.project.id)).toBe(false);

    expect(() => service.getProject(USER_ID, detail.project.id)).toThrow(RfNotFoundError);
    expect(() => service.getProject(USER_ID + 999, detail.project.id)).toThrow(RfNotFoundError);
  });
});

const createTaskPair = () => {
  const { project } = createProject();
  const taskA = service.createTask(USER_ID, project.id, { title: 'Task A' });
  const taskB = service.createTask(USER_ID, project.id, { title: 'Task B' });
  return { project, tasks: [taskA, taskB] };
};
