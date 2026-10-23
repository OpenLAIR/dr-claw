import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';

// Deterministic contract fixtures for navigation/layout. Live provider execution
// is deliberately not simulated by these tests.
const project = {
  name: 'research-fixture', displayName: 'Sparse representation research', fullPath: '/research/representation',
  taskmaster: { metadata: { taskCount: 3, completed: 1, completionPercentage: 33 } },
  sessions: [{ id: 'research-session', summary: 'Evaluate the baseline', updated_at: '2026-10-20T12:00:00Z' }],
};

async function fixture(page: Page, { empty = false, failed = false, theme = 'light', secondProject = false, survey = false, language = 'en', onboarding = false } = {}) {
  await page.addInitScript(({ theme, language }) => {
    localStorage.setItem('auth-token', 'workbench-test'); localStorage.setItem('userLanguage', language);
    localStorage.setItem('theme', theme);
  }, { theme, language });
  let createdProject: typeof project | null = null;
  let onboardingComplete = !onboarding;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === '/api/auth/status') body = { needsSetup: false };
    else if (path === '/api/auth/user') body = { user: { id: 1, username: 'researcher' } };
    else if (path === '/api/user/onboarding-status') body = { hasCompletedOnboarding: onboardingComplete };
    else if (path === '/api/user/complete-onboarding') { onboardingComplete = true; body = { success: true }; }
    else if (path === '/api/projects/create-workspace') {
      const payload = route.request().postDataJSON();
      createdProject = { ...project, name: 'created-research', displayName: payload.displayName, fullPath: payload.path, sessions: [] };
      body = { success: true, project: createdProject };
    }
    else if (path === '/api/projects') body = createdProject ? [createdProject] : empty ? [] : [project, ...(secondProject ? [{ ...project, name: 'other-project', displayName: 'Another research project', sessions: [], fullPath: '/research/other' }] : [])];
    else if (path === '/api/projects/trash') body = [{ ...project, name: 'archived-research', displayName: 'Archived baseline study', trashedAt: '2026-10-20T12:00:00Z', filesExist: true, canRestore: true, sessionCount: 2 }];
    else if (path.startsWith('/api/auto-research/') && path.endsWith('/status')) body = { success: true, activeRun: null, latestRun: null };
    else if (path === '/api/skills') body = [{ name: 'evidence-review', path: '/skills/evidence-review', type: 'directory', children: [{ name: 'SKILL.md', path: '/skills/evidence-review/SKILL.md', type: 'file' }] }];
    else if (path === '/api/skills/file') body = { content: new URL(route.request().url()).searchParams.get('filePath')?.endsWith('SKILL.md') ? '---\nname: evidence-review\ndescription: Review research evidence.\n---\n# Evidence review\nCompare the reported findings with the source material.' : '{}' };
    else if (path.startsWith('/api/news/results/')) body = { top_papers: [], total_found: 0, total_filtered: 0 };
    else if (path.includes('/taskmaster/tasks/')) {
      if (failed) return route.fulfill({ status: 503, json: { error: 'test outage' } });
      body = { tasks: [
        { id: 1, title: 'Review evidence', stage: 'survey', status: 'done' },
        { id: 2, title: 'Compare reconstruction error', stage: 'experiment', status: 'in-progress' },
        { id: 3, title: 'Write results', stage: 'publication', status: 'pending' },
      ] };
    } else if (path.endsWith('/file')) body = { content: '# Evidence report\n\nA reproducible comparison of baseline results.' };
    else if (survey && path.endsWith('/files')) body = [{ name: 'Survey', path: '/research/representation/Survey', type: 'directory', children: [{ name: 'reports', path: '/research/representation/Survey/reports', type: 'directory', children: [{ name: 'evidence.md', path: '/research/representation/Survey/reports/evidence.md', type: 'file' }] }] }];
    else if (path.endsWith('/files')) body = [{ name: 'Publication', path: '/research/representation/Publication', type: 'directory', children: [{ name: 'results.md', path: '/research/representation/Publication/results.md', type: 'file' }] }];
    else if (path.includes('/sessions')) body = { sessions: project.sessions, messages: [], hasMore: false, total: 1 };
    else if (path.includes('credentials') || path.includes('auth-status')) body = { authenticated: true };
    return route.fulfill({ json: body });
  });
  await page.goto('/');
  if (!onboarding) await expect(page.getByRole('heading', { name: language === 'zh-CN' ? '项目' : language === 'ko' ? '프로젝트' : 'Projects', exact: true, level: 1 })).toBeVisible();
}

for (const width of [1440, 768, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`project overview and home fit ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await fixture(page, { theme });
      await expect(page.locator('main article')).toHaveCount(1);
      await page.locator('main article button').first().click();
      await expect(page.getByRole('heading', { name: 'Research goal' })).toBeVisible();
      await expect(page.getByText('Compare reconstruction error', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Publication/results.md', { exact: true }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const overflowing = await page.locator('main').evaluate(el => el.scrollWidth > el.clientWidth);
      expect(overflowing).toBe(false);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `.taste-skill/after/overview-${width}-${theme}.png` });
    });
  }
}

test('empty home offers project creation and search has an honest empty state', async ({ page }) => {
  await fixture(page, { empty: true });
  await expect(page.getByText('No projects yet', { exact: true })).toBeVisible();
  await page.locator('main').getByRole('button', { name: 'New project', exact: true }).first().click();
  await expect(page.getByText('Create New Project', { exact: true })).toBeVisible();
});

for (const width of [1440, 768, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`global surfaces fit ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await fixture(page, { theme });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const [nav, title, file] of [['News', 'Research Feed', 'news'], ['Skills', 'Skills Library', 'skills'], ['Trash', 'Trash', 'trash']]) {
        if (width < 769) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
        await page.getByRole('button', { name: nav, exact: true }).click();
        await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
        if (nav === 'Skills') await expect(page.getByRole('button').filter({ hasText: 'evidence-review' }).first()).toBeVisible();
        if (nav === 'Trash') await expect(page.getByText('Archived baseline study', { exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await page.getByRole('heading', { name: title, exact: true, level: 1 }).evaluate(el => { let node = el.parentElement; while (node && node !== document.body) { if (node.scrollWidth > node.clientWidth + 1) return false; node = node.parentElement; } return true; })).toBe(true);
        await page.screenshot({ path: `.taste-skill/after/${file}-${width}-${theme}.png` });
      }
      expect(errors).toEqual([]);
    });
  }
}

for (const width of [1440, 390]) {
  test(`settings tabs support keyboard navigation and focus restoration at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    if (width < 769) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const trigger = page.getByRole('button', { name: /^Settings/ });
    await trigger.click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(settings).toBeVisible();
    const tabs = settings.getByRole('tab');
    for (let index = 0; index < await tabs.count(); index++) {
      await tabs.nth(index).click();
      await expect(tabs.nth(index)).toHaveAttribute('aria-selected', 'true');
      expect(await settings.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toBeFocused();
    await page.screenshot({ path: `.taste-skill/after/settings-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    if (width > 768) await expect(trigger).toBeFocused();
  });
}

