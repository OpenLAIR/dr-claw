// ResearchFlow insights tests — pure-function coverage for Next Critical Action
// priority ordering and Project Health states (Phase 2 §8/§9).

import { describe, it, expect } from 'vitest';
import { nextCriticalAction, projectHealth } from '../rf/insights.js';

const TODAY = new Date('2026-08-07T12:00:00');

// ISO date helpers relative to TODAY
const inDays = (n) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const task = (overrides = {}) => ({
  id: 'T-1',
  title: 'Task',
  stage_id: 'STAGE-CURRENT',
  status: 'todo',
  priority: 'medium',
  due_date: null,
  is_blocker: 0,
  ...overrides,
});

const currentStage = { id: 'STAGE-CURRENT', name: 'Idea Locked' };
const gatesAllOpen = [
  { id: 'G1', title: 'RQ defined', is_required: 1, is_passed: 0 },
  { id: 'G2', title: 'Motivation', is_required: 1, is_passed: 0 },
];
const gatesAllPassed = gatesAllOpen.map((gate) => ({ ...gate, is_passed: 1 }));

const nca = (tasks, { stage = currentStage, gates = gatesAllPassed } = {}) =>
  nextCriticalAction({ currentStage: stage, gates, tasks, today: TODAY });

describe('nextCriticalAction', () => {
  it('returns null when there is nothing to do', () => {
    expect(nca([])).toBeNull();
    expect(nca([task({ status: 'done' }), task({ status: 'cancelled' })])).toBeNull();
  });

  it('tier 1: a blocker in the current stage beats an overdue critical task', () => {
    const result = nca([
      task({ id: 'BLK', title: 'Blocker', is_blocker: 1, priority: 'low' }),
      task({ id: 'OVR', title: 'Overdue', priority: 'critical', due_date: inDays(-2) }),
    ]);
    expect(result.tier).toBe(1);
    expect(result.taskId).toBe('BLK');
    expect(result.reasonCode).toBe('blocker_in_current_stage');
  });

  it('tier 1: a blocked-status task counts as a blocker', () => {
    const result = nca([task({ id: 'STUCK', title: 'Stuck', status: 'blocked' })]);
    expect(result.tier).toBe(1);
    expect(result.taskId).toBe('STUCK');
  });

  it('tier 2: overdue critical beats 7-day due high-priority tasks', () => {
    const result = nca([
      task({ id: 'SOON', title: 'Soon', priority: 'high', due_date: inDays(2) }),
      task({ id: 'LATE', title: 'Late', priority: 'critical', due_date: inDays(-1) }),
    ]);
    expect(result.tier).toBe(2);
    expect(result.taskId).toBe('LATE');
  });

  it('tier 2: the most overdue critical task wins', () => {
    const result = nca([
      task({ id: 'LATE1', title: 'Late 1', priority: 'critical', due_date: inDays(-1) }),
      task({ id: 'LATE3', title: 'Late 3', priority: 'critical', due_date: inDays(-3) }),
    ]);
    expect(result.tier).toBe(2);
    expect(result.taskId).toBe('LATE3');
  });

  it('tier 3: an unfinished required gate promotes the stage task above due-soon tasks', () => {
    const result = nca(
      [
        task({ id: 'SOON', title: 'Soon', priority: 'high', due_date: inDays(3), stage_id: 'STAGE-OTHER' }),
        task({ id: 'GATE', title: 'Gate work', priority: 'medium' }),
      ],
      { gates: gatesAllOpen }
    );
    expect(result.tier).toBe(3);
    expect(result.taskId).toBe('GATE');
  });

  it('tier 3: skipped when all required gates are passed', () => {
    const result = nca(
      [
        task({ id: 'SOON', title: 'Soon', priority: 'high', due_date: inDays(3) }),
        task({ id: 'GATE', title: 'Gate work', priority: 'medium' }),
      ],
      { gates: gatesAllPassed }
    );
    expect(result.tier).toBe(4);
    expect(result.taskId).toBe('SOON');
  });

  it('tier 4: High/Critical due within 7 days beats in-progress and todo', () => {
    const result = nca([
      task({ id: 'IP', title: 'In progress', status: 'in_progress', priority: 'high' }),
      task({ id: 'SOON', title: 'Due soon', priority: 'high', due_date: inDays(5) }),
    ]);
    expect(result.tier).toBe(4);
    expect(result.taskId).toBe('SOON');
  });

  it('tier 5: in-progress beats todo within the current stage', () => {
    const result = nca([
      task({ id: 'TODO', title: 'Todo', priority: 'critical' }),
      task({ id: 'IP', title: 'In progress', status: 'in_progress', priority: 'medium' }),
    ]);
    expect(result.tier).toBe(5);
    expect(result.taskId).toBe('IP');
  });

  it('tier 6: highest-priority todo in the current stage is the fallback', () => {
    const result = nca([
      task({ id: 'LOW', title: 'Low', priority: 'low' }),
      task({ id: 'CRIT', title: 'Critical', priority: 'critical' }),
    ]);
    expect(result.tier).toBe(6);
    expect(result.taskId).toBe('CRIT');
  });

  it('only tasks of the current stage qualify for tiers 1/3/5/6', () => {
    const result = nca([
      task({ id: 'OTHER', title: 'Other stage todo', stage_id: 'STAGE-OTHER', priority: 'critical' }),
    ]);
    expect(result).toBeNull();
  });

  it('without a current stage only global tiers (2/4) apply', () => {
    const result = nca([task({ id: 'LATE', title: 'Late', priority: 'critical', due_date: inDays(-1) })], {
      stage: null,
    });
    expect(result.tier).toBe(2);
  });
});

