// Explainable health badge. The state machine lives in server/rf/insights.js;
// this component only renders the result and its human-readable reasons.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';

const STATE_STYLES = {
  healthy: 'text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10',
  at_risk: 'text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10',
  critical: 'text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10',
};

const STATE_ICON = {
  healthy: CheckCircle2,
  at_risk: AlertTriangle,
  critical: ShieldAlert,
};

export default function HealthBadge({ health }) {
  const { t } = useTranslation('researchflow');
  if (!health) return null;
  const Icon = STATE_ICON[health.state] || CheckCircle2;
  const reasons = health.reasons || [];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATE_STYLES[health.state] || STATE_STYLES.healthy}`}
      title={reasons.length > 0 ? reasons.map((reason) => t(`health.reasons.${reason.code}`, { defaultValue: reason.code })).join(' · ') : undefined}
    >
      <Icon className="h-3.5 w-3.5" />
      {t(`health.${health.state}`, { defaultValue: health.state })}
    </span>
  );
}