test('compact skills details open on selection and restore list focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await fixture(page);
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  const skill = page.getByRole('button').filter({ hasText: 'evidence-review' }).first();
  await expect(skill).toBeVisible();
  await expect(page.getByText('Primary Intent', { exact: true })).toBeHidden();
  const filters = page.getByRole('button', { name: 'Filters', exact: true });
  await filters.click();
  await expect(page.getByText('Primary Intent', { exact: true })).toBeVisible();
  await filters.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await skill.click();
  const detail = page.getByRole('dialog', { name: 'evidence-review', exact: true });
  await expect(detail).toBeVisible();
  expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '.taste-skill/after/skills-detail-390.png' });
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(skill).toBeFocused();
});

test('skill edits survive closing and reopening compact details', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await fixture(page);
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  const skill = page.getByRole('button').filter({ hasText: 'evidence-review' }).first();
  await skill.click();
  const dialog = page.getByRole('dialog', { name: 'evidence-review', exact: true });
  await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Edit evidence-review', exact: true }).fill('# Preserve this unfinished edit');
  await page.keyboard.press('Escape');
  await skill.click();
  await expect(dialog.getByRole('textbox', { name: 'Edit evidence-review', exact: true })).toHaveValue('# Preserve this unfinished edit');
});

test('mobile menu traps keyboard focus and Escape restores its trigger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await fixture(page);
  const trigger = page.getByRole('button', { name: 'Open menu', exact: true });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Projects', exact: true });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Sign Out', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(drawer.getByRole('button', { name: 'Close sidebar', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('news loading can retry and failed settings save keeps the draft visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await fixture(page);
  await page.route('**/api/news/sources', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'News', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not load the research feed');
  await page.route('**/api/news/sources', route => route.fulfill({ json: { sources: [] } }));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: 'Open Settings', exact: true });
  await trigger.click();
  const settings = page.getByRole('dialog', { name: 'arXiv Settings', exact: true });
  await expect(settings).toBeVisible();
  const field = settings.getByRole('spinbutton').first();
  await field.fill('12');
  await field.press('Tab');
  await page.route('**/api/news/config/arxiv', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await settings.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(settings.getByRole('alert')).toContainText('Your changes are still here');
  await expect(field).toHaveValue('12');
  await expect(settings.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
  expect(await settings.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '.taste-skill/after/news-settings-390.png' });
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('skill import dialog retains the selected path after a scan failure', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await fixture(page);
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Import Local Skills', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Import skills from local directory', exact: true });
  await dialog.getByLabel('Skills directory path', { exact: true }).fill('/review/skills');
  await page.route('**/api/skills/scan-local?*', route => route.fulfill({ status: 503, json: { error: 'Scan unavailable' } }));
  await dialog.getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Scan unavailable');
  await expect(dialog.getByLabel('Skills directory path', { exact: true })).toHaveValue('/review/skills');
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('streaming continues across global navigation and stop sends the session identity', async ({ page }) => {
  let socket: WebSocketRoute;
  const commands: Record<string, any>[] = [];
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { socket = ws; ws.onMessage(message => commands.push(JSON.parse(String(message)))); });
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const composer = page.locator('textarea').first();
  await composer.fill('Compare the baseline evidence.');
  await composer.press('Enter');
  await expect.poll(() => commands.some(command => command.type === 'claude-command')).toBe(true);
  const command = commands.find(command => command.type === 'claude-command')!;
  expect(command.options.sessionId).toBe('research-session');
  socket!.send(JSON.stringify({ type: 'claude-response', sessionId: 'research-session', data: { type: 'content_block_delta', delta: { text: 'First streamed evidence. ' } } }));
  await expect(page.getByText('First streamed evidence.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Projects', exact: true }).first().click();
  socket!.send(JSON.stringify({ type: 'claude-response', sessionId: 'research-session', data: { type: 'content_block_delta', delta: { text: 'The stream survived navigation.' } } }));
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('The stream survived navigation.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect.poll(() => commands.some(command => command.type === 'abort-session' && command.sessionId === 'research-session')).toBe(true);
  socket!.send(JSON.stringify({ type: 'session-aborted', sessionId: 'research-session', success: true }));
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden();
  await expect(composer).toBeEnabled();
});

test('model keyboard selection, attachment upload and tool approval reach the existing protocol', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  let socket: WebSocketRoute;
  const commands: Record<string, any>[] = [];
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { socket = ws; ws.onMessage(message => commands.push(JSON.parse(String(message)))); });
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByTitle('Model and execution settings', { exact: true }).click();
  const configuration = page.getByRole('dialog', { name: 'Model and execution settings' });
  const model = configuration.getByRole('button', { name: /^Model:/ });
  await model.focus();
  await page.keyboard.press('ArrowDown');
  await expect(configuration.getByRole('listbox', { name: 'Model', exact: true })).toBeVisible();
  await page.keyboard.press('End');
  const selectedLabel = await configuration.getByRole('option').last().innerText();
  await page.keyboard.press('Enter');
  await expect(model).toContainText(selectedLabel.split('\n')[0]);
  const chosenModel = await page.evaluate(() => localStorage.getItem('claude-model'));
  await page.keyboard.press('Escape');
  await page.route('**/api/projects/*/upload-files', route => route.fulfill({ json: { files: [{ name: 'evidence.txt', path: '/research/representation/attachments/evidence.txt', size: 29 }] } }));
  await page.locator('input[type="file"]').setInputFiles({ name: 'evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('Measured reconstruction error') });
  await expect(page.getByText('evidence.txt', { exact: true }).first()).toBeVisible();
  const composer = page.locator('textarea').first();
  await composer.fill('Review the attached evidence.');
  await composer.press('Enter');
  await expect.poll(() => commands.filter(command => command.type === 'claude-command').length).toBe(1);
  const command = commands.find(command => command.type === 'claude-command')!;
  expect(command.options.model).toBe(chosenModel);
  expect(command.command).toContain('/research/representation/attachments/evidence.txt');
  socket!.send(JSON.stringify({ type: 'claude-permission-request', sessionId: 'research-session', requestId: 'review-read', toolName: 'Read', input: { file_path: '/research/representation/attachments/evidence.txt' } }));
  await expect(page.getByRole('alert')).toContainText('Permission required');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.taste-skill/after/chat-permission-390.png' });
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect.poll(() => commands.filter(command => command.type === 'claude-permission-response')).toEqual([expect.objectContaining({ requestId: 'review-read', allow: true })]);
  socket!.send(JSON.stringify({ type: 'claude-complete', sessionId: 'research-session', exitCode: 0 }));
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeHidden();
});

test('retry uses the last research request and reload recovers saved session messages', async ({ page }) => {
  let socket: WebSocketRoute;
  const commands: Record<string, any>[] = [];
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { socket = ws; ws.onMessage(message => commands.push(JSON.parse(String(message)))); });
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('textarea').first().fill('Repeat the controlled comparison.');
  await page.locator('textarea').first().press('Enter');
  await expect.poll(() => commands.filter(command => command.type === 'claude-command').length).toBe(1);
  socket!.send(JSON.stringify({ type: 'claude-error', sessionId: 'research-session', error: 'Provider temporarily unavailable', isRetryable: true }));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => commands.filter(command => command.type === 'claude-command').length).toBe(2);
  expect(commands.filter(command => command.type === 'claude-command')[1].command).toContain('Repeat the controlled comparison.');
  socket!.send(JSON.stringify({ type: 'claude-complete', sessionId: 'research-session', exitCode: 0 }));
  await page.route('**/api/projects/*/sessions/research-session/messages?*', route => route.fulfill({ json: { messages: [
    { uuid: 'saved-user', message: { role: 'user', content: 'Repeat the controlled comparison.' }, timestamp: '2026-10-20T12:00:00Z' },
    { uuid: 'saved-assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Saved evidence recovered after reload.' }] }, timestamp: '2026-10-20T12:00:01Z' },
  ], hasMore: false, total: 2 } }));
  await page.reload();
  await expect(page).toHaveURL(/\/session\/research-session$/);
  await expect(page.getByText('Saved evidence recovered after reload.', { exact: true })).toBeVisible();
});

