// Phase 2 task list: create tasks, flip status/priority, mark blockers.
// Mutations go through /api/rf/*; the parent refreshes dashboard state after.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Plus } from 'lucide-react';

const STATUS_OPTIONS = ['backlog', 'todo', 'in_progress', 'blocked', 'done', 'cancelled'];
const PRIORITY_OPTIONS = ['critical', 'high', 'medium', 'low'];

const STATUS_DOT = {
  backlog: 'bg-muted-foreground/40',
  todo: 'bg-muted-foreground',
  in_progress: 'bg-primary',
  blocked: 'bg-red-500',
  done: 'bg-emerald-500',
  cancelled: 'bg-muted-foreground/30',
};

const PRIORITY_CLASS = {
  critical: 'text-red-600 dark:text-red-400',
  high: 'text-amber-600 dark:text-amber-400',
  medium: 'text-muted-foreground',
  low: 'text-muted-foreground/60',
};

export default function Tasks({ tasks = [], stages = [], projectId, onCreate, onUpdate, busy }) {
  const { t } = useTranslation('researchflow');
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [stageId, setStageId] = useState('');
  const [isBlocker, setIsBlocker] = useState(false);

  const handleCreate = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    await onCreate({ title: trimmed, priority, stageId: stageId || undefined, isBlocker });
    setTitle('');
    setPriority('medium');
    setStageId('');
    setIsBlocker(false);
    setShowForm(false);
  };

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-bold text-foreground">{t('tasks.title')}</h3>
        <button
          type="button"
          onClick={() => setShowForm((value) => !value)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:bg-accent"
        >
          <Plus className="h-4 w-4" />
          {t('tasks.newTask')}
        </button>
      </div>

      {showForm && (
        <div className="mb-3 space-y-2 rounded-lg border border-border bg-card p-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('tasks.titleLabel')}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
            autoFocus
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option} value={option}>{t(`tasks.priority_${option}`)}</option>
              ))}
            </select>
            <select
              value={stageId}
              onChange={(event) => setStageId(event.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">—</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>{stage.name}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={isBlocker} onChange={(event) => setIsBlocker(event.target.checked)} />
              {t('tasks.blocker')}
            </label>
            <div className="flex-1" />
            <button
              type="button"
              onClick={handleCreate}
              disabled={!title.trim() || busy}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {t('tasks.create')}
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {tasks.length === 0 && !showForm ? (
          <p className="text-sm text-muted-foreground">{t('tasks.noTasks')}</p>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2">
              <span className={`h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT[task.status] || 'bg-muted-foreground'}`} />
              <span className={`min-w-0 flex-1 truncate text-sm ${task.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                {task.title}
              </span>
              {task.isBlocker && <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-red-500" />}
              <span className={`flex-shrink-0 text-xs font-medium ${PRIORITY_CLASS[task.priority] || ''}`}>
                {t(`tasks.priority_${task.priority}`)}
              </span>
              {task.dueDate && (
                <span className="flex-shrink-0 text-xs text-muted-foreground">{task.dueDate.slice(0, 10)}</span>
              )}
              <select
                value={task.status}
                disabled={busy}
                onChange={(event) => onUpdate(task.id, { status: event.target.value })}
                className="flex-shrink-0 rounded-md border border-border bg-background px-1.5 py-1 text-xs"
                aria-label={t('tasks.status')}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>{t(`tasks.status_${option}`)}</option>
                ))}
              </select>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
