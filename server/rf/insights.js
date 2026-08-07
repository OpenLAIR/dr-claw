// ResearchFlow insights — pure functions, no I/O.
//
// Next Critical Action (PRODUCT_SPEC §14.3, Implementation Prompt §6):
//   deterministic priority ordering, one primary action returned.
//
// Project Health (Phase 2 §9): simple explainable states healthy / at_risk /
//   critical derived from observable state. No ML scoring, no arbitrary
//   decimal health scores. Reasons are stable codes the UI localizes.

import { PRIORITY_WEIGHTS } from './progress.js';

const PRIORITY_RANK = PRIORITY_WEIGHTS; // critical 4 > high 3 > medium 2 > low 1

const isDone = (task) => task.status === 'done' || task.status === 'cancelled';

const isBlockerTask = (task) => task.is_blocker === 1 || task.is_blocker === true || task.status === 'blocked';

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Parse a due/deadline value into a local-time Date. Date-only strings
 * ('YYYY-MM-DD') parse as UTC midnight in JS, which shifts a day in negative
 * UTC offsets — normalize them to local midnight instead.
 * @param {string|Date} value
 */
export const parseDateLocal = (value) => {
  if (value instanceof Date) return new Date(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  return new Date(value);
};

const diffDays = (from, to) => Math.round((startOfDay(to) - startOfDay(from)) / 86400000);

/** days from today until due (negative = overdue), or null when no due date. */
const daysUntilDue = (dueDate, today) => {
  if (!dueDate) return null;
  return diffDays(today, parseDateLocal(dueDate));
};

const byPriorityDesc = (a, b) => (PRIORITY_RANK[b.priority] || 1) - (PRIORITY_RANK[a.priority] || 1);

const firstByPriority = (tasks) => [...tasks].sort(byPriorityDesc)[0] || null;

const currentStageTasks = (tasks, currentStageId) =>
  currentStageId ? tasks.filter((task) => task.stage_id === currentStageId) : [];

/**
 * Deterministic Next Critical Action. Returns one primary action or null.
 *
 * Priority order:
 *  1. blocker in current stage
 *  2. overdue Critical task (any stage)
 *  3. task associated with an unfinished required gate of the current stage
 *  4. High/Critical task due within 7 days
 *  5. highest-priority In Progress task in current stage
 *  6. highest-priority Todo task in current stage
 *
 * @param {object} ctx
 * @param {object|null} ctx.currentStage       { id, name }
 * @param {Array<{is_required: number, is_passed: number}>} ctx.gates  current-stage gates
 * @param {Array<{id,title,stage_id,status,priority,due_date,is_blocker}>} ctx.tasks
 * @param {Date} [ctx.today]
 */
export const nextCriticalAction = ({ currentStage, gates = [], tasks = [], today = new Date() }) => {
  const stageTasks = currentStageTasks(tasks, currentStage?.id);
  const open = (list) => list.filter((task) => !isDone(task));

  // 1. blocker in current stage
  const blockers = open(stageTasks).filter(isBlockerTask);
  if (blockers.length > 0) {
    return action(1, firstByPriority(blockers), 'blocker_in_current_stage');
  }

  // 2. overdue Critical task (any stage)
  const overdueCritical = open(tasks)
    .filter((task) => task.priority === 'critical')
    .filter((task) => daysUntilDue(task.due_date, today) !== null && daysUntilDue(task.due_date, today) < 0)
    .sort((a, b) => daysUntilDue(a.due_date, today) - daysUntilDue(b.due_date, today));
  if (overdueCritical.length > 0) {
    return action(2, overdueCritical[0], 'overdue_critical_task');
  }

  // 3. task associated with an unfinished required gate (current stage has open
  //    required gates; tasks bound to the stage are the work driving them)
  const hasUnfinishedRequiredGate = gates.some((gate) => gate.is_required && !gate.is_passed);
  if (hasUnfinishedRequiredGate) {
    const gateTasks = open(stageTasks);
    if (gateTasks.length > 0) {
      return action(3, firstByPriority(gateTasks), 'unfinished_required_gate');
    }
  }

  // 4. High/Critical task due within 7 days
  const dueSoon = open(tasks)
    .filter((task) => task.priority === 'high' || task.priority === 'critical')
    .filter((task) => {
      const days = daysUntilDue(task.due_date, today);
      return days !== null && days >= 0 && days <= 7;
    })
    .sort((a, b) => daysUntilDue(a.due_date, today) - daysUntilDue(b.due_date, today));
  if (dueSoon.length > 0) {
    return action(4, dueSoon[0], 'due_within_7_days');
  }

  // 5. highest-priority In Progress task in current stage
  const inProgress = firstByPriority(open(stageTasks).filter((task) => task.status === 'in_progress'));
  if (inProgress) {
    return action(5, inProgress, 'in_progress_current_stage');
  }

  // 6. highest-priority Todo task in current stage
  const todo = firstByPriority(open(stageTasks).filter((task) => task.status === 'todo'));
  if (todo) {
    return action(6, todo, 'todo_current_stage');
  }

  return null;
};

const action = (tier, task, reasonCode) => ({
  tier,
  taskId: task.id,
  title: task.title,
  reasonCode,
});

/**
 * Simple explainable project health.
 *
 * critical:  an overdue Critical task exists, or an open blocker task exists
 *            AND the deadline has passed.
 * at_risk:   an open blocker task exists, or an overdue High task exists, or
 *            the deadline is within 7 days, or the current stage has
 *            unfinished required gates with no open task driving them.
 * healthy:   otherwise.
 *
 * @param {object} ctx
 * @param {string|null} ctx.deadline           ISO date string or null
 * @param {Array<{id,title,status,priority,due_date,is_blocker}>} ctx.tasks
 * @param {Array<{is_required: number, is_passed: number}>} ctx.gates    current-stage gates
 * @param {Date} [ctx.today]
 * @returns {{ state: 'healthy'|'at_risk'|'critical', reasons: Array<{code: string, taskId?: string, taskTitle?: string}> }}
 */
export const projectHealth = ({ deadline = null, tasks = [], gates = [], today = new Date() }) => {
  const open = (list) => list.filter((task) => !isDone(task));
  const blockers = open(tasks).filter(isBlockerTask);
  const overdue = (priority) => open(tasks)
    .filter((task) => task.priority === priority)
    .filter((task) => daysUntilDue(task.due_date, today) !== null && daysUntilDue(task.due_date, today) < 0);

  const reasons = [];
  const deadlineDays = deadline ? daysUntilDue(deadline, today) : null;

  const overdueCritical = overdue('critical');
  const deadlinePassed = deadlineDays !== null && deadlineDays < 0;

  if (overdueCritical.length > 0) {
    reasons.push({
      code: 'overdue_critical',
      taskId: overdueCritical[0].id,
      taskTitle: overdueCritical[0].title,
    });
  } else if (blockers.length > 0 && deadlinePassed) {
    reasons.push({
      code: 'blocker_with_expired_deadline',
      taskId: blockers[0].id,
      taskTitle: blockers[0].title,
    });
  }

  if (reasons.length === 0) {
    if (blockers.length > 0) {
      reasons.push({ code: 'open_blocker', taskId: blockers[0].id, taskTitle: blockers[0].title });
    } else if (overdue('high').length > 0) {
      reasons.push({ code: 'overdue_high', taskId: overdue('high')[0].id, taskTitle: overdue('high')[0].title });
    } else if (deadlineDays !== null && deadlineDays <= 7) {
      // Approaching OR already-past deadline (a past deadline is strictly worse
      // than one within 7 days).
      reasons.push({ code: 'deadline_within_7_days' });
    } else if (gates.some((gate) => gate.is_required && !gate.is_passed)) {
      // Unfinished required gates with zero open tasks = no visible progress.
      if (open(tasks).length === 0) {
        reasons.push({ code: 'unfinished_required_gates_no_progress' });
      }
    }
  }

  if (reasons.length === 0) {
    return { state: 'healthy', reasons: [] };
  }
  const state = reasons.some((r) => r.code === 'overdue_critical' || r.code === 'blocker_with_expired_deadline')
    ? 'critical'
    : 'at_risk';
  return { state, reasons };
};
