// Phase 4 presentational tests — SSR renderToStaticMarkup (repo pattern).

import React from 'react';
import { describe, expect, it, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enResearchflow from '../../../i18n/locales/en/researchflow.json';
import Dashboard from '../Dashboard';
import Manuscript from '../Manuscript';
import Submission from '../Submission';

beforeAll(() => {
  i18n.use(initReactI18next).init({
    resources: { en: { researchflow: enResearchflow } },
    lng: 'en',
    fallbackLng: 'en',
    ns: ['researchflow'],
    defaultNS: 'researchflow',
  });
});

describe('Phase 4 dashboard summaries', () => {
  const gates = [
    { id: 'g1', title: 'G1', isRequired: true, isPassed: true, stageId: 's1' },
  ];
  const baseDashboard = {
    project: { id: 'p1', name: 'Test', deadline: '2099-12-31', status: 'active' },
    stages: [{ id: 's1', name: 'Idea Locked', key: 'idea_locked', status: 'current', progress: 0.5, weight: 7, gates }],
    overallProgress: 0.5,
    currentStage: { id: 's1', name: 'Idea Locked', status: 'current', progress: 0.5, gates },
    daysRemaining: 100,
    blockerCount: 0,
    nextCriticalAction: null,
    health: { state: 'at_risk', reasons: [] },
    taskSummary: { total: 1, done: 0, inProgress: 0, todo: 1, blocked: 0 },
    gateSummary: { requiredTotal: 1, passedRequired: 1, pendingRequired: 0 },
    experimentSummary: { total: 0, runs: { total: 0, completed: 0, running: 0, failed: 0 } },
    evidenceSummary: { coreClaimsTotal: 0, coreClaimsMissingEvidence: 0, claimsWithContradictoryEvidence: 0 },
  };

  it('renders manuscript/freeze/review/submission summaries', () => {
    const dashboard = {
      ...baseDashboard,
      manuscriptSummary: { requiredSectionsComplete: true, totalRequiredSections: 7, sectionsFinal: 5, sectionsDraftOrBetter: 7 },
      resultsSummary: { hasFreeze: true, freezeState: 'current', freezeNumber: 2, overrideReason: null },
      reviewSummary: { openCritical: 1, openMajor: 2, openMinor: 0, resolvedComments: 3 },
      submissionSummary: { venue: 'ICLR', status: 'preparing', ready: false, requiredChecks: 19, doneChecks: 15, blockerCount: 2 },
    };
    const html = renderToStaticMarkup(<Dashboard dashboard={dashboard} />);
    expect(html).toContain('#2');
    expect(html).toContain('Critical');
    expect(html).toContain('NOT READY');
    expect(html).toContain('15/19');
  });

  it('renders without Phase 4 summaries (backwards compatible)', () => {
    const html = renderToStaticMarkup(<Dashboard dashboard={baseDashboard} />);
    expect(html).toContain('Idea Locked');
  });
});

describe('Phase 4 workspace loading states', () => {
  it('Manuscript shows the three sub-tabs immediately', () => {
    const html = renderToStaticMarkup(<Manuscript projectId="p1" />);
    expect(html).toContain('Sections');
    expect(html).toContain('Results Freeze');
    expect(html).toContain('Review Comments');
  });

  it('Submission shows empty-state prompt before data', () => {
    const html = renderToStaticMarkup(<Submission projectId="p1" />);
    expect(html).toContain('Loading');
  });
});
