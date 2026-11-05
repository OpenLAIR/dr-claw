import { describe, expect, it } from 'vitest';
import { projectSessions, projectSummary, sortProjects } from '../projectSummary';
import { flattenFiles } from '../overviewData';
import type { Project } from '../../../../types/app';
const project = (extra: Partial<Project> = {}): Project => ({ name: 'research', displayName: 'Research', fullPath: '/work/research', ...extra });

describe('project workbench summaries', () => {
  it('distinguishes absent plan data from measured zero progress', () => {
    expect(projectSummary(project())).toMatchObject({ total: null, completed: null, progress: null });
    expect(projectSummary(project({ taskmaster: { metadata: { taskCount: 5, completed: 0 } } }))).toMatchObject({ total: 5, completed: 0, progress: 0 });
  });
  it('rejects non-finite and negative progress data', () => {
    expect(projectSummary(project({ taskmaster: { metadata: { completionPercentage: NaN, completed: -1 } } }))).toMatchObject({ progress: null, completed: null });
  });
  it('uses all providers and retains provider identity when finding the most recent session', () => {
    const sessions = projectSessions(project({ sessions: [{ id: 'claude', updated_at: '2026-10-01' }], codexSessions: [{ id: 'codex', lastActivity: '2026-10-20' }], nanoSessions: [{ id: 'nano', createdAt: 'invalid' }] }));
    expect(sessions.map(session => [session.id, session.__provider])).toEqual([['codex', 'codex'], ['claude', 'claude'], ['nano', 'nano']]);
  });
  it('prioritizes blocked work and active work without mutating project order', () => {
    const projects = [project({ name: 'recent', createdAt: '2026-10-20' }), project({ name: 'running', sessions: [{ id: 'active' }] }), project({ name: 'blocked', taskmaster: { status: 'blocked' } })];
    expect(sortProjects(projects, new Set(['active'])).map(p => p.name)).toEqual(['blocked', 'running', 'recent']);
    expect(projects[0].name).toBe('recent');
  });
  it('prioritizes an active retry over an older failed run and ignores cancelled work', () => {
    expect(projectSummary(project(), new Set(), { state: 'ready', activeRun: { status: 'running' }, latestRun: { status: 'failed' } })).toMatchObject({ running: true, needsAttention: false });
    expect(projectSummary(project(), new Set(), { state: 'ready', latestRun: { status: 'cancelled' } })).toMatchObject({ running: false, needsAttention: false });
    expect(projectSummary(project(), new Set(), { state: 'error', latestRun: { status: 'failed' } })).toMatchObject({ running: false, needsAttention: false });
  });
  it('derives percentage from available task counts and caps over-complete metadata', () => {
    expect(projectSummary(project({ taskmaster: { metadata: { taskCount: 4, completed: 1 } } })).progress).toBe(25);
    expect(projectSummary(project({ taskmaster: { metadata: { completionPercentage: 120 } } })).progress).toBe(100);
  });
  it('does not invent last activity for projects with no dates', () => {
    expect(projectSummary(project()).lastActivity).toBe(0);
  });
});

describe('research file evidence', () => {
  it('flattens actual files and strips only the project root prefix', () => {
    expect(flattenFiles([{ name: 'Publication', path: '/work/research/Publication', type: 'directory', children: [{ name: 'paper.md', path: '/work/research/Publication/paper.md', type: 'file' }] }], '/work/research')).toEqual([{ name: 'paper.md', path: '/work/research/Publication/paper.md', relativePath: 'Publication/paper.md', modified: undefined }]);
  });
  it('handles missing children and Windows paths without inventing files', () => {
    expect(flattenFiles([{ name: 'empty', path: 'C:\\work\\empty', type: 'directory' }], 'C:\\work')).toEqual([]);
    expect(flattenFiles([{ name: 'result.csv', path: 'C:\\work\\Experiment\\result.csv', type: 'file' }], 'C:\\work')[0].relativePath).toBe('Experiment/result.csv');
  });
});
