// Stage gate list: pass/un-pass required gates via the Phase 1 API. The stage
// completion invariant lives on the server; this UI never fakes it — a 409 from
// the backend is surfaced verbatim.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';

export default function StageGatePanel({ gates = [], stageStatus, onToggleGate, onCompleteStage, busy }) {
  const { t } = useTranslation(['researchflow', 'common']);
  if (gates.length === 0) return null;

  const allRequiredPassed = gates.filter((gate) => gate.isRequired).every((gate) => gate.isPassed);
  const isCompleted = stageStatus === 'completed';

  return (
    <div className="space-y-1">
      {gates.map((gate) => (
        <button
          key={gate.id}
          type="button"
          disabled={busy}
          onClick={() => onToggleGate(gate)}
          className={`w-full flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition-colors disabled:opacity-60 ${
            gate.isPassed
              ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/10'
              : 'border-border hover:bg-accent'
          }`}
          aria-pressed={gate.isPassed}
        >
          <span
            className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
              gate.isPassed
                ? 'border-emerald-500 bg-emerald-500 text-white'
                : 'border-muted-foreground/40'
            }`}
          >
            {gate.isPassed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3 opacity-50" />}
          </span>
          <span className="flex-1">
            <span className={gate.isPassed ? 'text-muted-foreground line-through' : 'text-foreground'}>
              {gate.title}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              {gate.isRequired ? t('roadmap.requiredGates') : ''}
            </span>
          </span>
        </button>
      ))}

      {onCompleteStage && !isCompleted && (
        <button
          type="button"
          disabled={busy || !allRequiredPassed}
          onClick={onCompleteStage}
          className="mt-2 w-full rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
          title={allRequiredPassed ? '' : t('roadmap.cannotComplete')}
        >
          {t('roadmap.markComplete')}
        </button>
      )}
      {isCompleted && (
        <p className="pt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          {t('roadmap.stageCompleted')}
        </p>
      )}
    </div>
  );
}