test('session tabs keep separate histories and switch with keyboard', async ({ page }) => {
  await fixture(page);
  const second = { id: 'second-session', summary: 'Inspect another experiment', updated_at: '2026-10-19T12:00:00Z' };
  await page.route('**/api/projects', route => route.fulfill({ json: [{ ...project, sessions: [...project.sessions, second] }] }));
  await page.route('**/api/projects/*/sessions/*/messages?*', route => {
    const secondSession = route.request().url().includes('/second-session/');
    return route.fulfill({ json: { messages: [{ message: { role: 'assistant', content: [{ type: 'text', text: secondSession ? 'Second experiment history.' : 'Baseline experiment history.' }] }, timestamp: '2026-10-20T12:00:00Z' }], hasMore: false, total: 1 } });
  });
  await page.evaluate(() => window.refreshProjects?.());
  await page.locator('main article button').first().click();
  await page.getByRole('button', { name: /Inspect another experiment/ }).first().click();
  await expect(page.getByText('Second experiment history.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).first().click();
  await page.getByRole('button', { name: /Evaluate the baseline/ }).first().click();
  await expect(page.getByText('Baseline experiment history.', { exact: true })).toBeVisible();
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(2);
  await tabs.last().focus();
  await page.keyboard.press('ArrowLeft');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/\/session\/second-session$/);
  await expect(page.getByText('Second experiment history.', { exact: true })).toBeVisible();
  await expect(page.getByText('Baseline experiment history.', { exact: true })).toBeHidden();
});

test.describe('touch interactions', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('touch approval remains actionable after typing', async ({ page }) => {
    let socket: WebSocketRoute;
    const commands: Record<string, any>[] = [];
    await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { socket = ws; ws.onMessage(message => commands.push(JSON.parse(String(message)))); });
    await fixture(page);
    await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).tap();
    await page.locator('textarea').first().fill('Check the source evidence.');
    await page.locator('textarea').first().press('Enter');
    await expect.poll(() => commands.some(command => command.type === 'claude-command')).toBe(true);
    socket!.send(JSON.stringify({ type: 'claude-permission-request', sessionId: 'research-session', requestId: 'touch-review', toolName: 'Read', input: { file_path: '/research/evidence.md' } }));
    await page.getByRole('button', { name: 'Allow once', exact: true }).tap();
    await expect.poll(() => commands.some(command => command.type === 'claude-permission-response' && command.requestId === 'touch-review' && command.allow)).toBe(true);
    socket!.send(JSON.stringify({ type: 'claude-complete', sessionId: 'research-session', exitCode: 0 }));
    await page.getByRole('button', { name: 'Open menu', exact: true }).tap();
    await page.getByRole('button', { name: /^Settings/ }).tap();
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  });
});

for (const width of [1440, 768, 390]) {
  test(`long project names and many sessions remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    const longName = 'RepresentationLearningWithReproducibleBaselines'.repeat(5);
    const sessions = Array.from({ length: 60 }, (_, i) => ({ id: `many-${i}`, summary: `Evidence review ${i + 1}`, updated_at: `2026-10-20T12:${String(i).padStart(2, '0')}:00Z` }));
    await page.route('**/api/projects', route => route.fulfill({ json: [{ ...project, displayName: longName, taskmaster: undefined, sessions }] }));
    await page.route('**/api/projects/*/sessions?*', route => route.fulfill({ json: { sessions, hasMore: false, total: sessions.length } }));
    await page.evaluate(() => window.refreshProjects?.());
    await expect(page.locator('main article').getByText(longName, { exact: true })).toBeVisible();
    await page.locator('main article button').first().click();
    await expect(page.locator('main h1')).toHaveText(longName);
    expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole('button', { name: /Evidence review 60/ }).first().click();
    await expect(page).toHaveURL(/\/session\/many-59$/);
    await expect(page.locator('textarea').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('overview exposes task failure without hiding conversations and outputs', async ({ page }) => {
  await fixture(page, { failed: true });
  await page.locator('main article button').first().click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load this section.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Evaluate the baseline/ }).first()).toBeVisible();
  await expect(page.getByText('Publication/results.md', { exact: true }).first()).toBeVisible();
});

test('continuing a session navigates directly to its deep link', async ({ page }) => {
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/session\/research-session$/);
  await expect(page.getByRole('button', { name: 'Overview', exact: true }).first()).toBeVisible();
});

test('chat draft and mounted composer survive home and overview navigation', async ({ page }) => {
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const composer = page.locator('textarea').first();
  await expect(composer).toBeVisible();
  await composer.fill('比较两个基线实验，保留这份未发送的草稿。');
  await composer.evaluate(el => el.setAttribute('data-mount-check', 'original'));
  await page.getByRole('button', { name: 'Projects', exact: true }).first().click();
  await expect(page.locator('main h1')).toHaveText('Projects');
  await page.locator('main article button').first().click();
  await page.getByRole('button', { name: 'Continue research', exact: true }).click();
  await expect(composer).toHaveValue('比较两个基线实验，保留这份未发送的草稿。');
  await expect(composer).toHaveAttribute('data-mount-check', 'original');
});

test('model configuration is keyboard accessible and returns focus on Escape', async ({ page }) => {
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const trigger = page.getByTitle('Model and execution settings', { exact: true });
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Model and execution settings' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});


test('browsing a different project overview and refreshing keeps the chat draft', async ({ page }) => {
  await fixture(page, { secondProject: true });
  await page.locator('main article').first().getByRole('button', { name: 'Continue', exact: true }).click();
  const composer = page.locator('textarea').first();
  await expect(composer).toBeVisible();
  await composer.fill('跨项目浏览时保留草稿');
  await composer.evaluate(el => el.setAttribute('data-mount-check', 'retained'));
  await page.getByRole('button', { name: 'Projects', exact: true }).first().click();
  await page.locator('main article').filter({ hasText: 'Another research project' }).locator('button').first().click();
  await expect(page.locator('main h1')).toHaveText('Another research project');
  await page.evaluate(() => window.refreshProjects?.());
  await page.getByRole('button', { name: 'Projects', exact: true }).first().click();
  await page.locator('main article').filter({ hasText: 'Sparse representation research' }).getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(composer).toHaveValue('跨项目浏览时保留草稿');
  await expect(composer).toHaveAttribute('data-mount-check', 'retained');
});

for (const width of [1440, 390]) {
  test(`model menu stays inside configuration surface at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByTitle('Model and execution settings', { exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Model and execution settings' });
    await dialog.locator('.relative').first().getByRole('button').first().click();
    await expect(dialog.locator('.bottom-full')).toBeVisible();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `.taste-skill/after/configuration-${width}.png` });
  });
}

