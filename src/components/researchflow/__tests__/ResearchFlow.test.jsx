// ResearchFlow presentational-component tests — SSR renderToStaticMarkup,
// matching the repo's existing ChatTabBar.test.tsx pattern (no RTL installed).

import React from 'react';
import { describe, expect, it, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enResearchflow from '../../../i18n/locales/en/researchflow.json';
import HealthBadge from '../HealthBadge';
import Progress from '../Progress';
import Dashboard from '../Dashboard';
import Roadmap from '../Roadmap';
import StageGatePanel from '../StageGatePanel';

beforeAll(() => {
  i18n.use(initReactI18next).init({
    resources: { en: { researchflow: enResearchflow } },
    lng: 'en',
    fallbackLng: 'en',
    ns: ['researchflow'],
    defaultNS: 'researchflow',
  });
});

const gates = [
  { id: 'g1', title: 'Research question defined', isRequired: true, isPassed: false, stageId: 's1' },
  { id: 'g2', title: 'Motivation defined', isRequired: true, isPassed: true, stageId: 's1' },
];

const mockDashboard = {
  project: { id: 'p1', name: 'Test Project', targetVenue: 'ICLR 2027', deadline: '2099-12-31', status: 'active' },
  stages: [
    { id: 's1', name: 'Idea Locked', key: 'idea_locked', status: 'current', progress: 0.3, weight: 7, gates },
    { id: 's2', name: 'Literature & Gap', key: 'literature_gap', status: 'pending', progress: 0.3, weight: 10, gates: [] },
    { id: 's3', name: 'Submission', key: 'submission', status: 'pending', progress: 0.3, weight: 3, gates: [] },
  ],
  overallProgress: 0.3,
  currentStage: { id: 's1', name: 'Idea Locked', status: 'current', progress: 0.3, gates },
  daysRemaining: 30,
  blockerCount: 1,
  nextCriticalAction: { tier: 1, taskId: 't1', title: 'Fix the blocker', reasonCode: 'blocker_in_current_stage' },
  health: { state: 'at_risk', reasons: [{ code: 'open_blocker', taskId: 't1', taskTitle: 'Fix the blocker' }] },
  taskSummary: { total: 2, done: 1, inProgress: 0, todo: 1, blocked: 0 },
  gateSummary: { requiredTotal: 5, passedRequired: 0, pendingRequired: 5 },
};

describe('HealthBadge', () => {
  it('renders the state label and reasons tooltip', () => {
    const html = renderToStaticMarkup(
      <HealthBadge health={{ state: 'critical', reasons: [{ code: 'overdue_critical', taskTitle: 'Late' }] }} />,
    );
    expect(html).toContain('Critical');
    expect(html).toContain('Has overdue critical tasks');
  });

  it('renders healthy state', () => {
    const html = renderToStaticMarkup(<HealthBadge health={{ state: 'healthy', reasons: [] }} />);
    expect(html).toContain('Healthy');
  });

  it('renders nothing without health data', () => {
    expect(renderToStaticMarkup(<HealthBadge />)).toBe('');
  });
});

describe('Progress', () => {
  it('renders the value as a percentage width', () => {
    const html = renderToStaticMarkup(<Progress value={0.5} />);
    expect(html).toContain('width:50%');
  });
});

describe('Dashboard', () => {
  it('surfaces the above-the-fold project state', () => {
    const html = renderToStaticMarkup(<Dashboard dashboard={mockDashboard} />);
    expect(html).toContain('Test Project');
    expect(html).toContain('ICLR 2027');
    expect(html).toContain('30%');
    expect(html).toContain('Idea Locked');
    expect(html).toContain('Fix the blocker');
    expect(html).toContain('At risk');
  });
});

describe('Roadmap', () => {
  it('distinguishes completed/current/pending stages and shows the selected stage gates', () => {
    const stages = [
      { id: 's1', name: 'Idea Locked', status: 'completed', progress: 1, weight: 7, gates: [] },
      { id: 's2', name: 'Literature & Gap', status: 'current', progress: 0.5, weight: 10, gates },
      { id: 's3', name: 'Research Design', status: 'pending', progress: 0, weight: 10, gates: [] },
    ];
    const html = renderToStaticMarkup(<Roadmap stages={stages} tasks={[]} onToggleGate={() => {}} onCompleteStage={() => {}} />);
    expect(html).toContain('Completed');
    expect(html).toContain('Current');
    expect(html).toContain('Pending');
    // Selected (current) stage gates are visible.
    expect(html).toContain('Research question defined');
  });
});

describe('StageGatePanel', () => {
  it('disables the complete button until all required gates pass', () => {
    const html = renderToStaticMarkup(
      <StageGatePanel gates={gates} stageStatus="current" onToggleGate={() => {}} onCompleteStage={() => {}} />,
    );
    expect(html).toContain('disabled');
  });

  it('shows completion state and hides the button once completed', () => {
    const html = renderToStaticMarkup(
      <StageGatePanel
        gates={gates.map((gate) => ({ ...gate, isPassed: true }))}
        stageStatus="completed"
        onToggleGate={() => {}}
        onCompleteStage={() => {}}
      />,
    );
    expect(html).toContain('Stage completed');
    expect(html).not.toContain('Complete stage');
  });
});
