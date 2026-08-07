// Phase 3 presentational tests — SSR renderToStaticMarkup (repo pattern, no RTL).

import React from 'react';
import { describe, expect, it, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enResearchflow from '../../../i18n/locales/en/researchflow.json';
import Dashboard from '../Dashboard';
import Experiments from '../Experiments';
import Literature from '../Literature';
import EvidenceView from '../EvidenceView';

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
  { id: 'g1', title: 'Research question defined', isRequired: true, isPassed: true, stageId: 's1' },
  { id: 'g2', title: 'Motivation defined', isRequired: true, isPassed: false, stageId: 's1' },
];

const baseDashboard = {
  project: { id: 'p1', name: 'Test Project', targetVenue: 'ICLR 2027', deadline: '2099-12-31', status: 'active' },
  stages: [{ id: 's1', name: 'Idea Locked', key: 'idea_locked', status: 'current', progress: 0.3, weight: 7, gates }],
  overallProgress: 0.3,
  currentStage: { id: 's1', name: 'Idea Locked', status: 'current', progress: 0.3, gates },
  daysRemaining: 120,
  blockerCount: 0,
  nextCriticalAction: null,
  health: { state: 'at_risk', reasons: [{ code: 'unfinished_required_gates_no_progress' }] },
  taskSummary: { total: 2, done: 1, inProgress: 0, todo: 1, blocked: 0 },
  gateSummary: { requiredTotal: 2, passedRequired: 1, pendingRequired: 1 },
};

describe('Phase 3 dashboard summaries', () => {
  it('renders experiment and evidence summaries from the backend payload', () => {
    const dashboard = {
      ...baseDashboard,
      experimentSummary: { total: 3, runs: { total: 5, completed: 3, running: 1, failed: 1 } },
      evidenceSummary: {
        coreClaimsTotal: 2,
        coreClaimsMissingEvidence: 1,
        claimsWithContradictoryEvidence: 0,
        claimsSupported: 0,
        claimsPartial: 1,
        claimsWithEvidence: 1,
      },
    };
    const html = renderToStaticMarkup(<Dashboard dashboard={dashboard} />);
    expect(html).toContain('Runs');
    expect(html).toContain('Core claims');
    expect(html).toContain('Core claims missing evidence');
  });

  it('renders without Phase 3 summaries (Phase 2 fallback)', () => {
    const html = renderToStaticMarkup(<Dashboard dashboard={baseDashboard} />);
    expect(html).toContain('Idea Locked');
  });
});

describe('Phase 3 workspace loading states', () => {
  it('Experiments shows loading before data arrives', () => {
    const html = renderToStaticMarkup(<Experiments projectId="p1" />);
    expect(html).toContain('Loading');
  });

  it('Literature shows loading before data arrives', () => {
    const html = renderToStaticMarkup(<Literature projectId="p1" />);
    expect(html).toContain('Loading');
  });

  it('EvidenceView renders the three sub-tabs immediately', () => {
    const html = renderToStaticMarkup(<EvidenceView projectId="p1" />);
    expect(html).toContain('Claim–Evidence Matrix');
    expect(html).toContain('Decision Log');
    expect(html).toContain('Figures &amp; Tables');
  });
});