test('IME composition Enter does not submit the draft', async ({ page }) => {
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const composer = page.locator('textarea').first();
  await composer.fill('输入中的研究目标');
  await composer.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await expect(composer).toHaveValue('输入中的研究目标');
});

test('mobile research tools open on demand and keep composer space available', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const composer = page.locator('textarea').first();
  await expect(composer).toBeVisible();
  await expect(page.getByRole('button', { name: 'Files', exact: true })).toBeHidden();
  const box = await composer.boundingBox();
  expect(box!.y).toBeGreaterThan(100);
  expect(box!.y + box!.height).toBeLessThan(800);
  await page.screenshot({ path: '.taste-skill/after/chat-390.png' });
  const trigger = page.getByRole('button', { name: 'Research tools', exact: true });
  await trigger.click();
  await expect(page.getByRole('button', { name: 'Files', exact: true })).toBeVisible();
  await expect(composer).toBeHidden();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(composer).toBeVisible();
  await expect(trigger).toBeFocused();
});


test('conversation preferences persist after closing configuration and reloading', async ({ page }) => {
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByTitle('Model and execution settings', { exact: true }).click();
  await page.getByText('Quick Settings', { exact: true }).click();
  const preference = page.getByRole('checkbox', { name: 'Send by Ctrl+Enter', exact: true });
  await preference.check();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page).toHaveURL(/\/session\/research-session$/);
  await page.getByTitle('Model and execution settings', { exact: true }).click();
  await page.getByText('Quick Settings', { exact: true }).click();
  await expect(preference).toBeChecked();
  await page.keyboard.press('Escape');
  const composer = page.locator('textarea').first();
  await composer.fill('Keep this draft on Enter');
  await composer.press('Enter');
  await expect(composer).toHaveValue('Keep this draft on Enter\n');
});

for (const width of [1440, 768, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`literature selection and preview fit ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await fixture(page, { survey: true, theme });
      await page.locator('main article button').first().click();
      await page.getByRole('button', { name: 'Literature', exact: true }).first().click();
      await page.getByRole('button', { name: /evidence.md/ }).click();
      await expect(page.getByRole('heading', { name: 'Evidence report' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect.poll(async () => (await page.getByRole('heading', { name: 'Evidence report' }).boundingBox())?.width || 0).toBeGreaterThan(width < 769 ? width - 100 : 200);
      await page.screenshot({ path: `.taste-skill/after/literature-${width}-${theme}.png` });
      if (width < 769) {
        await page.getByRole('button', { name: 'File Library', exact: true }).click();
        await expect(page.getByRole('button', { name: /evidence.md/ })).toBeVisible();
      } else {
        const resize = page.getByRole('separator', { name: 'Resize resource list' });
        await resize.focus();
        await page.keyboard.press('ArrowLeft');
        await expect(resize).toHaveAttribute('aria-valuenow', '336');
      }
    });
  }
}


for (const width of [1440, 768, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`research tools fit ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await fixture(page, { theme });
      for (const [nav, title, file] of [['Auto Research', 'Auto Research Hub', 'auto-research'], ['Compute Resource', 'Compute Resources', 'compute']]) {
        if (width < 769) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
        await page.getByRole('button', { name: nav, exact: true }).click();
        await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const heading = page.getByRole('heading', { name: title, exact: true, level: 1 });
        expect(await heading.evaluate(el => {
          let node = el.parentElement;
          while (node && node !== document.body) {
            if (node.scrollWidth > node.clientWidth + 1) return false;
            node = node.parentElement;
          }
          return true;
        })).toBe(true);
        await page.screenshot({ path: `.taste-skill/after/${file}-${width}-${theme}.png` });
      }
    });
  }
}

test('compute failures distinguish unknown measurements and allow retry', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/compute/**', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.getByRole('button', { name: 'Compute Resource', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not load remote nodes');
  await expect(page.getByText('No remote nodes configured', { exact: true })).toBeHidden();
  await expect(page.getByText('0%', { exact: true })).toBeHidden();
  await page.route('**/api/compute/nodes', route => route.fulfill({ json: { nodes: [] } }));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(page.getByText('No remote nodes configured', { exact: true })).toBeVisible();
});


for (const width of [1440, 390]) {
  test(`research details retain task actions and fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.locator('main article button').first().click();
    await page.getByRole('button', { name: 'Research details', exact: true }).click();
    const detail = page.locator('#research-details');
    await expect(detail.getByText('Pipeline Task List', { exact: true })).toBeVisible();
    await detail.scrollIntoViewIfNeeded();
    expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `.taste-skill/after/research-details-${width}.png` });
  });
}


test('preparing a research task opens a new draft with its real prompt', async ({ page }) => {
  await fixture(page);
  await page.locator('main article button').first().click();
  await page.getByRole('button', { name: 'Research details', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare task in chat', exact: true }).click();
  await expect(page.locator('textarea').first()).toHaveValue(/Work on this research task: (Compare reconstruction error|Write results)/);
  await expect(page).toHaveURL(/\/$/);
});

for (const width of [1440, 390]) {
  test(`output preview opens real file content and restores focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.locator('main article button').first().click();
    const output = page.getByRole('button', { name: 'Publication/results.md', exact: true });
    await output.click();
    const preview = page.getByRole('dialog', { name: 'results.md' });
    await expect(preview.getByRole('heading', { name: 'Evidence report' })).toBeVisible();
    expect(await preview.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `.taste-skill/after/output-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
    await expect(output).toBeFocused();
  });
}


test('task handoff respects the existing unsent-draft protection', async ({ page }) => {
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('textarea').first().fill('Preserve my unfinished research question');
  await page.getByRole('button', { name: 'Overview', exact: true }).first().click();
  await page.getByRole('button', { name: 'Research details', exact: true }).click();
  let asked = false;
  page.once('dialog', async dialog => { asked = true; await dialog.dismiss(); });
  await page.getByRole('button', { name: 'Prepare task in chat', exact: true }).click();
  await expect(page.locator('textarea').first()).toHaveValue('Preserve my unfinished research question');
  expect(asked).toBe(true);
});


for (const width of [1440, 390]) {
  test(`new project creation reaches overview and starts research at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, { empty: true });
    const trigger = page.locator('main').getByRole('button', { name: 'New project', exact: true }).first();
    await trigger.click();
    const wizard = page.getByRole('dialog', { name: 'Create New Project' });
    await wizard.getByRole('button', { name: 'Next', exact: true }).click();
    await wizard.getByLabel('Project Name', { exact: true }).fill('Controlled research workspace');
    await wizard.getByLabel('Workspace Path', { exact: true }).fill('/tmp/workbench-contract-new');
    await page.screenshot({ path: `.taste-skill/after/create-${width}.png` });
    await wizard.getByRole('button', { name: 'Next', exact: true }).click();
    const request = page.waitForRequest(request => request.url().includes('/api/projects/create-workspace'));
    await wizard.getByRole('button', { name: 'Create Project', exact: true }).click();
    expect((await request).postDataJSON()).toEqual({ workspaceType: 'new', path: '/tmp/workbench-contract-new', displayName: 'Controlled research workspace' });
    await expect(page.locator('main h1')).toHaveText('Controlled research workspace');
    await page.getByRole('button', { name: 'Start research', exact: true }).click();
    await expect(page.locator('textarea').first()).toBeVisible();
  });
}

