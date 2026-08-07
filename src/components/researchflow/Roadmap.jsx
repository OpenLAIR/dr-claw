// Roadmap — 10-stage lifecycle timeline. Stage status (completed/current/
// pending) comes from the backend; clicking a stage exposes its gates, related
// tasks and blockers. No stage logic is duplicated in React.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Circle, ListTodo, PlayCircle } from 'lucide-react';
import StageGatePanel from './StageGatePanel';
import Progress from './Progress';

const STATUS_ICON = {
  completed: CheckCircle2,
  current: PlayCircle,
  pending: Circle,
};

const STATUS_CLASS = {
  completed: 'text-emerald-500',
  current: 'text-primary',
  pending: 'text-muted-foreground/50',
};

export default function Roadmap({ stages, tasks = [], onToggleGate, onCompleteStage, busy }) {
  const { t } = useTranslation('researchflow');
  const [selectedId, setSelectedId] = useState(stages.find((stage) => stage.status === 'current')?.id ?? stages[0]?.id ?? null);
  const selected = stages.find((stage) => stage.id === selectedId) || null;

  const stageTasks = (stageId) => tasks.filter((task) => task.stageId === stageId);
  const stageBlockers = (stageId) => stageTasks(stageId).filter((task) => task.isBlocker || task.status === 'blocked');

  return (
    <div className="flex h-full flex-col gap-4 p-4 lg:flex-row">
      {/* Timeline */}
      <div className="lg:w-72 lg:flex-shrink-0 space-y-1.5">
        {stages.map((stage) => {
          const Icon = STATUS_ICON[stage.status] || Circle;
          const isSelected = stage.id === selectedId;
          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => setSelectedId(stage.id)}
              className={`w-full flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                isSelected ? 'border-primary/40 bg-accent' : 'border-border hover:bg-accent/50'
              }`}
            >
              <Icon className={`h-4 w-4 flex-shrink-0 ${STATUS_CLASS[stage.status] || ''}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{stage.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {stage.status === 'completed' && t('roadmap.completed')}
                  {stage.status === 'current' && t('roadmap.current')}
                  {stage.status === 'pending' && t('roadmap.pending')}
                  {' · '}
                  {t('roadmap.stageProgress', { progress: Math.round(stage.progress * 100) })}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Stage detail */}
      <div className="min-w-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card p-4">
        {selected ? (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-foreground">{selected.name}</h3>
              <div className="mt-2">
                <Progress value={selected.progress} />
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                {t('roadmap.requiredGates')}
              </div>
              <StageGatePanel
                gates={selected.gates}
                stageStatus={selected.status}
                onToggleGate={onToggleGate}
                onCompleteStage={selected.status === 'current' ? onCompleteStage : null}
                busy={busy}
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ListTodo className="h-3.5 w-3.5" />
                {t('roadmap.relatedTasks')}
              </div>
              {stageTasks(selected.id).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('roadmap.noTasks')}</p>
              ) : (
                <ul className="space-y-1">
                  {stageTasks(selected.id).map((task) => (
                    <li key={task.id} className="flex items-center gap-2 text-sm">
                      <span className={`flex h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                        task.status === 'done' ? 'bg-emerald-500' : task.status === 'blocked' ? 'bg-red-500' : 'bg-primary'
                      }`} />
                      <span className={task.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}>
                        {task.title}
                      </span>
                      {task.isBlocker && (
                        <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {stageBlockers(selected.id).length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                <div className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t('roadmap.blockers')}
                </div>
                <ul className="mt-1 space-y-0.5">
                  {stageBlockers(selected.id).map((task) => (
                    <li key={task.id}>• {task.title}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.noStage')}</p>
        )}
      </div>
    </div>
  );
}
