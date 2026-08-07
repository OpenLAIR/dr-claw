// Phase 5 presentational tests — Data & Backup panel, Workspace panel,
// Project export / workspace buttons. SSR renderToStaticMarkup (repo pattern);
// components must not crash without window/localStorage/Node access.

import React from 'react';
import { describe, expect, it, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enResearchflow from '../../../i18n/locales/en/researchflow.json';
import Portfolio from '../Portfolio';
import WorkspacePanel from '../WorkspacePanel';
import DataBackupPanel from '../DataBackupPanel';

beforeAll(() => {
  i18n.use(initReactI18next).init({
    resources: { en: { researchflow: enResearchflow } },
    lng: 'en',
    fallbackLng: 'en',
    ns: ['researchflow'],
    defaultNS: 'researchflow',
  });

});

describe('Phase 5 data & backup panel', () => {
  it('renders diagnostics, backup list and restore controls', async () => {
    // DataBackupPanel loads asynchronously via useEffect — render the static
    // shell and confirm the key strings/tokens are present in markup.
    const html = renderToStaticMarkup(
      React.createElement(DataBackupPanel)
    );
    expect(html).toContain('Data &amp; Backup');
    expect(html).toContain('Create Backup');
    expect(html).toContain('Restore Backup');
    expect(html).toContain('No backups yet.');
    expect(html).toContain('Restore is applied on the next app start');
  });
});

describe('Phase 5 workspace panel', () => {
  it('renders execution environment form with WSL fields', async () => {
    const html = renderToStaticMarkup(
      React.createElement(WorkspacePanel, { projectId: 'p1' })
    );
    expect(html).toContain('Execution Environment');
    expect(html).toContain('WSL path');
    expect(html).toContain('Windows path');
    expect(html).toContain('WSL distro');
    expect(html).toContain('Validate');
  });
});

describe('Phase 5 portfolio', () => {
  it('renders project cards and the data & backup panel', () => {
    const projects = [
      {
        id: 'p1',
        name: 'Alpha',
        currentStage: { name: 'Main Experiments' },
        overallProgress: 0.5,
        targetVenue: 'ICLR',
        deadline: '2099-12-31',
        daysRemaining: 300,
        blockerCount: 1,
        health: { state: 'healthy', reasons: [] },
        nextCriticalAction: null,
      },
    ];
    const html = renderToStaticMarkup(
      React.createElement(Portfolio, {
        projects,
        onCreate: () => {},
        onOpenProject: () => {},
        onRefresh: () => {},
        creating: false,
        setCreating: () => {},
        error: null,
      })
    );
    expect(html).toContain('Alpha');
    expect(html).toContain('Data &amp; Backup');
    expect(html).toContain('Create Backup');
  });
});