test('project creation Escape returns focus to its trigger', async ({ page }) => {
  await fixture(page, { empty: true });
  const trigger = page.locator('main').getByRole('button', { name: 'New project', exact: true }).first();
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Create New Project' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const width of [1440, 768, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`login and registration fit ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(({ theme }) => { localStorage.setItem('theme', theme); localStorage.setItem('userLanguage', 'en'); }, { theme });
      await page.route('**/api/**', route => route.fulfill({ json: { needsSetup: false } }));
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Welcome Back', exact: true })).toBeVisible();
      await expect(page.getByAltText('Dr. Claw')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.taste-skill/after/login-${width}-${theme}.png` });
      await page.getByRole('button', { name: 'Register Now', exact: true }).click();
      await page.getByLabel('Username', { exact: true }).fill('review-user');
      await page.getByLabel('Email', { exact: true }).fill('review@example.com');
      await page.getByLabel('Password', { exact: true }).fill('review-password');
      await page.getByLabel('Confirm Password', { exact: true }).fill('different-password');
      await page.getByRole('button', { name: 'Create Account', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('Passwords do not match');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.taste-skill/after/register-${width}-${theme}.png` });
    });
  }
}

for (const [language, welcome, next, agents, complete, projects] of [
  ['en', 'Welcome to Dr. Claw', 'Next', 'Install Dependencies and Connect Agents', 'Complete Setup', 'Projects'],
  ['zh-CN', '欢迎使用 Dr. Claw', '下一步', '安装依赖并连接助手', '完成设置', '项目'],
  ['ko', 'Dr. Claw에 오신 것을 환영합니다', '다음', '종속성 설치 및 에이전트 연결', '설정 완료', '프로젝트'],
]) {
  for (const width of [1440, 390]) {
    test(`onboarding completes in ${language} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await fixture(page, { onboarding: true, language, theme: width === 390 ? 'dark' : 'light' });
      await expect(page.getByRole('heading', { name: welcome, exact: true })).toBeVisible();
      await page.getByRole('checkbox').uncheck();
      await page.getByRole('button', { name: next, exact: true }).click();
      await expect(page.getByRole('heading', { name: agents, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.taste-skill/after/onboarding-${language}-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: complete, exact: true }).click();
      await expect(page.getByRole('heading', { name: projects, exact: true, level: 1 })).toBeVisible();
    });
  }
}

test('project summaries prioritize actual auto-research failures and active runs', async ({ page }) => {
  await fixture(page, { secondProject: true });
  await page.route('**/api/auto-research/*/status', route => route.fulfill({ json: {
    success: true,
    activeRun: route.request().url().includes('other-project') ? { status: 'queued' } : null,
    latestRun: route.request().url().includes('other-project') ? { status: 'queued' } : { status: 'failed', finishedAt: '2026-10-22T12:00:00Z' },
  } }));
  await page.reload();
  const rows = page.locator('main article');
  await expect(rows.first()).toContainText('Needs attention');
  await expect(rows.nth(1)).toContainText('Running');
  await rows.first().getByRole('button').first().click();
  await expect(page.locator('main').getByText('Needs attention', { exact: true })).toBeVisible();
});

test('unavailable research status offers retry without hiding project progress', async ({ page }) => {
  await fixture(page);
  let fail = true;
  await page.route('**/api/auto-research/*/status', route => route.fulfill(fail ? { status: 503, json: {} } : { json: { success: true, activeRun: null, latestRun: null } }));
  await page.reload();
  await expect(page.locator('main article')).toContainText('Status unavailable');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
  fail = false;
  await page.getByRole('button', { name: 'Retry research status' }).click();
  await expect(page.locator('main article')).toContainText('Ready');
  await expect(page.getByRole('button', { name: 'Retry research status' })).toHaveCount(0);
});

for (const width of [1440, 390]) {
  test(`research and skill pickers preserve the draft and restore focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
    const composer = page.locator('textarea').first();
    await composer.fill('Keep the research question');
    const auto = page.locator('form').getByRole('button', { name: 'Auto Research', exact: true });
    await auto.click();
    const autoDialog = page.getByRole('dialog', { name: 'Auto Research', exact: true });
    await expect(autoDialog).toBeVisible();
    expect(await autoDialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await autoDialog.getByRole('button', { name: /^ARIS/ }).click();
    await page.screenshot({ path: `.taste-skill/after/research-picker-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(auto).toBeFocused();
    await expect(composer).toHaveValue('Keep the research question');
    const skillTrigger = page.getByRole('button', { name: 'Skill Shortcuts', exact: true });
    await skillTrigger.click();
    const skillDialog = page.getByRole('dialog', { name: 'Skill Shortcuts', exact: true });
    await skillDialog.getByRole('button', { name: /Deep Research/ }).click();
    await skillDialog.getByRole('button', { name: 'inno-deep-research', exact: true }).click();
    await expect(skillDialog).toBeHidden();
    await expect(composer).toHaveValue('Keep the research question');
    await expect(composer).toBeFocused();
  });
}

for (const [language, title, skillButton, importTitle] of [
  ['zh-CN', '技能库', '技能', '从本地目录导入技能'],
  ['ko', '스킬 라이브러리', '스킬', '로컬 디렉터리에서 스킬 가져오기'],
]) {
  test(`skills uses localized labels and import form in ${language}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await fixture(page);
    await page.evaluate(lang => localStorage.setItem('userLanguage', lang), language);
    // The fixture init script is replaced by explicit app language switching on reload.
    await page.addInitScript(lang => localStorage.setItem('userLanguage', lang), language);
    await page.reload();
    await page.getByRole('button', { name: language === 'zh-CN' ? '打开菜单' : '메뉴 열기', exact: true }).click();
    await page.getByRole('button', { name: skillButton, exact: true }).click();
    await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
    await page.getByRole('button', { name: language === 'zh-CN' ? '导入本地技能' : '로컬 스킬 가져오기', exact: true }).click();
    await expect(page.getByRole('dialog', { name: importTitle })).toBeVisible();
    expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `.taste-skill/after/skills-import-${language}-390.png` });
  });
}

test('task mutations preserve input on failure and apply only successful responses', async ({ page }) => {
  await fixture(page);
  let fail = true;
  let tasks = [{ id: 2, title: 'Compare reconstruction error', description: 'Validate measurements', stage: 'experiment', status: 'in-progress' }];
  await page.route('**/api/taskmaster/**', async route => {
    const url = route.request().url();
    if (url.includes('/tasks/')) return route.fulfill({ json: { tasks } });
    if (fail) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    if (url.includes('/update-task/')) tasks = tasks.map(task => ({ ...task, ...route.request().postDataJSON() }));
    if (url.includes('/add-task/')) tasks.push({ id: 3, status: 'pending', ...route.request().postDataJSON() });
    if (url.includes('/delete-task/')) tasks = tasks.filter(task => task.id !== Number(url.split('/').at(-1)));
    return route.fulfill({ json: { success: true } });
  });
  await page.locator('main article button').first().click();
  await page.getByRole('button', { name: 'Research details', exact: true }).click();
  const detail = page.locator('#research-details');
  await detail.getByRole('button', { name: 'Edit', exact: true }).click();
  await detail.getByRole('textbox', { name: 'Task title', exact: true }).fill('Measure reconstruction error');
  await detail.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(detail.getByRole('alert')).toContainText('Operation failed');
  await expect(detail.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue('Measure reconstruction error');
  fail = false;
  await detail.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(detail.getByText('Measure reconstruction error', { exact: true })).toBeVisible();
  fail = true;
  await detail.getByRole('button', { name: 'Add task', exact: true }).first().click();
  await detail.getByRole('textbox', { name: 'Task title', exact: true }).fill('Reproduce the ablation');
  await detail.getByRole('button', { name: 'Add task', exact: true }).filter({ hasText: 'Add task' }).click();
  await expect(detail.getByRole('textbox', { name: 'Task title', exact: true })).toHaveValue('Reproduce the ablation');
  await expect(detail.getByRole('alert')).toContainText('Operation failed');
  fail = false;
  await detail.getByRole('button', { name: 'Add task', exact: true }).filter({ hasText: 'Add task' }).click();
  await expect(detail.getByText('Reproduce the ablation', { exact: true }).first()).toBeVisible();
  fail = true;
  await detail.getByRole('button', { name: 'Delete task', exact: true }).first().click();
  const confirm = page.getByRole('dialog', { name: 'Delete task', exact: true });
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirm.getByRole('alert')).toContainText('Operation failed');
  await expect(confirm).toBeVisible();
  fail = false;
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(detail.getByRole('button', { name: 'Delete task', exact: true })).toHaveCount(1);
});

for (const width of [1440, 390]) {
  test(`folder browser retains wizard and shows failures at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, { empty: true });
    let fail = true;
    await page.route('**/api/browse-filesystem?*', route => route.fulfill(fail ? { status: 503, json: {} } : { json: { path: '/research', suggestions: [{ name: 'Long-research-folder-'.repeat(5), path: '/research/long-folder' }] } }));
    await page.locator('main').getByRole('button', { name: 'New project', exact: true }).first().click();
    const wizard = page.getByRole('dialog', { name: 'Create New Project' });
    await wizard.getByRole('button', { name: 'Next', exact: true }).click();
    const browse = wizard.getByRole('button', { name: 'Select folder', exact: true });
    await browse.click();
    const folder = page.getByRole('dialog', { name: 'Select folder', exact: true });
    await expect(folder.getByRole('alert')).toContainText('Could not load folders.');
    fail = false;
    await folder.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(folder.getByText('Long-research-folder-'.repeat(5), { exact: true })).toBeVisible();
    expect(await folder.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await folder.getByRole('button', { name: 'Create new folder', exact: true }).click();
    await expect(folder.getByRole('textbox', { name: 'New folder name' })).toBeVisible();
    expect(await folder.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `.taste-skill/after/folder-browser-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(folder).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(folder).toBeHidden();
    await expect(wizard).toBeVisible();
    await expect(browse).toBeFocused();
  });
}