describe('projectHealth', () => {
  const health = (tasks, { deadline = null, gates = gatesAllOpen } = {}) =>
    projectHealth({ deadline, tasks, gates, today: TODAY });

  it('healthy with no problems', () => {
    const result = health([task({ status: 'done' })], { gates: gatesAllPassed });
    expect(result.state).toBe('healthy');
    expect(result.reasons).toEqual([]);
  });

  it('critical when a critical task is overdue', () => {
    const result = health([task({ id: 'LATE', priority: 'critical', due_date: inDays(-1) })]);
    expect(result.state).toBe('critical');
    expect(result.reasons[0].code).toBe('overdue_critical');
    expect(result.reasons[0].taskId).toBe('LATE');
  });

  it('critical when a blocker is open and the deadline has passed', () => {
    const result = health([task({ id: 'BLK', is_blocker: 1 })], { deadline: inDays(-2) });
    expect(result.state).toBe('critical');
    expect(result.reasons[0].code).toBe('blocker_with_expired_deadline');
  });

  it('at_risk with an open blocker and no expired deadline', () => {
    const result = health([task({ id: 'BLK', is_blocker: 1 })]);
    expect(result.state).toBe('at_risk');
    expect(result.reasons[0].code).toBe('open_blocker');
  });

  it('at_risk with an overdue high task', () => {
    const result = health([task({ id: 'HIGH', priority: 'high', due_date: inDays(-1) })]);
    expect(result.state).toBe('at_risk');
    expect(result.reasons[0].code).toBe('overdue_high');
  });

  it('at_risk when the deadline is within 7 days', () => {
    const result = health([], { deadline: inDays(4) });
    expect(result.state).toBe('at_risk');
    expect(result.reasons[0].code).toBe('deadline_within_7_days');
  });

  it('at_risk when the deadline has passed even with no other issues', () => {
    const result = health([], { deadline: inDays(-3), gates: gatesAllPassed });
    expect(result.state).toBe('at_risk');
    expect(result.reasons[0].code).toBe('deadline_within_7_days');
  });

  it('at_risk with unfinished required gates and zero open tasks', () => {
    const result = health([]);
    expect(result.state).toBe('at_risk');
    expect(result.reasons[0].code).toBe('unfinished_required_gates_no_progress');
  });

  it('not at_risk for open gates when work is already in progress', () => {
    const result = health([task({ id: 'W', title: 'Working' })]);
    expect(result.state).toBe('healthy');
  });

  it('critical takes precedence over at_risk reasons', () => {
    const result = health(
      [task({ id: 'LATE', priority: 'critical', due_date: inDays(-1) }), task({ id: 'BLK', is_blocker: 1 })],
      { deadline: inDays(4) }
    );
    expect(result.state).toBe('critical');
  });
});