test('research details show partial failures and keep successful task data through retry', async ({ page }) => {
  await fixture(page);
  let failFiles = true;
  await page.route('**/api/projects/*/files?*', route => route.fulfill(failFiles ? { status: 503, json: {} } : { json: [] }));
  await page.locator('main article button').first().click();
  await page.getByRole('button', { name: 'Research details', exact: true }).click();
  const detail = page.locator('#research-details');
  await expect(detail.getByRole('alert')).toContainText('Files');
  await expect(detail.getByText('Compare reconstruction error', { exact: true }).last()).toBeVisible();
  failFiles = false;
  await detail.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(detail.getByRole('alert')).toHaveCount(0);
  await expect(detail.getByText('Compare reconstruction error', { exact: true }).last()).toBeVisible();
});

for (const width of [1440, 768, 390]) {
  for (const theme of ['light', 'dark']) {
    test(`research Markdown stays readable at ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await fixture(page, { theme });
      const markdown = '# Evidence comparison\n\nA **reproducible** result with $E = mc^2$ and a long identifier: ' + 'research_identifier_'.repeat(14) + '\n\n| Method | Validation result | Notes |\n|---|---:|---|\n| Baseline | 0.82 | Verified on the held-out set |\n| Ablation | 0.75 | Repeated with three seeds |\n\n```python\nresult = compare_models(baseline, ablation, metrics=["reconstruction_error", "held_out_accuracy"])\nprint(result)\n```\n\n> Evidence must come from recorded measurements.\n\n1. Check the sources\n2. Repeat the comparison\n   - Keep the seed fixed\n   - Record missing data';
      await page.route('**/api/projects/*/sessions/*/messages?*', route => route.fulfill({ json: { messages: [{ uuid: 'markdown-evidence', message: { role: 'assistant', content: [{ type: 'text', text: markdown }] }, timestamp: '2026-10-20T12:00:00Z' }], hasMore: false, total: 1 } }));
      await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Evidence comparison' })).toBeAttached();
      await expect(page.getByRole('table')).toContainText('Validation result');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const content = page.locator('.prose').filter({ has: page.getByRole('heading', { name: 'Evidence comparison' }) });
      expect(await content.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.getByRole('heading', { name: 'Evidence comparison' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.taste-skill/after/markdown-${width}-${theme}.png` });
    });
  }
}

test.describe('standalone mobile viewport', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  for (const theme of ['light', 'dark']) {
    test(`standalone composer survives keyboard-size viewport changes in ${theme}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
      await fixture(page, { theme });
      await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).tap();
      const composer = page.locator('textarea').first();
      await composer.fill('验证中文输入草稿');
      await composer.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
      await page.setViewportSize({ width: 390, height: 500 });
      await expect(composer).toHaveValue('验证中文输入草稿');
      const bounds = await composer.boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(500);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.taste-skill/after/standalone-keyboard-${theme}.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(composer).toHaveValue('验证中文输入草稿');
      expect(await composer.evaluate(el => parseFloat(getComputedStyle(el).transitionDuration) <= 0.01)).toBe(true);
    });
  }
});

for (const width of [1440, 390]) {
  test(`compute node form validates, keeps failed input and submits Slurm settings at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    let fail = true;
    let submitted: Record<string, any> | null = null;
    await page.route('**/api/compute/nodes', route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { nodes: [] } });
      submitted = route.request().postDataJSON();
      return route.fulfill(fail ? { status: 503, json: { error: 'Node storage unavailable' } } : { json: { success: true } });
    });
    if (width < 769) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('button', { name: 'Compute Resource', exact: true }).click();
    await page.getByRole('button', { name: 'Add Node', exact: true }).click();
    const form = page.getByRole('heading', { name: 'Add Remote Node' }).locator('../..');
    await form.getByRole('button', { name: 'Add Node', exact: true }).click();
    await expect(form.getByRole('alert')).toContainText('Host is required');
    await form.getByLabel('Host *', { exact: true }).fill('compute.example.test');
    await form.getByLabel('Username *', { exact: true }).fill('researcher');
    await form.getByLabel('Port', { exact: true }).fill('22x');
    await form.getByRole('button', { name: 'Add Node', exact: true }).click();
    await expect(form.getByRole('alert')).toContainText('Port must be an integer');
    expect(submitted).toBeNull();
    await form.getByLabel('Port', { exact: true }).fill('2222');
    await form.getByRole('button', { name: 'Slurm HPC', exact: true }).click();
    await expect(form.getByRole('button', { name: 'Slurm HPC', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await form.getByLabel('Partition', { exact: true }).fill('cpu');
    await form.getByLabel('GPUs', { exact: true }).fill('0');
    await form.getByRole('button', { name: 'Add Node', exact: true }).click();
    await expect(form.getByRole('alert')).toContainText('Node storage unavailable');
    await expect(form.getByLabel('Host *', { exact: true })).toHaveValue('compute.example.test');
    expect(submitted).toMatchObject({ host: 'compute.example.test', user: 'researcher', port: 2222, type: 'slurm', slurm: { defaultPartition: 'cpu', defaultGpus: 0 } });
    expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `.taste-skill/after/compute-form-${width}.png` });
    fail = false;
    await form.getByRole('button', { name: 'Add Node', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Add Remote Node' })).toHaveCount(0);
  });
}

test('output preview hands off to editable content and preserves it after a save failure', async ({ page }) => {
  await fixture(page);
  let fail = true;
  let saved: { filePath: string; content: string } | undefined;
  await page.route('**/api/projects/*/file', route => {
    saved = route.request().postDataJSON();
    return route.fulfill(fail ? { status: 503, json: { error: 'Controlled save failure' } } : { json: { success: true } });
  });
  await page.locator('main article button').first().click();
  await page.getByRole('button', { name: 'Publication/results.md', exact: true }).click();
  await page.getByRole('dialog', { name: 'results.md' }).getByRole('button', { name: 'Open in Editor', exact: true }).click();
  const edit = page.getByRole('button', { name: 'Edit file', exact: true });
  await expect(edit).toBeVisible();
  await edit.click();
  const editor = page.locator('.cm-content[contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  await editor.fill('# Revised evidence\n\nKeep the source measurements.');
  const errorDialog = page.waitForEvent('dialog');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const alert = await errorDialog;
  expect(alert.message()).toContain('Controlled save failure');
  await alert.dismiss();
  await expect(editor).toContainText('Keep the source measurements.');
  fail = false;
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved!', exact: true })).toBeVisible();
  expect(saved?.content).toContain('Keep the source measurements.');
});

test('Slurm controls retain failed scripts, report queue failures and cancel only after success', async ({ page }) => {
  await fixture(page);
  let failInfo = true;
  let failActions = true;
  let jobs = [{ jobId: '42', name: 'Ablation review', state: 'RUNNING', elapsed: '00:01' }];
  const submitted: Array<{ url: string; body: any }> = [];
  await page.route('**/api/compute/**', route => {
    const url = route.request().url();
    if (url.endsWith('/nodes')) return route.fulfill({ json: { nodes: [{ id: 'fixture-node', name: 'Fixture Slurm node', host: 'compute.example.test', user: 'researcher', port: 22, type: 'slurm', workDir: '/research', slurm: { defaultGpus: 1 } }] } });
    if (url.includes('/monitor')) return route.fulfill({ json: { success: true, gpus: [], cpu: null } });
    if (url.endsWith('/slurm/info')) return route.fulfill(failInfo ? { status: 503, json: { success: false } } : { json: { success: true, partitions: [{ name: 'cpu' }] } });
    if (url.endsWith('/slurm/queue')) return route.fulfill({ json: { success: true, jobs } });
    if (route.request().method() === 'POST') {
      submitted.push({ url, body: route.request().postDataJSON() });
      if (failActions) return route.fulfill({ status: 503, json: { success: false, error: 'Scheduler unavailable' } });
      if (url.includes('/slurm/cancel/')) jobs = [];
      return route.fulfill({ json: { success: true, output: 'Scheduler accepted the request' } });
    }
    return route.fulfill({ json: {} });
  });
  await page.getByRole('button', { name: 'Compute Resource', exact: true }).click();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not load Slurm status');
  failInfo = false;
  await page.getByRole('button', { name: 'Refresh Slurm status', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit & submit script', exact: true }).click();
  const script = page.getByRole('textbox', { name: 'Batch Script (sbatch)' });
  await script.fill('#!/bin/bash\nprintf "controlled test"\n');
  await page.getByRole('button', { name: 'Submit Job', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Scheduler unavailable');
  await expect(script).toHaveValue('#!/bin/bash\nprintf "controlled test"\n');
  await page.getByRole('button', { name: 'Cancel job 42', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel job 42', exact: true })).toBeVisible();
  failActions = false;
  await page.getByRole('button', { name: 'Cancel job 42', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel job 42', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit Job', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Scheduler accepted the request' })).toBeVisible();
  expect(submitted.find(request => request.url.endsWith('/sbatch'))?.body.rawScript).toContain('controlled test');
});

test('partial compute metrics remain unknown while measured zero stays zero', async ({ page }) => {
  await fixture(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/compute/**', route => route.fulfill({ json: route.request().url().endsWith('/nodes') ? { nodes: [] } : { success: true, cpu: {}, gpus: [{ index: 0, name: 'Partial GPU' }, { index: 1, name: 'Idle GPU', gpuUtil: 0, memUtil: 0, memUsedMB: 0, memTotalMB: 1024, tempC: 0, powerW: 0 }] } }));
  await page.getByRole('button', { name: 'Compute Resource', exact: true }).click();
  await expect(page.getByText('Unknown', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Idle', { exact: true })).toHaveCount(1);
  await expect(page.getByText('0%', { exact: true })).toHaveCount(1);
  await expect(page.getByText('NaN%', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Avg CPU Load', { exact: true }).locator('..')).toContainText('—');
  expect(errors).toEqual([]);
});

test('research session stage tags retain existing state on failure and retry successfully', async ({ page }) => {
  await fixture(page);
  const tag = { id: 9, tagType: 'stage', tagKey: 'experiment', label: 'Experiment', source: 'manual' };
  let fail = true;
  await page.route('**/api/projects/*/tags?*', route => route.fulfill({ json: { tags: [tag] } }));
  await page.route('**/api/projects/*/sessions/*/tags', route => route.fulfill(fail ? { status: 503, json: { error: 'Unavailable' } } : { json: { tags: [tag] } }));
  await page.locator('main article button').first().click();
  await page.getByRole('button', { name: 'Research details', exact: true }).click();
  const board = page.getByRole('button', { name: 'Session Stage Links', exact: true });
  if (await board.getAttribute('aria-expanded') === 'false') await board.click();
  const choice = page.locator('#research-details').getByRole('button', { name: 'Experiment', exact: true });
  await choice.click();
  await expect(page.getByRole('alert')).toContainText('Could not save stage tags');
  await expect(choice).toHaveAttribute('aria-pressed', 'false');
  fail = false;
  await choice.click();
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

for (const language of ['zh-CN', 'ko']) {
  for (const theme of ['light', 'dark']) {
    test(`research details and compute form localize at 390px ${language} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await fixture(page, { language, theme });
      const zh = language === 'zh-CN';
      await page.locator('main article button').first().click();
      await page.getByRole('button', { name: zh ? '研究详情' : '연구 상세', exact: true }).click();
      const details = page.locator('#research-details');
      await expect(details.getByText(zh ? '研究概况' : '연구 개요', { exact: true })).toBeVisible();
      await details.scrollIntoViewIfNeeded();
      expect(await details.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: `.taste-skill/after/research-details-${language}-${theme}.png` });
      await page.getByRole('button', { name: zh ? '打开菜单' : '메뉴 열기', exact: true }).click();
      await page.getByRole('button', { name: zh ? '计算节点' : '컴퓨팅', exact: true }).click();
      await page.getByRole('button', { name: zh ? '添加节点' : '노드 추가', exact: true }).first().click();
      await expect(page.getByRole('heading', { name: zh ? '添加远程节点' : '원격 노드 추가', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.taste-skill/after/compute-form-${language}-${theme}.png` });
    });
  }
}

for (const width of [1440, 390]) {
  test(`research brief dialog and source links preserve content and focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.route('**/api/projects/*/files?*', route => route.fulfill({ json: [{ name: '.pipeline', path: '/research/representation/.pipeline', type: 'directory', children: [{ name: 'docs', path: '/research/representation/.pipeline/docs', type: 'directory', children: [{ name: 'research_brief.json', path: '/research/representation/.pipeline/docs/research_brief.json', type: 'file' }] }] }, { name: 'instance.json', path: '/research/representation/instance.json', type: 'file' }] }));
    await page.route('**/api/projects/*/file?*', route => {
      const path = new URL(route.request().url()).searchParams.get('filePath') || '';
      return route.fulfill({ json: { content: JSON.stringify(path.endsWith('instance.json') ? { source_papers: [{ reference: 'A traceable source', url: 'https://example.org/evidence' }] } : { meta: { title: 'Controlled research brief' }, sections: { ideation: { research_goal: 'Compare source measurements', problem_framing: 'Preserve attribution' } } }) } });
    });
    await page.locator('main article button').first().click();
    await page.getByRole('button', { name: 'Research details', exact: true }).click();
    const overview = page.getByRole('button', { name: /Research Overview/ });
    if (await overview.getAttribute('aria-expanded') === 'false') await overview.click();
    const trigger = page.getByRole('button', { name: 'Read Brief', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Research Overview', exact: true });
    await expect(dialog).toContainText('Compare source measurements');
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `.taste-skill/after/research-brief-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
}

for (const width of [1440, 390]) {
  test(`reference dialogs preserve failure state and hand evidence to chat at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, { survey: true });
    const reference = { id: 'ref-review', title: 'A traceable comparison of sparse representations', authors: [{ family: 'Researcher', given: 'A' }], year: 2026, abstract: 'Evidence with source attribution.', doi: '10.0000/test', url: 'https://example.org/evidence', keywords: ['Representation'], item_type: 'article', source: 'bibtex', pdf_cached: 0 };
    let failLoad = true;
    let failDelete = true;
    await page.route('**/api/references/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'DELETE') return route.fulfill(failDelete ? { status: 503, json: { error: 'Unavailable' } } : { json: { success: true } });
      if (path.includes('/project/')) return route.fulfill(failLoad ? { status: 503, json: { error: 'Unavailable' } } : { json: { references: [reference] } });
      return route.fulfill({ json: { references: [], connected: false } });
    });
    await page.locator('main article button').first().click();
    await page.getByRole('button', { name: 'Literature', exact: true }).first().click();
    await page.getByRole('button', { name: /^References Expand$/ }).click();
    await expect(page.getByRole('alert')).toContainText('Could not load references');
    failLoad = false;
    await page.getByRole('button', { name: 'Refresh references', exact: true }).click();
    const title = page.getByRole('button', { name: reference.title, exact: true });
    await title.click();
    const detail = page.getByRole('dialog', { name: reference.title });
    await expect(detail).toContainText(reference.abstract);
    await expect(detail.getByRole('link', { name: 'View source' })).toHaveAttribute('href', reference.url);
    expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `.taste-skill/after/reference-detail-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(title).toBeFocused();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const deletion = page.getByRole('dialog', { name: 'Delete Reference', exact: true });
    await deletion.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(deletion.getByRole('alert')).toContainText('Could not delete references');
    await deletion.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(title).toBeVisible();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const importing = page.getByRole('dialog', { name: 'Import References', exact: true });
    await importing.locator('input[type=file]').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
    await expect(importing.getByRole('alert')).toContainText('Only .bib');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeFocused();
    await title.click();
    await detail.getByRole('button', { name: 'Add to Chat', exact: true }).click();
    await expect(page.locator('textarea').first()).toHaveValue(/traceable comparison/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('inline artifact editor preserves changes after rejected save', async ({ page }) => {
  await fixture(page, { survey: true });
  let fail = true;
  await page.route('**/api/projects/*/file', route => route.fulfill(fail ? { status: 503, json: { error: 'Unavailable' } } : { json: { success: true } }));
  await page.locator('main article button').first().click();
  await page.getByRole('button', { name: 'Research details', exact: true }).click();
  const details = page.locator('#research-details');
  await details.getByRole('button', { name: 'Edit', exact: true }).last().click();
  const editor = details.getByRole('textbox', { name: 'Edit', exact: true });
  await editor.fill('Keep measured values');
  await details.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(details.getByRole('alert')).toContainText('Failed');
  await expect(editor).toHaveValue('Keep measured values');
  fail = false;
  await details.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(details.getByRole('status')).toHaveText('Saved');
});

test('reference handoff preserves an existing unsent draft when replacement is declined', async ({ page }) => {
  await fixture(page, { survey: true });
  const reference = { id: 'ref-draft', title: 'Evidence for the current draft', authors: [], keywords: [], source: 'bibtex', item_type: 'article', pdf_cached: 0 };
  await page.route('**/api/references/project/*', route => route.fulfill({ json: { references: [reference] } }));
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const input = page.locator('textarea').first();
  await input.fill('Keep my research question');
  await page.getByRole('button', { name: 'Literature', exact: true }).first().click();
  await page.getByRole('button', { name: /^References Expand$/ }).click();
  let asked = false;
  page.once('dialog', async dialog => { asked = true; await dialog.dismiss(); });
  await page.getByRole('button', { name: 'Chat about this', exact: true }).click();
  await expect(input).toHaveValue('Keep my research question');
  expect(asked).toBe(true);
});
