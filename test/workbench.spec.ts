import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';

const screenshotPath = (name: string) => `${process.env.WORKBENCH_SCREENSHOT_DIR || '.taste-skill/after'}/${name}`;

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
      await page.screenshot({ path: screenshotPath(`overview-${width}-${theme}.png`) });
    });
  }
}

for (const width of [1440, 390]) {
  test(`failed sidebar project deletion keeps the active conversation and allows retry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.locator('main article button').first().click();
    await page.getByRole('button', { name: 'Continue research', exact: true }).click();
    const composer = page.locator('textarea').first();
    await composer.fill('Preserve this research draft');
    let attempts = 0;
    await page.route('**/api/projects/research-fixture?force=true', route => {
      attempts++;
      return route.fulfill({ status: 503, json: { error: 'Storage unavailable' } });
    });
    if (width < 769) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const remove = width < 769
      ? page.getByRole('button', { name: 'Move project to trash', exact: true })
      : page.getByTitle('Move project to trash', { exact: true });
    await remove.click();
    const confirm = page.getByRole('dialog', { name: 'Delete Project', exact: true });
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(confirm.getByRole('alert')).toContainText('Failed to delete project');
    await expect(composer).toHaveValue('Preserve this research draft');
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => attempts).toBe(2);
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    if (width < 769) await page.keyboard.press('Escape');
    await expect(composer).toHaveValue('Preserve this research draft');
  });
}

for (const width of [1440, 390]) {
  test(`project rename failure retains the draft at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.route('**/api/projects/research-fixture/rename', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
    if (width < 769) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const trigger = width < 769 ? page.getByRole('button', { name: 'Rename project (F2)', exact: true }) : page.getByTitle('Rename project (F2)', { exact: true });
    await trigger.click();
    const input = page.getByRole('textbox', { name: 'Project name', exact: true });
    await input.fill('保留这个研究名称');
    await input.press('Enter');
    await expect(page.getByRole('alert')).toContainText('Could not save the name');
    await expect(input).toHaveValue('保留这个研究名称');
    await expect(input).toBeFocused();
    await page.screenshot({ path: screenshotPath(`reaudit-rename-error-${width}.png`) });
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

for (const [language, menu, rename, label, error] of [
  ['zh-CN', '打开菜单', '重命名项目 (F2)', '项目名称', '无法保存名称'],
  ['ko', '메뉴 열기', '프로젝트 이름 변경 (F2)', '프로젝트 이름', '이름을 저장하지 못했습니다'],
]) {
  test(`localized rename feedback fits a narrow dark drawer in ${language}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await fixture(page, { language, theme: 'dark' });
    await page.route('**/api/projects/research-fixture/rename', route => route.fulfill({ status: 503, json: {} }));
    await page.getByRole('button', { name: menu, exact: true }).click();
    const trigger = page.getByRole('button', { name: rename, exact: true });
    await trigger.click();
    const input = page.getByRole('textbox', { name: label, exact: true });
    await input.fill('跨语言研究 · 언어 연구');
    await input.press('Enter');
    await expect(page.getByRole('alert')).toContainText(error);
    const editor = input.locator('..');
    expect(await editor.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const headerBottom = await page.getByRole('button', { name: menu.replace('打开菜单', '关闭菜单').replace('메뉴 열기', '메뉴 닫기'), exact: true }).evaluate(button => button.closest('.sticky')!.getBoundingClientRect().bottom);
    expect((await input.boundingBox())!.y).toBeGreaterThanOrEqual(headerBottom);
    for (const action of await editor.getByRole('button').all()) {
      const box = await action.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.y + box!.height).toBeLessThanOrEqual(568);
    }
    await page.screenshot({ path: screenshotPath(`reaudit-rename-${language}-320.png`), animations: 'disabled' });
    await input.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
}

test('project rename validates blanks and IME, prevents duplicate requests, and refreshes on success', async ({ page }) => {
  await fixture(page);
  let attempts = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const renamed = 'Revised representation study';
  await page.route('**/api/projects/research-fixture/rename', async route => {
    attempts++;
    expect(route.request().postDataJSON()).toEqual({ displayName: renamed });
    await pending;
    await route.fulfill({ json: { success: true } });
  });
  const projectButton = page.getByRole('button', { name: 'Sparse representation research', exact: true });
  await projectButton.focus();
  await page.keyboard.press('F2');
  const input = page.getByRole('textbox', { name: 'Project name', exact: true });
  await expect(input).toBeFocused();
  await input.fill('   ');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Enter a name.');
  expect(attempts).toBe(0);
  await input.fill(renamed);
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await expect(input).toBeEditable();
  expect(attempts).toBe(0);
  await input.press('Enter');
  try {
    await expect(input).toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
    await input.press('Enter');
    await input.press('Escape');
    await expect(input).toBeVisible();
    await expect.poll(() => attempts).toBe(1);
    await page.route('**/api/projects', route => route.fulfill({ json: [{ ...project, displayName: renamed }] }));
  } finally { release(); }
  await expect(input).toHaveCount(0);
  await expect(page.locator('main article').getByText(renamed, { exact: true })).toBeVisible();
});

test('session rename network failure retains input, retries successfully, and preserves chat draft', async ({ page }) => {
  await fixture(page);
  await page.locator('main article button').first().click();
  await page.getByRole('button', { name: 'Continue research', exact: true }).click();
  const composer = page.locator('textarea').first();
  await composer.fill('Keep this chat draft');
  let fail = true;
  let attempts = 0;
  const renamed = 'Review the controlled experiment';
  await page.route('**/api/projects/research-fixture/sessions/research-session/rename', route => {
    attempts++;
    expect(route.request().postDataJSON()).toEqual({ summary: renamed, provider: 'claude' });
    return fail ? route.abort('failed') : route.fulfill({ json: { success: true } });
  });
  const trigger = page.getByRole('button', { name: 'Manually edit session name', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const input = page.getByRole('textbox', { name: 'Rename Session', exact: true });
  await expect(input).toBeFocused();
  await input.fill(renamed);
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Could not save the name');
  await expect(input).toHaveValue(renamed);
  await expect(composer).toHaveValue('Keep this chat draft');
  await page.screenshot({ path: screenshotPath('reaudit-session-rename-error.png') });
  fail = false;
  const sessions = [{ ...project.sessions[0], summary: renamed }];
  await page.route('**/api/projects', route => route.fulfill({ json: [{ ...project, sessions }] }));
  await page.route('**/api/projects/research-fixture/sessions?*', route => route.fulfill({ json: { sessions, hasMore: false, total: 1 } }));
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp(renamed) }).first()).toBeVisible();
  expect(attempts).toBe(2);
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(composer).toHaveValue('Keep this chat draft');
});

test('empty home offers project creation and search has an honest empty state', async ({ page }) => {
  await fixture(page, { empty: true });
  await expect(page.getByText('No projects yet', { exact: true })).toBeVisible();
  await page.locator('main').getByRole('button', { name: 'New project', exact: true }).first().click();
  await expect(page.getByText('Create New Project', { exact: true })).toBeVisible();
});

test('pending project deletion stays modal and submits once before success', async ({ page }) => {
  await fixture(page);
  await page.locator('main article button').first().click();
  await page.getByRole('button', { name: 'Continue research', exact: true }).click();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let attempts = 0;
  await page.route('**/api/projects/research-fixture?force=true', async route => {
    attempts++;
    await pending;
    await route.fulfill({ json: { success: true } });
  });
  await page.getByTitle('Move project to trash', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Project', exact: true });
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  try {
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    await expect(dialog).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Deleting…', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(page.locator('textarea').first()).toBeAttached();
    expect(attempts).toBe(1);
    // A subsequent refresh must represent the successful mutation.
    await page.route('**/api/projects', route => route.fulfill({ json: [] }));
  } finally { release(); }
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('textarea')).toHaveCount(0);
  await expect(page.getByText('Sparse representation research', { exact: true })).toHaveCount(0);
});

for (const width of [1440, 390, 320]) {
  test(`session deletion network failure preserves draft and keyboard retry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, { theme: width === 320 ? 'dark' : 'light' });
    await page.locator('main article button').first().click();
    await page.getByRole('button', { name: 'Continue research', exact: true }).click();
    const composer = page.locator('textarea').first();
    await composer.fill('Session draft must survive');
    let attempts = 0;
    await page.route('**/api/projects/research-fixture/sessions/research-session?provider=claude', route => {
      attempts++;
      return route.abort('failed');
    });
    if (width < 769) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const remove = page.getByRole('button', { name: 'Delete this session permanently', exact: true });
    await remove.focus();
    if (width >= 769) await expect(remove.locator('..')).toHaveCSS('opacity', '1');
    else {
      const bounds = await remove.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      // Read both boxes in one frame while the drawer may still be sliding in.
      const overlaps = await remove.evaluate(button => {
        const metadata = [...button.parentElement!.querySelectorAll('*')].find(el => el.textContent === 'Research')!;
        return metadata.getBoundingClientRect().right > button.getBoundingClientRect().left;
      });
      expect(overlaps).toBe(false);
    }
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Delete Session', exact: true });
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Error deleting session');
    await expect(composer).toHaveValue('Session draft must survive');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => attempts).toBe(2);
    await expect(dialog.getByRole('alert')).toContainText('Error deleting session');
    await page.screenshot({ path: screenshotPath(`reaudit-delete-failure-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(remove).toBeFocused();
    if (width < 769) {
      expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: screenshotPath(`reaudit-session-actions-${width}.png`) });
    }
    if (width < 769) await page.keyboard.press('Escape');
    await expect(composer).toHaveValue('Session draft must survive');
  });
}

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
        await page.screenshot({ path: screenshotPath(`${file}-${width}-${theme}.png`) });
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
    await page.screenshot({ path: screenshotPath(`settings-${width}.png`) });
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
  await page.screenshot({ path: screenshotPath('skills-detail-390.png') });
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

test('sidebar folding preserves keyboard focus in both directions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixture(page);
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
  await collapse.focus();
  await page.keyboard.press('Enter');
  const expand = page.getByRole('button', { name: 'Show sidebar', exact: true });
  await expect(expand).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(collapse).toBeFocused();
});

test('mobile drawer header closes the menu and restores its trigger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  const trigger = page.getByRole('button', { name: 'Open menu', exact: true });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Projects', exact: true });
  await drawer.getByRole('button', { name: /^(Collapse sidebar|Close menu)$/ }).click();
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // Closing the phone drawer must not collapse the user's desktop navigation.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('button', { name: 'Collapse sidebar', exact: true })).toBeVisible();
});

test('sidebar resize supports keyboard bounds and persists its width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixture(page);
  const resize = page.getByRole('separator', { name: 'Resize sidebar', exact: true });
  await resize.focus();
  await page.keyboard.press('ArrowRight');
  await expect(resize).toHaveAttribute('aria-valuenow', '298');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(resize).toHaveAttribute('aria-valuenow', '258');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft');
  await expect(resize).toHaveAttribute('aria-valuenow', '220');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight');
  await expect(resize).toHaveAttribute('aria-valuenow', '480');
  await page.reload();
  await expect(resize).toHaveAttribute('aria-valuenow', '480');
  await resize.focus();
  await page.keyboard.press('Home');
  await expect(resize).toHaveAttribute('aria-valuenow', '220');
  await page.screenshot({ path: screenshotPath('reaudit-sidebar-keyboard.png'), animations: 'disabled' });
});

test('phone project actions preserve readable names and separate their touch targets', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await fixture(page);
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Projects', exact: true });
  const projectRow = drawer.getByRole('button', { name: /Sparse representation research/ });
  await expect(projectRow).toHaveAttribute('aria-expanded', 'false');
  await projectRow.click();
  await expect(projectRow).toHaveAttribute('aria-expanded', 'true');
  const star = drawer.getByRole('button', { name: 'Add to favorites', exact: true });
  const rename = drawer.getByRole('button', { name: 'Rename project (F2)', exact: true });
  const remove = drawer.getByRole('button', { name: 'Move project to trash', exact: true });
  for (const control of [star, rename, remove]) {
    const bounds = await control.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  await star.click();
  await expect(drawer.getByRole('button', { name: 'Remove from favorites' })).toHaveAttribute('aria-pressed', 'true');
  await rename.click();
  const input = drawer.getByRole('textbox', { name: 'Project name', exact: true });
  await input.fill('An unsaved project name');
  await input.press('Escape');
  await expect(drawer).toBeVisible();
  await expect(projectRow).toBeVisible();
  await expect(input).toHaveCount(0);
  await remove.click();
  const confirmation = page.getByRole('dialog', { name: 'Delete Project', exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText(project.displayName);
  expect(await confirmation.evaluate(el => el.matches(':modal'))).toBe(true);
  await page.screenshot({ path: screenshotPath('reaudit-project-confirmation.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(drawer).toBeVisible();
  await expect(remove).toBeFocused();
});

for (const [width, height] of [[320, 568], [390, 500], [768, 600]]) {
  test(`compact drawer remains reachable at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await fixture(page);
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Projects', exact: true });
    const close = drawer.getByRole('button', { name: 'Close menu', exact: true });
    const box = await close.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await expect(drawer.getByText(project.displayName, { exact: true }).filter({ visible: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: screenshotPath(`reaudit-drawer-${width}.png`), animations: 'disabled' });
    const signOut = drawer.getByRole('button', { name: 'Sign Out', exact: true });
    await signOut.scrollIntoViewIfNeeded();
    await expect(signOut).toBeInViewport({ ratio: 1 });
    await expect(close).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: screenshotPath(`reaudit-drawer-footer-${width}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toBeFocused();
  });
}

for (const [language, closeLabel, menuLabel, projectsLabel] of [
  ['en', 'Close menu', 'Open menu', 'Projects'],
  ['zh-CN', '关闭菜单', '打开菜单', '项目'],
  ['ko', '메뉴 닫기', '메뉴 열기', '프로젝트'],
]) {
  test(`touch drawer closes from its header in ${language}`, async ({ browser }) => {
    const context = await browser.newContext({ baseURL: process.env.WORKBENCH_URL || 'http://localhost:5145', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    try {
      await fixture(page, { language });
      const trigger = page.getByRole('button', { name: menuLabel, exact: true });
      await trigger.tap();
      const drawer = page.getByRole('dialog', { name: projectsLabel, exact: true });
      await page.screenshot({ path: screenshotPath(`reaudit-touch-${language}.png`), animations: 'disabled' });
      await drawer.getByRole('button', { name: closeLabel, exact: true }).tap();
      await expect(drawer).toHaveCount(0);
      await expect(trigger).toBeFocused();
    } finally {
      await context.close();
    }
  });
}

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
  await page.screenshot({ path: screenshotPath('news-settings-390.png') });
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
  await page.screenshot({ path: screenshotPath('chat-permission-390.png') });
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
    await page.screenshot({ path: screenshotPath(`configuration-${width}.png`) });
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
  await page.screenshot({ path: screenshotPath('chat-390.png') });
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
      await page.screenshot({ path: screenshotPath(`literature-${width}-${theme}.png`) });
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
        await page.screenshot({ path: screenshotPath(`${file}-${width}-${theme}.png`) });
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
    await page.screenshot({ path: screenshotPath(`research-details-${width}.png`) });
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
    await page.screenshot({ path: screenshotPath(`output-${width}.png`) });
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
    await page.screenshot({ path: screenshotPath(`create-${width}.png`) });
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
      await expect(page.getByRole('img', { name: 'Dr. Claw' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: screenshotPath(`login-${width}-${theme}.png`) });
      await page.getByRole('button', { name: 'Register Now', exact: true }).click();
      await page.getByLabel('Username', { exact: true }).fill('review-user');
      await page.getByLabel('Email', { exact: true }).fill('review@example.com');
      await page.getByLabel('Password', { exact: true }).fill('review-password');
      await page.getByLabel('Confirm Password', { exact: true }).fill('different-password');
      await page.getByRole('button', { name: 'Create Account', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('Passwords do not match');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: screenshotPath(`register-${width}-${theme}.png`) });
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
      await page.screenshot({ path: screenshotPath(`onboarding-${language}-${width}.png`), fullPage: true });
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
    await page.getByRole('button', { name: 'More tools', exact: true }).click();
    const auto = page.locator('.composer-more-tools').getByRole('button', { name: 'Auto Research', exact: true });
    await auto.click();
    const autoDialog = page.getByRole('dialog', { name: 'Auto Research', exact: true });
    await expect(autoDialog).toBeVisible();
    expect(await autoDialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await autoDialog.getByRole('button', { name: /^ARIS/ }).click();
    await page.screenshot({ path: screenshotPath(`research-picker-${width}.png`) });
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
    await page.screenshot({ path: screenshotPath(`skills-import-${language}-390.png`) });
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
    await page.screenshot({ path: screenshotPath(`folder-browser-${width}.png`) });
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
      await page.screenshot({ path: screenshotPath(`markdown-${width}-${theme}.png`) });
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
      await page.screenshot({ path: screenshotPath(`standalone-keyboard-${theme}.png`) });
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
    await page.screenshot({ path: screenshotPath(`compute-form-${width}.png`) });
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
      await page.screenshot({ path: screenshotPath(`research-details-${language}-${theme}.png`) });
      await page.getByRole('button', { name: zh ? '打开菜单' : '메뉴 열기', exact: true }).click();
      await page.getByRole('button', { name: zh ? '计算节点' : '컴퓨팅', exact: true }).click();
      await page.getByRole('button', { name: zh ? '添加节点' : '노드 추가', exact: true }).first().click();
      await expect(page.getByRole('heading', { name: zh ? '添加远程节点' : '원격 노드 추가', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: screenshotPath(`compute-form-${language}-${theme}.png`) });
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
    await page.screenshot({ path: screenshotPath(`research-brief-${width}.png`) });
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
    await page.screenshot({ path: screenshotPath(`reference-detail-${width}.png`) });
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

for (const width of [1440, 768, 390, 320]) {
  for (const theme of ['light', 'dark']) {
    test(`composer actions and long drafts fit ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await fixture(page, { theme });
      await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
      const input = page.getByRole('textbox', { name: 'Message', exact: true });
      const send = page.getByRole('button', { name: 'Send', exact: true });
      await expect(send).toBeDisabled();
      await expect(input).toBeVisible();
      await input.fill('比较两个基线实验，记录可复现的证据。\n'.repeat(12));
      const form = input.locator('xpath=ancestor::form');
      for (const label of ['Send', 'More tools', 'Attach files']) {
        const box = await form.getByRole('button', { name: label, exact: true }).boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(width < 769 ? 44 : 32);
        expect(box!.height).toBeGreaterThanOrEqual(width < 769 ? 44 : 32);
      }
      expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const bounds = await form.boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
      await page.screenshot({ path: screenshotPath(`chat-composer-${width}-${theme}.png`), animations: 'disabled' });
    });
  }
}

test('composer Tab navigates controls, Shift+Enter adds a line, and Enter sends once', async ({ page }) => {
  const commands: Record<string, any>[] = [];
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => ws.onMessage(message => commands.push(JSON.parse(String(message)))));
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('First line');
  await input.press('Shift+Enter');
  await input.pressSequentially('Second line');
  await expect(input).toHaveValue('First line\nSecond line');
  await input.press('Tab');
  await expect(page.getByRole('button', { name: 'Attach files' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(input).toBeFocused();
  await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, which: 229 });
  await expect(input).toHaveValue('First line\nSecond line');
  expect(commands.filter(command => command.type === 'claude-command')).toHaveLength(0);
  await input.press('Enter');
  await expect.poll(() => commands.filter(command => command.type === 'claude-command').length).toBe(1);
  expect(commands.find(command => command.type === 'claude-command')!.options.permissionMode).toBe('default');
});

for (const touch of [false, true]) {
  test.describe(`native composer submit ${touch ? 'touch' : 'pointer'}`, () => {
    test.use({ hasTouch: touch });
    test('sends one request through the form', async ({ page }) => {
      await page.setViewportSize({ width: touch ? 390 : 1440, height: 900 });
      const commands: Record<string, any>[] = [];
      await page.routeWebSocket(/\/ws(?:\?|$)/, ws => ws.onMessage(message => commands.push(JSON.parse(String(message)))));
      await fixture(page);
      await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Send this research request once.');
      const send = page.getByRole('button', { name: 'Send', exact: true });
      if (touch) await send.tap(); else await send.click();
      await expect.poll(() => commands.filter(command => command.type === 'claude-command').length).toBe(1);
      await expect(page.getByRole('button', { name: 'Add to queue', exact: true })).toBeDisabled();
    });
  });
}

test('voice input supports keyboard activation and appends transcript without sending', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__voice = { starts: 0, stops: 0 };
    (window as any).SpeechRecognition = class {
      onresult: any; onend: any;
      start() { (window as any).__voice.starts++; (window as any).__voice.instance = this; }
      stop() { (window as any).__voice.stops++; this.onend?.(); }
    };
  });
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Research draft: ');
  await page.getByRole('button', { name: 'More tools', exact: true }).click();
  await page.getByRole('button', { name: 'Start voice input' }).focus();
  await page.keyboard.press('Enter');
  const stop = page.getByRole('button', { name: 'Stop recording' });
  await expect(stop).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => (window as any).__voice.instance.onresult({ results: [Object.assign([{ transcript: 'dictated evidence' }], { isFinal: true })] }));
  await expect(input).toHaveValue(/Research draft:.*dictated evidence/);
  await stop.focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Start voice input' })).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => ({ starts: (window as any).__voice.starts, stops: (window as any).__voice.stops }))).toEqual({ starts: 1, stops: 1 });
});

test('unsupported voice input provides accessible feedback and preserves the draft', async ({ page }) => {
  await page.addInitScript(() => { (window as any).SpeechRecognition = undefined; (window as any).webkitSpeechRecognition = undefined; });
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Keep this typed draft');
  await page.getByRole('button', { name: 'More tools', exact: true }).click();
  const mic = page.getByRole('button', { name: 'Start voice input' });
  await mic.click();
  const dialog = page.getByRole('dialog', { name: 'Voice input', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('not available in this browser');
  await page.keyboard.press('Escape');
  await expect(mic).toBeFocused();
  await expect(input).toHaveValue('Keep this typed draft');
});

for (const theme of ['light', 'dark']) {
  test(`right context sidebar follows dragging and keeps a readable chat in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await fixture(page, { theme });
    await page.locator('main article button').first().click();
    await page.getByRole('button', { name: 'Continue research', exact: true }).click();
    const expand = page.getByRole('button', { name: 'Expand context sidebar', exact: true });
    await expect(expand).toBeVisible();
    await expand.click();
    const handle = page.getByRole('separator', { name: 'Resize context sidebar', exact: true });
    const pane = page.locator('aside').last();
    const before = (await pane.boundingBox())!;
    await page.screenshot({ path: screenshotPath(`right-sidebar-${theme}-rest.png`) });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 100, box.y + 200, { steps: 10 });
    await page.screenshot({ path: screenshotPath(`right-sidebar-${theme}-drag.png`) });
    await page.mouse.up();
    await expect.poll(async () => (await pane.boundingBox())!.width).toBeCloseTo(before.width + 100, 0);
  });
}

test('right context sidebar supports keyboard, bounds, persistence, reset and drag cancellation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixture(page);
  await page.locator('main article button').first().click();
  await page.getByRole('button', { name: 'Continue research', exact: true }).click();
  await page.getByRole('button', { name: 'Expand context sidebar', exact: true }).click();
  const handle = page.getByRole('separator', { name: 'Resize context sidebar', exact: true });
  const pane = page.locator('aside').last();
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '490');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '450');
  await page.reload();
  await expect(handle).toHaveAttribute('aria-valuenow', '450');
  await expect.poll(async () => (await pane.boundingBox())!.width).toBe(450);
  await handle.focus();
  await page.keyboard.press('Home');
  await expect(handle).toHaveAttribute('aria-valuenow', '360');
  await page.keyboard.press('End');
  const max = Number(await handle.getAttribute('aria-valuemax'));
  await expect(handle).toHaveAttribute('aria-valuenow', String(max));
  const workspace = (await page.locator('[data-chat-workspace]').boundingBox())!;
  expect(workspace.width - (await pane.boundingBox())!.width).toBeGreaterThanOrEqual(400);
  await page.setViewportSize({ width: 1100, height: 760 });
  await expect.poll(async () => (await pane.boundingBox())!.width).toBeLessThan(max);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(handle).toHaveAttribute('aria-valuenow', String(max));
  await handle.dblclick();
  await expect(handle).toHaveAttribute('aria-valuenow', '480');
  await page.getByRole('button', { name: 'Collapse context sidebar', exact: true }).click();
  await expect(handle).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand context sidebar', exact: true }).click();
  await expect(handle).toHaveAttribute('aria-valuenow', '480');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x - 49, box.y + 150, { steps: 5 });
  await expect(handle).toHaveAttribute('data-resizing', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  await expect(handle).toHaveAttribute('data-resizing', 'false');
  expect(await page.evaluate(() => ({ cursor: document.body.style.cursor, select: document.body.style.userSelect }))).toEqual({ cursor: '', select: '' });
  const stoppedWidth = await handle.getAttribute('aria-valuenow');
  await page.mouse.move(500, 300);
  await expect(handle).toHaveAttribute('aria-valuenow', stoppedWidth!);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Research tools', exact: true }).click();
  await expect(handle).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: screenshotPath('right-sidebar-mobile.png') });
});

for (const width of [1440, 768, 390, 320]) {
  test(`more tools keeps the composer compact and opens accessibly at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, { theme: width === 768 || width === 320 ? 'dark' : 'light' });
    await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.locator('.composer-more-tools')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Start voice input' })).toBeHidden();
    const more = page.getByRole('button', { name: 'More tools', exact: true });
    await expect(page.getByRole('button', { name: 'Model and execution settings', exact: true })).toBeVisible();
    await more.click();
    const panel = page.getByRole('dialog', { name: 'More tools', exact: true });
    await expect(panel).toBeVisible();
    const bounds = (await panel.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    if (width <= 768) {
      expect(await panel.evaluate(el => el.matches(':modal'))).toBe(true);
      expect(bounds.y + bounds.height).toBeCloseTo(900, 0);
    }
    await expect(panel.getByRole('button', { name: 'Start voice input' })).toBeVisible();
    await page.screenshot({ path: screenshotPath(`composer-more-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(more).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('message queue sends FIFO one turn at a time and preserves a newer draft', async ({ page }) => {
  let socket: WebSocketRoute; const commands: any[] = [];
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { socket = ws; ws.onMessage(value => commands.push(JSON.parse(String(value)))); });
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  const sent = () => commands.filter(command => command.type === 'claude-command');
  await input.fill('First request'); await input.press('Enter');
  await expect.poll(() => sent().length).toBe(1);
  await page.getByRole('button', { name: 'More tools', exact: true }).click();
  await page.keyboard.press('Escape');
  expect(commands.filter(command => command.type === 'abort-session')).toHaveLength(0);
  for (const text of ['Second request', 'Third request']) { await input.fill(text); await input.press('Enter'); }
  await expect(page.getByRole('region', { name: 'Message queue' })).toContainText('Queued: 2');
  await input.fill('Unsent working draft');
  expect(sent().length).toBe(1);
  socket!.send(JSON.stringify({ type: 'claude-complete', sessionId: 'research-session', exitCode: 0 }));
  await expect.poll(() => sent().length).toBe(2);
  expect(sent()[1].command).toBe('Second request');
  expect(sent()[1].options.sessionId).toBe('research-session');
  await expect(input).toHaveValue('Unsent working draft');
  await page.screenshot({ path: screenshotPath('composer-queue.png') });
  socket!.send(JSON.stringify({ type: 'claude-complete', sessionId: 'research-session', exitCode: 0 }));
  await expect.poll(() => sent().length).toBe(3);
  expect(sent()[2].command).toBe('Third request');
  await expect(input).toHaveValue('Unsent working draft');
  await expect(page.getByRole('region', { name: 'Message queue' })).toHaveCount(0);
});

for (const outcome of ['stop', 'error']) {
  test(`message queue pauses on ${outcome} and resumes explicitly`, async ({ page }) => {
    let socket: WebSocketRoute; const commands: any[] = [];
    await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { socket = ws; ws.onMessage(value => commands.push(JSON.parse(String(value)))); });
    await fixture(page);
    await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Message', exact: true });
    await input.fill('First request'); await input.press('Enter');
    await input.fill('Retain queued work'); await input.press('Enter');
    if (outcome === 'stop') {
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      socket!.send(JSON.stringify({ type: 'session-aborted', sessionId: 'research-session', success: true }));
    } else socket!.send(JSON.stringify({ type: 'claude-error', sessionId: 'research-session', error: 'Test provider failure' }));
    const queue = page.getByRole('region', { name: 'Message queue' });
    await expect(queue).toContainText('Queue paused');
    expect(commands.filter(command => command.type === 'claude-command')).toHaveLength(1);
    await queue.getByRole('button', { name: 'Continue queue' }).click();
    await expect.poll(() => commands.filter(command => command.type === 'claude-command').length).toBe(2);
  });
}

test('message queue remains with its conversation when switching projects', async ({ page }) => {
  let socket: WebSocketRoute; const commands: any[] = [];
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { socket = ws; ws.onMessage(value => commands.push(JSON.parse(String(value)))); });
  await fixture(page, { secondProject: true });
  await page.locator('main article').filter({ hasText: 'Sparse representation research' }).getByRole('button', { name: 'Continue', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('First conversation'); await input.press('Enter');
  await input.fill('Only for the first project'); await input.press('Enter');
  await page.getByRole('button', { name: 'Projects', exact: true }).first().click();
  await page.locator('main article').filter({ hasText: 'Another research project' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Start research', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Message queue' })).toHaveCount(0);
  await input.fill('Draft for the other project');
  socket!.send(JSON.stringify({ type: 'claude-complete', sessionId: 'research-session', exitCode: 0 }));
  await expect(input).toHaveValue('Draft for the other project');
  expect(commands.filter(command => command.type === 'claude-command')).toHaveLength(1);
  await page.getByRole('button', { name: 'Projects', exact: true }).first().click();
  await page.locator('main article').filter({ hasText: 'Sparse representation research' }).getByRole('button', { name: 'Continue', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Message queue' });
  await expect(queue).toContainText('Only for the first project');
  await expect(queue).toContainText('Queue paused');
  await queue.getByRole('button', { name: 'Remove queued message 1' }).click();
  await expect(queue).toHaveCount(0);
});

test('message queue retains failed attachments for retry without changing the new draft', async ({ page }) => {
  let socket: WebSocketRoute; const commands: any[] = []; let fail = true; let uploads = 0;
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { socket = ws; ws.onMessage(value => commands.push(JSON.parse(String(value)))); });
  await fixture(page);
  await page.route('**/api/projects/*/upload-files', route => {
    uploads++;
    return route.fulfill(fail ? { status: 503, json: { error: 'Test outage' } } : { json: { files: [{ name: 'evidence.txt', path: '/research/representation/evidence.txt' }] } });
  });
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('First request'); await input.press('Enter');
  await page.locator('form input[type=file]').setInputFiles({ name: 'evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('Observed evidence') });
  await input.fill('Read this evidence'); await input.press('Enter');
  await input.fill('Keep this separate draft');
  socket!.send(JSON.stringify({ type: 'claude-complete', sessionId: 'research-session', exitCode: 0 }));
  const queue = page.getByRole('region', { name: 'Message queue' });
  await expect(queue).toContainText('Queue paused');
  await expect(queue).toContainText('Read this evidence');
  await expect(input).toHaveValue('Keep this separate draft');
  expect(uploads).toBe(1);
  await queue.getByRole('button', { name: 'Edit queued message 1', exact: true }).click();
  await expect(queue).toContainText('evidence.txt');
  await queue.getByRole('textbox').fill('Compare this evidence after retry');
  await queue.getByRole('button', { name: 'Save changes', exact: true }).click();
  fail = false;
  await queue.getByRole('button', { name: 'Continue queue' }).click();
  await expect.poll(() => commands.filter(command => command.type === 'claude-command').length).toBe(2);
  expect(commands.filter(command => command.type === 'claude-command')[1].command).toContain('/research/representation/evidence.txt');
  await expect(input).toHaveValue('Keep this separate draft');
  expect(commands.filter(command => command.type === 'claude-command')[1].command).toContain('Compare this evidence after retry');
  expect(uploads).toBe(2);
});

test('message queue follows a newly assigned session identity', async ({ page }) => {
  let socket: WebSocketRoute; const commands: any[] = [];
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { socket = ws; ws.onMessage(value => commands.push(JSON.parse(String(value)))); });
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'New Session', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Start a new conversation'); await input.press('Enter');
  await expect.poll(() => commands.filter(command => command.type === 'claude-command').length).toBe(1);
  expect(commands.find(command => command.type === 'claude-command').options.sessionId).toBeFalsy();
  await input.fill('Follow up in the same conversation'); await input.press('Enter');
  socket!.send(JSON.stringify({ type: 'session-created', sessionId: 'created-queue-session', provider: 'claude' }));
  await expect(page).toHaveURL(/created-queue-session/);
  socket!.send(JSON.stringify({ type: 'claude-complete', sessionId: 'created-queue-session', exitCode: 0 }));
  await expect.poll(() => commands.filter(command => command.type === 'claude-command').length).toBe(2);
  expect(commands.filter(command => command.type === 'claude-command')[1].options.sessionId).toBe('created-queue-session');
});

test('message queue expands custom commands in FIFO order without replacing a newer draft', async ({ page }) => {
  let socket: WebSocketRoute; const commands: any[] = [];
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { socket = ws; ws.onMessage(value => commands.push(JSON.parse(String(value)))); });
  await fixture(page);
  await page.route('**/api/commands/list', route => route.fulfill({ json: { builtIn: [], custom: [{ name: '/review-evidence', description: 'Review evidence', path: '/commands/review.md' }] } }));
  await page.route('**/api/commands/execute', route => route.fulfill({ json: { type: 'custom', content: 'Expanded evidence review request', hasBashCommands: false } }));
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  const sent = () => commands.filter(command => command.type === 'claude-command');
  await input.fill('Initial request'); await input.press('Enter');
  await input.fill('/review-evidence source');
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await input.fill('Last request'); await input.press('Enter');
  await input.fill('Keep this draft');
  socket!.send(JSON.stringify({ type: 'claude-complete', sessionId: 'research-session', exitCode: 0 }));
  await expect.poll(() => sent().length).toBe(2);
  expect(sent()[1].command).toBe('Expanded evidence review request');
  await expect(input).toHaveValue('Keep this draft');
  socket!.send(JSON.stringify({ type: 'claude-complete', sessionId: 'research-session', exitCode: 0 }));
  await expect.poll(() => sent().length).toBe(3);
  expect(sent()[2].command).toBe('Last request');
});

const contextTrace = [
  ...Array.from({ length: 8 }, (_, index) => ({
    type: 'tool_use', toolName: 'Read', toolId: `context-read-${index}`,
    timestamp: '2026-10-23T10:00:00Z',
    toolInput: { file_path: `/research/representation/Survey/evidence/source-comparison-${index + 1}.md` },
  })),
  { type: 'tool_use', toolName: 'TodoWrite', toolId: 'context-todo', timestamp: '2026-10-23T10:01:00Z', toolInput: { todos: [{ content: 'Compare baseline measurements across the retrieved studies', status: 'in_progress' }] } },
  ...['reconstruction-results.md', 'baseline-comparison.md'].map((name, index) => ({
    type: 'tool_use', toolName: 'Write', toolId: `context-output-${index}`,
    timestamp: '2026-10-23T10:02:00Z', toolInput: { file_path: `Publication/${name}`, content: '# Results' },
  })),
];

async function openContextPanel(page: Page, width: number, theme = 'light', language = 'en') {
  await page.setViewportSize({ width, height: 900 });
  await fixture(page, { theme, language });
  await page.route('**/api/projects/research-fixture/sessions/research-session/messages*', route => route.fulfill({ json: { messages: contextTrace, hasMore: false, total: contextTrace.length } }));
  await page.route('**/api/projects/research-fixture/sessions/research-session/context-review', route => route.fulfill({ json: { reviews: {} } }));
  await page.locator('main article').getByRole('button', { name: language === 'zh-CN' ? '继续' : language === 'ko' ? '계속' : 'Continue', exact: true }).click();
  if (width <= 768) await page.getByRole('button', { name: language === 'zh-CN' ? '研究工具' : language === 'ko' ? '연구 도구' : 'Research tools', exact: true }).click();
  else await page.getByRole('button', { name: 'Expand context sidebar', exact: true }).click();
  const pane = page.locator('aside').last();
  await expect(pane.getByText('source-comparison-1.md', { exact: true })).toBeVisible();
  return pane;
}

for (const [width, theme] of [[1440, 'light'], [768, 'light'], [390, 'dark'], [320, 'dark']] as const) {
  test(`context evidence rows and preview remain usable at ${width}px`, async ({ page }) => {
    const pane = await openContextPanel(page, width, theme);
    await page.screenshot({ path: screenshotPath(`context-evidence-${width}.png`) });
    const trigger = pane.getByText('source-comparison-1.md', { exact: true });
    await trigger.click();
    const preview = page.getByRole('dialog', { name: 'source-comparison-1.md', exact: true });
    await expect(preview).toBeVisible();
    expect(await preview.evaluate(el => el.matches(':modal'))).toBe(true);
    await expect(preview.getByText('A reproducible comparison of baseline results.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
    await expect(pane.getByRole('button', { name: /^source-comparison-1.md/ })).toBeFocused();
    expect(await pane.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const filename = await trigger.boundingBox();
    expect(filename!.width).toBeGreaterThan(150);
    const section = pane.locator('section').first();
    await section.getByRole('button', { name: 'Show 5 more', exact: true }).click();
    await expect(section.getByText('source-comparison-8.md', { exact: true })).toBeVisible();
    const toggle = section.getByRole('button', { name: /^Referenced Context/ });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(section.getByText('source-comparison-1.md', { exact: true })).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    if (width <= 768) {
      expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test('context reviews retain unread state on save failure, retry, and restore focus after filtering', async ({ page }) => {
  const pane = await openContextPanel(page, 390, 'dark');
  let fail = true;
  let writes = 0;
  let stored: Record<string, unknown> = {};
  await page.route('**/api/projects/research-fixture/sessions/research-session/context-review', route => {
    if (route.request().method() === 'PUT') {
      writes++;
      if (fail) return route.fulfill({ status: 503, json: {} });
      stored = route.request().postDataJSON().reviews;
    }
    return route.fulfill({ json: { reviews: stored } });
  });
  const review = pane.locator('section').last();
  await review.getByRole('button', { name: 'Unread', exact: true }).click();
  const output = review.getByRole('button', { name: /^baseline-comparison.md/ });
  await output.click();
  const dialog = page.getByRole('dialog', { name: 'baseline-comparison.md', exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => writes).toBe(1);
  await page.keyboard.press('Escape');
  await expect(output).toBeFocused();
  await expect(review.getByRole('alert')).toContainText('remains unread');
  await expect(output).toBeVisible();
  fail = false;
  await review.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(output).toHaveCount(0);
  await expect(review.getByRole('alert')).toHaveCount(0);
  await review.getByRole('button', { name: /^reconstruction-results.md/ }).click();
  await expect.poll(() => Object.keys(stored).length).toBe(2);
  await page.keyboard.press('Escape');
  await expect(review.getByRole('button', { name: 'Unread', exact: true })).toBeFocused();
  await expect(review).toContainText('No outputs match this filter.');
  await review.getByRole('button', { name: 'Reviewed', exact: true }).click();
  await expect(review.getByRole('button', { name: /^baseline-comparison.md/ })).toBeVisible();
  await expect(review.getByRole('button', { name: /^reconstruction-results.md/ })).toBeVisible();
  await page.screenshot({ path: screenshotPath('context-reviewed-mobile.png') });
});

test('context trace offers retry without clearing the conversation draft', async ({ page }) => {
  await fixture(page);
  let fail = true;
  await page.route('**/api/projects/research-fixture/sessions/research-session/messages*', route => {
    const fullTrace = !new URL(route.request().url()).searchParams.has('limit');
    return route.fulfill({ status: fullTrace && fail ? 503 : 200, json: { messages: contextTrace, hasMore: false, total: contextTrace.length } });
  });
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Expand context sidebar', exact: true }).click();
  const pane = page.locator('aside').last();
  await expect(pane.getByRole('alert')).toContainText('Failed to load the full session trace');
  const draft = page.getByRole('textbox', { name: 'Message', exact: true });
  await draft.fill('Keep the question while retrying');
  fail = false;
  await pane.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(pane.getByRole('alert')).toHaveCount(0);
  await expect(draft).toHaveValue('Keep the question while retrying');
});

for (const [language, showMore] of [['zh-CN', '再显示 5 项'], ['ko', '5개 더 보기']]) {
  test(`context controls fit a narrow localized panel in ${language}`, async ({ page }) => {
    const pane = await openContextPanel(page, 320, 'dark', language);
    await expect(pane.getByRole('button', { name: showMore, exact: true })).toBeVisible();
    expect(await pane.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: screenshotPath(`context-${language}-320.png`) });
    await pane.getByRole('button', { name: showMore, exact: true }).click();
    await pane.getByRole('button', { name: /^source-comparison-8.md/ }).click();
    const preview = page.getByRole('dialog', { name: 'source-comparison-8.md', exact: true });
    await expect(preview).toBeVisible();
    expect(await preview.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(pane.getByRole('button', { name: /^source-comparison-8.md/ })).toBeFocused();
  });
}

test('context review load errors cannot overwrite previous acknowledgements', async ({ page }) => {
  await openContextPanel(page, 1440);
  let fail = true;
  let writes = 0;
  await page.route('**/api/projects/research-fixture/sessions/research-session/context-review', route => {
    if (route.request().method() === 'PUT') writes++;
    return route.fulfill({ status: fail ? 503 : 200, json: { reviews: {} } });
  });
  await page.reload();
  const pane = page.getByRole('complementary', { name: 'Session Context' });
  const review = pane.locator('section').last();
  await expect(review.getByRole('alert')).toContainText('Could not load review status');
  await review.getByRole('button', { name: /^baseline-comparison.md/ }).click();
  await expect(page.getByRole('dialog', { name: 'baseline-comparison.md' })).toBeVisible();
  expect(writes).toBe(0);
  await page.keyboard.press('Escape');
  fail = false;
  await review.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(review.getByRole('alert')).toHaveCount(0);
  await review.getByRole('button', { name: /^baseline-comparison.md/ }).click();
  await expect.poll(() => writes).toBe(1);
});

test('context review saves serialize rapid openings without losing earlier acknowledgements', async ({ page }) => {
  const pane = await openContextPanel(page, 1440);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/projects/research-fixture/sessions/research-session/context-review', async route => {
    if (route.request().method() === 'PUT') {
      writes.push(route.request().postDataJSON().reviews);
      if (writes.length === 1) await pending;
    }
    await route.fulfill({ json: { success: true } });
  });
  const review = pane.locator('section').last();
  await review.getByRole('button', { name: /^baseline-comparison.md/ }).click();
  await expect.poll(() => writes.length).toBe(1);
  await page.keyboard.press('Escape');
  await review.getByRole('button', { name: /^reconstruction-results.md/ }).click();
  await expect(page.getByRole('dialog', { name: 'reconstruction-results.md' })).toBeVisible();
  expect(writes).toHaveLength(1);
  release();
  await expect.poll(() => writes.length).toBe(2);
  expect(Object.keys(writes[1]).sort()).toEqual(['Publication/baseline-comparison.md', 'Publication/reconstruction-results.md']);
});

test('theme changes keep context labels readable on every rendered frame', async ({ page }) => {
  await openContextPanel(page, 1440);
  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
  for (const dark of [true, false]) {
    const colors = await page.evaluate(async dark => {
      const toggle = document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Toggle dark mode"]')!;
      const label = document.querySelector('aside[aria-label="Session Context"] h2 button')!;
      toggle.click();
      const samples: string[] = [];
      for (let frame = 0; frame < 12; frame++) {
        await new Promise(requestAnimationFrame);
        if (document.documentElement.classList.contains('dark') === dark) samples.push(getComputedStyle(label).color);
      }
      return samples;
    }, dark);
    expect(colors.length).toBeGreaterThan(5);
    expect(new Set(colors).size).toBe(1);
  }
});

for (const width of [1440, 390, 320]) {
  test(`file workspace rows remain readable and keyboard accessible at ${width}px`, async ({ page }) => {
    const pane = await openContextPanel(page, width);
    await pane.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(pane.getByText('Publication', { exact: true })).toBeVisible();
    const folder = pane.getByRole('button', { name: 'Publication', exact: true });
    await folder.focus();
    await page.keyboard.press('Enter');
    await expect(folder).toHaveAttribute('aria-expanded', 'true');
    const file = pane.getByRole('button', { name: 'results.md', exact: true });
    await expect(file).toBeVisible();
    for (const mode of ['Simple view', 'Compact view', 'Detailed view']) {
      await pane.getByRole('button', { name: mode, exact: true }).click();
      await expect(pane.getByRole('button', { name: mode, exact: true })).toHaveAttribute('aria-pressed', 'true');
      expect(await file.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    if (width < 769) {
      for (const target of await pane.locator('.file-row-actions button').all()) {
        const box = await target.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
    }
    expect(await pane.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: screenshotPath(`file-workspace-${width}.png`), animations: 'disabled' });
  });
}


test('narrow sidebar keeps the brand and project name readable without hiding actions', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.addInitScript(() => localStorage.setItem('dr-claw-sidebar-width', '220'));
  await fixture(page);
  for (const locator of [page.locator('[data-sidebar-brand]'), page.locator('[data-sidebar-project-name]')]) {
    await expect(locator).toBeVisible();
    expect(await locator.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  const rename = page.getByRole('button', { name: 'Rename project (F2)', exact: true });
  await rename.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(rename).toBeFocused();
  await page.screenshot({ path: screenshotPath('narrow-sidebar-readable.png') });
});

for (const width of [1440, 320]) {
  test(`file workspace distinguishes failed loads from empty folders and retries at ${width}px`, async ({ page }) => {
    const pane = await openContextPanel(page, width);
    let failRoot = true, failDirectory = true, failSearch = true;
    await page.route('**/api/projects/research-fixture/files*', route => {
      const params = new URL(route.request().url()).searchParams;
      const search = params.get('maxDepth') === '10';
      const directory = params.has('path');
      if (search ? failSearch : directory ? failDirectory : failRoot) return route.fulfill({ status: 503, json: { error: 'Test outage' } });
      return route.fulfill({ json: search ? [{ name: 'deep-evidence.md', path: '/research/representation/deep-evidence.md', type: 'file', size: 4096 }]
        : directory ? [] : [{ name: 'Publication', path: '/research/representation/Publication', type: 'directory', children: null }] });
    });
    await pane.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(pane.getByRole('alert')).toContainText('Could not load files');
    await expect(pane.getByText('No files found', { exact: true })).toHaveCount(0);
    failRoot = false;
    await pane.getByRole('button', { name: 'Retry', exact: true }).click();
    await pane.getByRole('button', { name: 'Publication', exact: true }).click();
    await expect(pane.getByRole('alert')).toContainText('Could not open this folder');
    failDirectory = false;
    await pane.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(pane.getByText('This folder is empty.', { exact: true })).toBeVisible();
    await pane.getByRole('textbox', { name: 'Search files and folders...' }).fill('deep-evidence');
    await expect(pane.getByRole('alert')).toContainText('Could not search all folders');
    await expect(pane.getByText('No matches found', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: screenshotPath(`file-search-failure-${width}.png`) });
    failSearch = false;
    await pane.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(pane.getByRole('button', { name: 'deep-evidence.md', exact: true })).toBeVisible();
    await expect(pane.getByRole('textbox')).toHaveValue('deep-evidence');
  });

  test(`file deletion keeps its dialog on failure and restores a useful focus after success at ${width}px`, async ({ page }) => {
    const pane = await openContextPanel(page, width);
    await pane.getByRole('button', { name: 'Files', exact: true }).click();
    await pane.getByRole('button', { name: 'Publication', exact: true }).click();
    let fail = true, attempts = 0;
    await page.route('**/api/projects/research-fixture/file', route => {
      attempts++;
      return route.fulfill(fail ? { status: 503, json: {} } : { json: { success: true } });
    });
    const row = pane.locator('.file-tree-row').filter({ has: page.getByRole('button', { name: 'results.md', exact: true }) });
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete', exact: true });
    expect(await dialog.evaluate(el => el.matches(':modal'))).toBe(true);
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Could not delete this item');
    await expect(row).toBeVisible();
    await page.screenshot({ path: screenshotPath(`file-delete-failure-${width}.png`) });
    fail = false;
    await page.route('**/api/projects/research-fixture/files*', route => route.fulfill({ json: [] }));
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(pane.getByRole('textbox', { name: 'Search files and folders...' })).toBeFocused();
    await expect(pane.getByText('No files found', { exact: true })).toBeVisible();
    expect(attempts).toBe(2);
  });
}

for (const width of [1440, 320]) {
  test(`queue editing holds its original place across turn completion at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let socket: WebSocketRoute; const commands: any[] = [];
    await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { socket = ws; ws.onMessage(value => commands.push(JSON.parse(String(value)))); });
    await fixture(page);
    await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Message', exact: true });
    const sent = () => commands.filter(command => command.type === 'claude-command');
    for (const text of ['First request', 'Second request', 'Third request']) {
      await input.fill(text); await input.press('Enter');
      if (text === 'First request') await expect.poll(() => sent().length).toBe(1);
    }
    await input.fill('A separate unsent draft');
    const queue = page.getByRole('region', { name: 'Message queue' });
    await queue.getByRole('button', { name: 'Edit queued message 2', exact: true }).click();
    const editor = queue.getByRole('textbox');
    await expect(editor).toBeFocused();
    await editor.fill('Revised third request\nKeep the evidence');
    socket!.send(JSON.stringify({ type: 'claude-complete', sessionId: 'research-session', exitCode: 0 }));
    await expect.poll(() => sent().length).toBe(2);
    expect(sent()[1].command).toBe('Second request');
    await expect(editor).toHaveValue('Revised third request\nKeep the evidence');
    socket!.send(JSON.stringify({ type: 'claude-complete', sessionId: 'research-session', exitCode: 0 }));
    await page.waitForTimeout(250);
    expect(sent()).toHaveLength(2);
    await expect(input).toHaveValue('A separate unsent draft');
    await page.screenshot({ path: screenshotPath(`queue-edit-${width}.png`), animations: 'disabled' });
    expect(await queue.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await queue.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(() => sent().length).toBe(3);
    expect(sent()[2].command).toBe('Revised third request\nKeep the evidence');
    await expect(queue).toHaveCount(0);
    await expect(input).toHaveValue('A separate unsent draft');
    await expect(input).toBeFocused();
  });
}

test('queue editing rejects blank messages and Escape keeps the original without aborting the reply', async ({ page }) => {
  let socket: WebSocketRoute; const commands: any[] = [];
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { socket = ws; ws.onMessage(value => commands.push(JSON.parse(String(value)))); });
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  const sent = () => commands.filter(command => command.type === 'claude-command');
  await input.fill('First'); await input.press('Enter');
  await expect.poll(() => sent().length).toBe(1);
  await input.fill('Keep the original'); await input.press('Enter');
  const queue = page.getByRole('region', { name: 'Message queue' });
  const edit = queue.getByRole('button', { name: 'Edit queued message 1', exact: true });
  await edit.click();
  await queue.getByRole('textbox').fill('   ');
  await expect(queue.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(edit).toBeFocused();
  await expect(queue).toContainText('Keep the original');
  expect(commands.filter(command => command.type === 'abort-session')).toHaveLength(0);
  socket!.send(JSON.stringify({ type: 'claude-complete', sessionId: 'research-session', exitCode: 0 }));
  await expect.poll(() => sent().length).toBe(2);
  expect(sent()[1].command).toBe('Keep the original');
});

for (const [language, continuation, message, edit, save] of [
  ['zh-CN', '继续', '消息', '编辑第 1 条排队消息', '保存修改'],
  ['ko', '계속', '메시지', '대기 메시지 1 수정', '변경 저장'],
]) {
  test(`queue editor fits a short localized mobile viewport in ${language}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const commands: any[] = [];
    await page.routeWebSocket(/\/ws(?:\?|$)/, ws => ws.onMessage(value => commands.push(JSON.parse(String(value)))));
    await fixture(page, { language, theme: 'dark' });
    await page.locator('main article').getByRole('button', { name: continuation, exact: true }).click();
    const input = page.getByRole('textbox', { name: message, exact: true });
    await input.fill('First request'); await input.press('Enter');
    await expect.poll(() => commands.filter(command => command.type === 'claude-command').length).toBe(1);
    await input.fill('跨语言研究 · 언어 연구'); await input.press('Enter');
    await page.getByRole('button', { name: edit, exact: true }).click();
    const editor = page.getByRole('textbox', { name: edit, exact: true });
    await expect(editor).toBeFocused();
    const saveButton = page.getByRole('button', { name: save, exact: true });
    await saveButton.scrollIntoViewIfNeeded();
    const box = (await saveButton.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(568);
    const tools = await page.getByRole('button', { name: language === 'zh-CN' ? '研究工具' : '연구 도구', exact: true }).boundingBox();
    const stop = await page.getByRole('button', { name: 'Stop', exact: true }).boundingBox();
    expect(stop!.y).toBeGreaterThanOrEqual(tools!.y + tools!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: screenshotPath(`queue-edit-${language}-320.png`), animations: 'disabled' });
    await saveButton.click();
    await expect(editor).toHaveCount(0);
  });
}

const gitFixture = { branch: 'research/baseline-reconstruction', hasCommits: true, modified: ['src/experiments/baseline-reconstruction-evaluation.py'], added: [], deleted: [], untracked: ['notes/new-evidence.md'] };
const gitCommits = [{ hash: '9b45a1d0000000000000000000000000000000000', message: 'Compare reconstruction error against the reproducible baseline', author: 'Researcher', date: '2026-10-23', stats: '1 file changed, 2 insertions(+)' }];
const gitDiffFixture = 'diff --git a/results.md b/results.md\n--- a/results.md\n+++ b/results.md\n@@ -1 +1 @@\n-Previous baseline\n+Verified baseline';
async function gitRoutes(page: Page) {
  await page.route('**/api/git/**', route => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith('/status') ? gitFixture : path.endsWith('/branches') ? { branches: [gitFixture.branch, 'main'] }
      : path.endsWith('/remote-status') ? { hasRemote: true, hasUpstream: true, remoteName: 'origin', ahead: 1, behind: 1, isUpToDate: false }
      : path.endsWith('/commits') ? { commits: gitCommits } : path.endsWith('/diff') || path.endsWith('/commit-diff') ? { diff: gitDiffFixture } : { success: true };
    return route.fulfill({ json: body });
  });
}
for (const width of [1440, 390]) {
  test(`code history panel layout at ${width}px`, async ({ page }) => {
    const pane = await openContextPanel(page, width);
    await gitRoutes(page);
    await pane.getByRole('button', { name: 'Code History', exact: true }).click();
    await expect(pane.getByRole('combobox', { name: 'Current branch' })).toHaveValue(gitFixture.branch);
    await page.screenshot({ path: screenshotPath(`git-workspace-${width}.png`), animations: 'disabled' });
  });
  test(`terminal workspace layout at ${width}px`, async ({ page }) => {
    await page.routeWebSocket(/\/shell(?:\?|$)/, ws => ws.onMessage(value => {
      if (JSON.parse(String(value)).type === 'init') ws.send(JSON.stringify({ type: 'output', data: '\r\nResearch workspace ready\r\n$ ' }));
    }));
    const pane = await openContextPanel(page, width);
    await pane.getByRole('button', { name: 'Shell', exact: true }).click();
    await expect(pane.locator('.xterm').first()).toBeVisible();
    await page.screenshot({ path: screenshotPath(`shell-workspace-${width}.png`), animations: 'disabled' });
  });
}

for (const width of [1440, 320]) {
  test(`git failures retain commit and branch drafts at ${width}px`, async ({ page }) => {
    const pane = await openContextPanel(page, width);
    await gitRoutes(page);
    const commits: unknown[] = [];
    await page.route('**/api/git/commit', route => {
      commits.push(route.request().postDataJSON());
      return route.fulfill({ status: commits.length === 1 ? 503 : 200, json: commits.length === 1 ? { error: 'Commit service unavailable' } : { success: true } });
    });
    let branchAttempts = 0;
    await page.route('**/api/git/create-branch', route => route.fulfill({ status: ++branchAttempts === 1 ? 503 : 200, json: branchAttempts === 1 ? { error: 'Branch locked' } : { success: true } }));
    await pane.getByRole('button', { name: 'Code History', exact: true }).click();
    await expect(pane.getByRole('checkbox').first()).toBeChecked();
    if (width < 768) await pane.locator('summary').filter({ hasText: 'Commit selected files' }).click();
    const input = pane.getByRole('textbox', { name: 'Commit message' });
    await input.fill('Preserve this commit description');
    const commit = pane.getByRole('button', { name: 'Commit', exact: true });
    await commit.click();
    const modal = page.getByRole('dialog', { name: 'Confirm: Commit', exact: true });
    expect(await modal.evaluate(el => el.matches(':modal'))).toBe(true);
    await modal.getByRole('button', { name: 'Commit', exact: true }).click();
    await expect(modal.getByRole('alert')).toBeVisible();
    await expect(input).toHaveValue('Preserve this commit description');
    await expect(modal).toContainText('Commit service unavailable');
    await page.screenshot({ path: screenshotPath(`git-commit-failure-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(commit).toBeFocused();
    await input.press('Control+Enter');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Commit', exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect(input).toHaveValue('');
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual(commits[1]);
    await pane.getByRole('button', { name: 'Create branch', exact: true }).click();
    const branchModal = page.getByRole('dialog', { name: 'Create branch', exact: true });
    await branchModal.getByRole('textbox', { name: 'Branch name' }).fill('research/kept-draft');
    await branchModal.getByRole('button', { name: 'Create branch', exact: true }).click();
    await expect(branchModal.getByRole('alert')).toBeVisible();
    await expect(branchModal.getByRole('textbox')).toHaveValue('research/kept-draft');
    await branchModal.getByRole('button', { name: 'Create branch', exact: true }).click();
    await expect(branchModal).toHaveCount(0);
    expect(branchAttempts).toBe(2);
    expect(await pane.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}

test('git read errors retry without false empty states and preserve selection', async ({ page }) => {
  const pane = await openContextPanel(page, 390);
  await gitRoutes(page);
  let statusUnavailable = true;
  await page.route('**/api/git/status?*', route => route.fulfill({ status: statusUnavailable ? 503 : 200, json: statusUnavailable ? { error: 'Status unavailable' } : gitFixture }));
  let historyUnavailable = true;
  await page.route('**/api/git/commits?*', route => route.fulfill({ status: historyUnavailable ? 503 : 200, json: historyUnavailable ? { error: 'History unavailable' } : { commits: gitCommits } }));
  let diffUnavailable = true;
  await page.route('**/api/git/diff?*', route => route.fulfill({ status: diffUnavailable ? 503 : 200, json: diffUnavailable ? { error: 'Diff unavailable' } : { diff: gitDiffFixture } }));
  await pane.getByRole('button', { name: 'Code History', exact: true }).click();
  await expect(pane.getByRole('alert')).toBeVisible();
  await expect(pane.getByText('No changes detected.')).toHaveCount(0);
  statusUnavailable = false;
  await pane.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(pane.getByRole('checkbox').first()).toBeChecked();
  await pane.getByRole('checkbox').first().uncheck();
  await pane.getByRole('button', { name: 'Refresh code history', exact: true }).click();
  await expect(pane.getByRole('checkbox').first()).not.toBeChecked();
  // Refresh retries history; fail it again to exercise the separate history retry.
  await page.route('**/api/git/commits?*', route => route.fulfill({ status: 503, json: { error: 'History unavailable' } }));
  await pane.getByRole('button', { name: 'Refresh code history', exact: true }).click();
  await pane.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(pane.getByRole('alert')).toBeVisible();
  await expect(pane.getByText('No commits found.')).toHaveCount(0);
  await page.route('**/api/git/commits?*', route => route.fulfill({ json: { commits: gitCommits } }));
  await pane.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(pane.getByRole('button', { name: gitCommits[0].message })).toBeVisible();
  await pane.getByRole('tab', { name: 'History', exact: true }).press('ArrowLeft');
  await expect(pane.getByRole('tab', { name: 'Changes (2)' })).toBeFocused();
  await pane.getByRole('button', { name: 'Diff', exact: true }).first().click();
  await expect(pane.getByRole('alert')).toBeVisible();
  diffUnavailable = false;
  await pane.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(pane.getByText('+Verified baseline', { exact: true })).toBeVisible();
  await expect(pane.getByRole('tab', { name: 'History', exact: true })).toBeVisible();
});

test('generated git message never overwrites edits made during generation', async ({ page }) => {
  const pane = await openContextPanel(page, 1440);
  await gitRoutes(page);
  let release: (() => void) | undefined;
  await page.route('**/api/git/generate-commit-message', async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { message: 'Generated description' } });
  });
  await pane.getByRole('button', { name: 'Code History', exact: true }).click();
  const draft = pane.getByRole('textbox', { name: 'Commit message' });
  await draft.fill('Original description');
  await pane.getByRole('button', { name: 'Generate message', exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await draft.fill('My newer description');
  release!();
  await expect(pane.getByText('Generated description', { exact: true })).toBeVisible();
  await expect(draft).toHaveValue('My newer description');
  await pane.getByRole('button', { name: 'Use suggestion', exact: true }).click();
  await expect(draft).toHaveValue('Generated description');
});

for (const width of [1440, 320]) {
  test(`terminal tabs open lazily and manual disconnect stays disconnected at ${width}px`, async ({ page }) => {
    const connections: { ws: WebSocketRoute; init: any[] }[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.routeWebSocket(/\/shell(?:\?|$)/, ws => {
      const entry = { ws, init: [] as any[] }; connections.push(entry);
      ws.onMessage(value => { const data = JSON.parse(String(value)); if (data.type === 'init') { entry.init.push(data); ws.send(JSON.stringify({ type: 'output', data: '\r\nResearch workspace ready\r\n$ ' })); } });
    });
    const pane = await openContextPanel(page, width);
    await pane.getByRole('button', { name: 'Shell', exact: true }).click();
    const workspace = pane.locator('[data-shell-workspace]');
    await expect.poll(() => connections[0]?.init.length).toBe(1);
    expect(connections).toHaveLength(1);
    expect(connections[0].init[0].isPlainShell).toBe(false);
    const session = workspace.getByRole('tab', { name: 'Evaluate the baseline', exact: true });
    await session.press('ArrowRight');
    await expect(workspace.getByRole('tab', { name: 'Shell 1', exact: true })).toBeFocused();
    await expect.poll(() => connections[1]?.init.length).toBe(1);
    expect(connections[1].init[0].isPlainShell).toBe(true);
    const hidden = workspace.locator('[role="tabpanel"][aria-hidden="true"]');
    expect(await hidden.evaluate(el => (el as HTMLElement).inert)).toBe(true);
    await hidden.locator('textarea').evaluate(el => (el as HTMLElement).focus());
    await expect(workspace.getByRole('tab', { name: 'Shell 1', exact: true })).toBeFocused();
    await workspace.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(workspace.getByText('Disconnected', { exact: true })).toBeVisible();
    await page.waitForTimeout(3250);
    expect(connections).toHaveLength(2);
    await workspace.getByRole('button', { name: 'Continue in Shell', exact: true }).click();
    await expect.poll(() => connections[2]?.init.length).toBe(1);
    await workspace.getByRole('button', { name: 'New shell', exact: true }).click();
    await expect(workspace.getByRole('tab', { name: 'Shell 2', exact: true })).toBeFocused();
    await expect.poll(() => connections[3]?.init.length).toBe(1);
    await workspace.getByRole('button', { name: 'Close Shell 2', exact: true }).click();
    await expect(workspace.getByRole('tab', { name: 'Shell 1', exact: true })).toBeFocused();
    await workspace.getByRole('button', { name: 'Close Shell 1', exact: true }).click();
    await expect(session).toBeFocused();
    await session.press('End');
    await expect(workspace.getByRole('tab', { name: 'Shell 3', exact: true })).toBeFocused();
    await expect.poll(() => connections[4]?.init.length).toBe(1);
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
    await page.screenshot({ path: screenshotPath(`shell-lifecycle-${width}.png`) });
  });
}

for (const language of ['zh-CN', 'ko']) {
  test(`localized git and terminal controls fit a short phone viewport in ${language}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const connections: WebSocketRoute[] = [];
    await page.routeWebSocket(/\/shell(?:\?|$)/, ws => { connections.push(ws); ws.onMessage(value => { if (JSON.parse(String(value)).type === 'init') ws.send(JSON.stringify({ type: 'output', data: '\r\nResearch workspace ready\r\n$ ' })); }); });
    const pane = await openContextPanel(page, 320, 'dark', language);
    await page.setViewportSize({ width: 320, height: 568 });
    await gitRoutes(page);
    await pane.getByRole('button', { name: language === 'zh-CN' ? '代码历史' : '코드 히스토리', exact: true }).click();
    const workspace = pane.locator('[data-git-workspace]');
    await expect(workspace.getByRole('combobox')).toHaveValue(gitFixture.branch);
    expect(await workspace.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await workspace.getByRole('tab').last().click();
    await workspace.getByRole('button', { name: gitCommits[0].message }).click();
    const diffLine = workspace.getByText('+Verified baseline', { exact: true });
    await diffLine.scrollIntoViewIfNeeded();
    await expect(diffLine).toBeVisible();
    expect((await diffLine.boundingBox())!.y + (await diffLine.boundingBox())!.height).toBeLessThanOrEqual((await workspace.boundingBox())!.y + (await workspace.boundingBox())!.height + 1);
    await page.screenshot({ path: screenshotPath(`git-history-${language}-320.png`) });
    await workspace.getByRole('button', { name: language === 'zh-CN' ? '创建分支' : '브랜치 만들기', exact: true }).click();
    const modal = page.getByRole('dialog');
    await modal.getByRole('textbox').fill('research/new-evidence');
    expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await pane.getByRole('button', { name: language === 'zh-CN' ? '终端' : '셸', exact: true }).click();
    await expect.poll(() => connections.length).toBe(1);
    await expect(pane.getByRole('button', { name: language === 'zh-CN' ? '断开连接' : '연결 끊기', exact: true })).toBeVisible();
    await page.waitForTimeout(250);
    expect(await pane.locator('[data-shell-workspace]').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: screenshotPath(`shell-${language}-320.png`) });
  });
}

test('narrow desktop session metadata stays within the sidebar', async ({ page }) => {
  await openContextPanel(page, 1100);
  const separator = page.getByRole('separator', { name: 'Resize sidebar', exact: true });
  await separator.focus(); await separator.press('Home');
  const metadata = page.locator('[data-session-metadata]');
  await expect(metadata).toBeVisible();
  expect(await metadata.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await metadata.locator('span').evaluateAll(nodes => nodes.every(el => el.getBoundingClientRect().right <= el.closest('[data-session-metadata]')!.getBoundingClientRect().right + 1))).toBe(true);
});

async function openSettingsPanel(page: Page, width: number, language = 'en', theme = 'light') {
  await page.setViewportSize({ width, height: 900 });
  await fixture(page, { language, theme });
  if (width < 769) await page.getByRole('button', { name: language === 'zh-CN' ? '打开菜单' : language === 'ko' ? '메뉴 열기' : 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: language === 'zh-CN' ? /^设置/ : language === 'ko' ? /^설정/ : /^Settings/ }).click();
  return page.getByRole('dialog', { name: language === 'zh-CN' ? '设置' : language === 'ko' ? '설정' : 'Settings', exact: true });
}
async function settingsFormRoutes(page: Page) {
  await page.route('**/api/settings/api-keys', route => route.fulfill({ json: { apiKeys: [{ id: 51, key_name: 'Research evaluation workstation with reproducible results', api_key: 'masked-review-fixture', is_active: true, created_at: '2026-10-23' }] } }));
  await page.route('**/api/settings/credentials?*', route => route.fulfill({ json: { credentials: [{ id: 52, credential_name: 'Research workspace integration credential', description: 'Used by the reproducible baseline evaluation workflow.', is_active: true, created_at: '2026-10-23' }] } }));
  await page.route('**/api/memory', route => route.fulfill({ json: { memories: [{ id: 71, content: 'Keep the baseline measurements and evaluation protocol together when comparing reconstruction error across experiments.', category: 'workflow', is_enabled: true, created_at: '2026-10-23' }] } }));
  await page.route('**/api/memory/settings', route => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/user/git-config', route => route.fulfill({ json: { gitName: 'Researcher', gitEmail: 'review@example.com' } }));
  await page.route('**/api/user/profile', route => route.fulfill({ json: { profile: { notificationEmail: 'research@example.com' } } }));
  await page.route('**/api/settings/auto-research-email', route => route.fulfill({ json: { senderEmail: 'notifications@example.com' } }));
  await page.route('**/api/settings/auto-research-resend-key', route => route.fulfill({ json: { maskedKey: 're_••••review' } }));
}
for (const width of [1440, 390]) {
  test(`populated settings forms layout at ${width}px`, async ({ page }) => {
    const dialog = await openSettingsPanel(page, width);
    await settingsFormRoutes(page);
    for (const [name, file] of [['Email', 'email'], ['Git', 'git'], ['API & Tokens', 'credentials']]) {
      await dialog.getByRole('tab', { name, exact: true }).click();
      await page.waitForTimeout(120);
      await page.screenshot({ path: screenshotPath(`settings-${file}-${width}.png`) });
    }
    await dialog.getByRole('tab', { name: 'Agents', exact: true }).click();
    await dialog.getByRole('button', { name: 'Memory', exact: true }).click();
    await expect(dialog.getByText('Keep the baseline measurements and evaluation protocol together when comparing reconstruction error across experiments.', { exact: true })).toBeVisible();
    await page.screenshot({ path: screenshotPath(`settings-memory-${width}.png`) });
  });
}

for (const width of [1440, 320]) {
  test(`settings git and email preserve failed edits and prevent duplicate submissions at ${width}px`, async ({ page }) => {
    const dialog = await openSettingsPanel(page, width);
    await settingsFormRoutes(page);
    let writes = 0;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/user/git-config', async route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { gitName: 'Researcher', gitEmail: 'review@example.com' } });
      writes++; await held; await route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } });
    });
    await dialog.getByRole('tab', { name: 'Git', exact: true }).click();
    const git = dialog.locator('[data-git-settings]');
    const fields = git.getByRole('textbox');
    await expect(fields.first()).toHaveValue('Researcher');
    await fields.first().fill('Edited researcher');
    await fields.last().fill('changed@example.com');
    await git.getByRole('button', { name: 'Save Configuration' }).click();
    await expect(fields.first()).toBeDisabled();
    await git.locator('form').evaluate(el => { el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(writes).toBe(1);
    release();
    await expect(git.getByRole('alert')).toBeVisible();
    await expect(fields.first()).toHaveValue('Edited researcher');
    await expect(fields.last()).toHaveValue('changed@example.com');
    await expect(fields.first()).toBeEnabled();
    await page.screenshot({ path: screenshotPath(`settings-git-failure-${width}.png`) });
    await page.route('**/api/user/git-config', route => route.fulfill({ json: { success: true } }));
    await git.getByRole('button', { name: 'Save Configuration' }).click();
    await expect(git.getByRole('status')).toHaveText('Saved.');
    await dialog.getByRole('tab', { name: 'Email', exact: true }).click();
    const recipient = dialog.locator('[data-email-field="recipient"]');
    await expect(recipient.getByLabel('Recipient Email')).toHaveValue('research@example.com');
    await recipient.getByLabel('Recipient Email').fill('updated@example.com');
    await page.route('**/api/user/profile', route => route.fulfill({ status: 500, json: { error: 'Fixture failure' } }));
    await recipient.getByRole('button', { name: 'Save Notification Email' }).click();
    await expect(recipient.getByRole('alert')).toBeVisible();
    await expect(recipient.getByLabel('Recipient Email')).toHaveValue('updated@example.com');
    await page.route('**/api/user/profile', route => route.fulfill({ json: { profile: { notificationEmail: 'updated@example.com' } } }));
    await recipient.getByRole('button', { name: 'Save Notification Email' }).click();
    await expect(recipient.getByRole('status')).toHaveText('Saved.');
    const delivery = dialog.locator('[data-email-field="delivery"]');
    await delivery.getByLabel('Delivery Key').fill('fake-resend-test-key');
    await page.route('**/api/settings/auto-research-resend-key', route => route.fulfill({ status: 500, json: { error: 'Fixture failure' } }));
    await delivery.getByRole('button', { name: 'Save Delivery Key' }).click();
    await expect(delivery.getByRole('alert')).toBeVisible();
    await expect(delivery.getByLabel('Delivery Key')).toHaveValue('fake-resend-test-key');
    await page.route('**/api/settings/auto-research-resend-key', route => route.fulfill({ json: { maskedKey: 're_••••updated' } }));
    await delivery.getByRole('button', { name: 'Save Delivery Key' }).click();
    await expect(delivery.getByLabel('Delivery Key')).toHaveValue('');
    await expect(delivery.getByText('Configured key: re_••••updated')).toBeVisible();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test(`credential create toggle and delete failures preserve state at ${width}px`, async ({ page }) => {
    const dialog = await openSettingsPanel(page, width);
    await settingsFormRoutes(page);
    await dialog.getByRole('tab', { name: 'API & Tokens', exact: true }).click();
    const group = dialog.locator('[data-credential-group="github"]');
    await group.getByRole('button', { name: 'Add Token', exact: true }).click();
    await expect(group.getByLabel('Name', { exact: true })).toBeFocused();
    await group.getByLabel('Name', { exact: true }).fill('Research integration');
    await group.getByLabel('GitHub token').fill('fake-github-test-token');
    await group.getByLabel('Description (optional)').fill('Baseline workflow');
    await group.getByRole('button', { name: 'Show secret' }).click();
    await expect(group.getByLabel('GitHub token')).toHaveAttribute('type', 'text');
    let creates = 0;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/settings/credentials', async route => { creates++; await held; await route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } }); });
    await group.locator('form').getByRole('button', { name: 'Add Token' }).click();
    await expect(group.getByLabel('GitHub token')).toBeDisabled();
    await group.locator('form').evaluate(el => { el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(creates).toBe(1);
    release();
    await expect(group.getByRole('alert')).toBeVisible();
    await expect(group.getByLabel('Name', { exact: true })).toHaveValue('Research integration');
    await expect(group.getByLabel('GitHub token')).toHaveValue('fake-github-test-token');
    await page.screenshot({ path: screenshotPath(`settings-credential-failure-${width}.png`) });
    await group.locator('form').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(group.getByRole('button', { name: 'Add Token', exact: true })).toBeFocused();
    await page.route('**/api/settings/credentials/52/toggle', route => route.fulfill({ status: 500, json: { error: 'Fixture failure' } }));
    await group.getByRole('switch').click();
    await expect(group.getByRole('alert')).toBeVisible();
    await expect(group.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await page.route('**/api/settings/credentials/52/toggle', route => route.fulfill({ json: { success: true } }));
    await group.getByRole('switch').click();
    await expect(group.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await group.getByRole('button', { name: /^Delete Research/ }).click();
    const confirmation = page.getByRole('dialog', { name: 'Delete credential', exact: true });
    await page.route('**/api/settings/credentials/52', route => route.fulfill({ status: 500, json: { error: 'Fixture failure' } }));
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(confirmation.getByRole('alert')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirmation).toHaveCount(0);
    await expect(group.getByRole('button', { name: /^Delete Research/ })).toBeFocused();
    await expect(dialog).toBeVisible();
    await group.getByRole('button', { name: /^Delete Research/ }).click();
    await page.route('**/api/settings/credentials/52', route => route.fulfill({ json: { success: true } }));
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(group.locator('[data-credential-row]')).toHaveCount(0);
    await expect(group.getByRole('button', { name: 'Add Token', exact: true })).toBeFocused();
  });

  test(`memory edit and delete keep failed input and keyboard focus at ${width}px`, async ({ page }) => {
    const dialog = await openSettingsPanel(page, width);
    await settingsFormRoutes(page);
    await dialog.getByRole('button', { name: 'Memory', exact: true }).click();
    const memory = dialog.locator('[data-memory-settings]');
    const row = memory.locator('[data-memory-row]');
    await row.getByRole('button', { name: 'Edit memory', exact: true }).click();
    await expect(row.getByLabel('Memory content')).toBeFocused();
    await row.getByLabel('Memory content').fill('Keep this edited research preference.');
    await row.getByLabel('Category').selectOption('preference');
    await page.route('**/api/memory/71', route => route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } }));
    await row.getByRole('button', { name: 'Save changes' }).click();
    await expect(memory.getByRole('alert')).toBeVisible();
    await expect(row.getByLabel('Memory content')).toHaveValue('Keep this edited research preference.');
    await expect(row.getByLabel('Category')).toHaveValue('preference');
    await page.screenshot({ path: screenshotPath(`settings-memory-failure-${width}.png`) });
    await page.route('**/api/memory/71', route => route.fulfill({ json: { memory: { id: 71, content: 'Keep this edited research preference.', category: 'preference', is_enabled: true, created_at: '2026-10-23' } } }));
    await row.getByRole('button', { name: 'Save changes' }).click();
    await expect(row.getByRole('button', { name: 'Edit memory', exact: true })).toBeFocused();
    await expect(row.getByText('Keep this edited research preference.')).toBeVisible();
    await page.route('**/api/memory/settings', route => route.fulfill({ status: 500, json: { error: 'Fixture failure' } }));
    await memory.getByRole('switch', { name: 'Use saved memories', exact: true }).click();
    await expect(memory.getByRole('alert')).toBeVisible();
    await expect(memory.getByRole('switch', { name: 'Use saved memories', exact: true })).toHaveAttribute('aria-checked', 'true');
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Delete memory', exact: true });
    await page.route('**/api/memory/71', route => route.fulfill({ status: 500, json: { error: 'Fixture failure' } }));
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(confirmation.getByRole('alert')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(row.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
    await expect(dialog).toBeVisible();
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.route('**/api/memory/71', route => route.fulfill({ json: { success: true } }));
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(memory.getByLabel('Memory content')).toBeFocused();
  });
}

test('settings load failures expose retry rather than empty success', async ({ page }) => {
  const dialog = await openSettingsPanel(page, 390);
  await settingsFormRoutes(page);
  await page.route('**/api/settings/credentials?type=github_token', route => route.fulfill({ status: 500, json: { error: 'Fixture failure' } }));
  await dialog.getByRole('tab', { name: 'API & Tokens', exact: true }).click();
  const group = dialog.locator('[data-credential-group="github"]');
  await expect(group.getByRole('alert')).toBeVisible();
  await expect(group.getByRole('button', { name: 'Add Token', exact: true })).toBeDisabled();
  await expect(group.getByText('No GitHub tokens configured')).toHaveCount(0);
  await page.route('**/api/settings/credentials?type=github_token', route => route.fulfill({ json: { credentials: [] } }));
  await group.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(group.getByRole('button', { name: 'Add Token', exact: true })).toBeEnabled();
  await expect(group.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('tab', { name: 'Agents', exact: true }).click();
  await page.route('**/api/memory', route => route.fulfill({ status: 500, json: { error: 'Fixture failure' } }));
  await dialog.getByRole('button', { name: 'Memory', exact: true }).click();
  const memory = dialog.locator('[data-memory-settings]');
  await expect(memory.getByRole('alert')).toBeVisible();
  await expect(memory.getByRole('switch')).toHaveCount(0);
  await expect(memory.getByText('No memories saved yet.')).toHaveCount(0);
  await page.route('**/api/memory', route => route.fulfill({ json: { memories: [] } }));
  await memory.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(memory.getByText('No memories saved yet.')).toBeVisible();
  await expect(memory.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});

test('new API key stays available until acknowledged and reports failed copying', async ({ page }) => {
  const dialog = await openSettingsPanel(page, 390);
  await settingsFormRoutes(page);
  await dialog.getByRole('tab', { name: 'API & Tokens', exact: true }).click();
  const group = dialog.locator('[data-credential-group="api"]');
  await group.getByRole('button', { name: 'New API Key' }).click();
  await group.getByLabel('Name', { exact: true }).fill('Fixture key');
  await page.route('**/api/settings/api-keys', route => route.fulfill({ json: route.request().method() === 'POST' ? { success: true, apiKey: { id: 53, apiKey: 'fake-one-time-test-key' } } : { apiKeys: [] } }));
  await group.locator('form').getByRole('button', { name: 'Create' }).click();
  const notice = dialog.locator('section').filter({ has: page.locator('code', { hasText: 'fake-one-time-test-key' }) }).first();
  await expect(notice).toBeFocused();
  await expect(group.getByRole('button', { name: 'New API Key' })).toBeDisabled();
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Fixture clipboard failure')) } }); });
  await notice.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(notice.getByRole('alert')).toBeVisible();
  await expect(notice.getByRole('button', { name: 'Copied', exact: true })).toHaveCount(0);
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } }); });
  await notice.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(notice.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  await notice.getByRole('button', { name: "I've saved it" }).click();
  await expect(group.getByRole('button', { name: 'New API Key' })).toBeFocused();
  await expect(dialog.getByText('fake-one-time-test-key')).toHaveCount(0);
});

for (const language of ['zh-CN', 'ko']) {
  test(`settings forms remain usable in ${language} at 320px with reduced motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const dialog = await openSettingsPanel(page, 320, language, 'dark');
    await page.setViewportSize({ width: 320, height: 568 });
    await settingsFormRoutes(page);
    const tabs = dialog.getByRole('tab');
    await tabs.nth(1).click();
    await expect(dialog.locator('#email-recipient')).toHaveValue('research@example.com');
    await dialog.locator('#email-delivery').scrollIntoViewIfNeeded();
    await expect(dialog.locator('#email-delivery')).toBeVisible();
    await page.screenshot({ path: screenshotPath(`settings-email-${language}-320.png`) });
    await tabs.nth(4).click();
    const group = dialog.locator('[data-credential-group="gemini"]');
    await group.getByRole('button').first().click();
    await expect(group.locator('input').first()).toBeFocused();
    await group.locator('input[type="password"]').fill('fake-localized-test-key');
    await group.locator('form button[type="submit"]').scrollIntoViewIfNeeded();
    await expect(group.locator('form button[type="submit"]')).toBeVisible();
    expect(await group.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: screenshotPath(`settings-credentials-${language}-320.png`) });
    await tabs.first().click();
    await page.getByRole('dialog', { name: language === 'zh-CN' ? '放弃未保存的内容？' : '변경 사항을 남겨두고 나갈까요?', exact: true }).getByRole('button', { name: language === 'zh-CN' ? '放弃修改' : '변경 사항 버리기', exact: true }).click();
    await dialog.getByRole('button', { name: language === 'zh-CN' ? '记忆' : '메모리', exact: true }).click();
    const memory = dialog.locator('[data-memory-settings]');
    const row = memory.locator('[data-memory-row]');
    await row.getByRole('button').first().click();
    await row.locator('textarea').fill('Cross-language research notes — 跨语言研究笔记 — 연구 메모');
    await row.locator('button[type="submit"]').scrollIntoViewIfNeeded();
    await expect(row.locator('button[type="submit"]')).toBeVisible();
    expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: screenshotPath(`settings-memory-${language}-320.png`) });
    await expect(memory.locator('label').first()).not.toHaveText('Memory content');
  });
}

for (const width of [1440, 320]) {
  test(`queue restores text attachments and edits paused after refresh at ${width}px`, async ({ page }) => {
    let socket: WebSocketRoute; const commands: any[] = []; const uploads: string[] = [];
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    await page.routeWebSocket(/\/ws(?:\?|$)/, ws => { socket = ws; ws.onMessage(value => commands.push(JSON.parse(String(value)))); });
    await fixture(page);
    await page.route('**/api/projects/*/upload-files', route => {
      uploads.push(route.request().postDataBuffer()!.toString('utf8'));
      return route.fulfill({ json: { files: [{ name: 'restore-evidence.txt', path: '/research/representation/restore-evidence.txt' }] } });
    });
    await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Message', exact: true });
    await input.fill('First active request'); await input.press('Enter');
    await page.locator('form input[type=file]').setInputFiles({ name: 'restore-evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('Evidence bytes survive reload: 研究 123') });
    await expect(page.getByText('restore-evidence.txt', { exact: true }).first()).toBeVisible();
    await input.fill('Review stored evidence'); await input.press('Enter');
    await input.fill('Remove this queued message'); await input.press('Enter');
    const queue = page.getByRole('region', { name: 'Message queue' });
    await queue.getByRole('button', { name: 'Edit queued message 1', exact: true }).click();
    await queue.getByRole('textbox').fill('Compare the stored evidence');
    await queue.getByRole('button', { name: 'Save changes', exact: true }).click();
    await queue.getByRole('button', { name: 'Remove queued message 2', exact: true }).click();
    await expect(queue.getByText('Saving queue on this device…')).toHaveCount(0);
    await page.reload();
    await expect(queue).toContainText('Messages and attachments restored');
    await expect(queue).toContainText('Compare the stored evidence');
    await expect(queue).toContainText('Queue paused');
    await expect(queue).not.toContainText('Remove this queued message');
    await queue.getByRole('button', { name: 'Edit queued message 1', exact: true }).click();
    await expect(queue).toContainText('restore-evidence.txt');
    await queue.getByRole('button', { name: 'Cancel edit', exact: true }).click();
    const sent = () => commands.filter(command => command.type === 'claude-command');
    expect(sent()).toHaveLength(1); expect(uploads).toHaveLength(0);
    socket!.send(JSON.stringify({ type: 'claude-complete', sessionId: 'research-session', exitCode: 0 }));
    await page.waitForTimeout(150);
    expect(sent()).toHaveLength(1);
    await page.screenshot({ path: screenshotPath(`queue-restored-${width}.png`) });
    await queue.getByRole('button', { name: 'Continue queue' }).click();
    await expect.poll(() => sent().length).toBe(2);
    expect(sent()[1].command).toContain('Compare the stored evidence');
    expect(sent()[1].command).toContain('/research/representation/restore-evidence.txt');
    expect(sent()[1].options.sessionId).toBe('research-session');
    expect(sent()[1].options.model).toBe(sent()[0].options.model);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toContain('Evidence bytes survive reload: 研究 123');
    await expect(queue).toHaveCount(0);
    await page.waitForTimeout(100);
    await page.reload();
    await expect(input).toBeVisible();
    await expect(queue).toHaveCount(0);
    expect(sent()).toHaveLength(2);
  });
}

test('saved queue belongs to the signed-in account and survives cancellation across reloads', async ({ page }) => {
  const commands: any[] = [];
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => ws.onMessage(value => commands.push(JSON.parse(String(value)))));
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Active turn'); await input.press('Enter');
  await input.fill('Account one queue'); await input.press('Enter');
  const queue = page.getByRole('region', { name: 'Message queue' });
  await expect(queue).toContainText('Account one queue');
  await expect(queue.getByText('Saving queue on this device…')).toHaveCount(0);
  await page.route('**/api/auth/user', route => route.fulfill({ json: { user: { id: 2, username: 'another-user' } } }));
  await page.reload();
  await expect(input).toBeVisible();
  await expect(queue).toHaveCount(0);
  await page.route('**/api/auth/user', route => route.fulfill({ json: { user: { id: 1, username: 'researcher' } } }));
  await page.reload();
  await expect(queue).toContainText('Account one queue');
  await queue.getByRole('button', { name: 'Remove queued message 1', exact: true }).click();
  await expect(queue).toHaveCount(0);
  await page.waitForTimeout(100);
  await page.reload();
  await expect(input).toBeVisible(); await expect(queue).toHaveCount(0);
  expect(commands.filter(command => command.type === 'claude-command')).toHaveLength(1);
});

test('queue storage failure is visible and retry persists the retained draft', async ({ page }) => {
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => ws.onMessage(() => {}));
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Active turn'); await input.press('Enter');
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    (window as any).__restoreQueueStorage = () => { IDBDatabase.prototype.transaction = original; };
    IDBDatabase.prototype.transaction = function (...args: any[]) {
      if (this.name === 'dr-claw-message-queues' && args[1] === 'readwrite') throw new DOMException('Fixture quota exceeded', 'QuotaExceededError');
      return original.apply(this, args as any);
    };
  });
  await input.fill('Keep me when storage fails'); await input.press('Enter');
  const queue = page.getByRole('region', { name: 'Message queue' });
  await expect(queue.getByRole('alert')).toContainText('could not be saved');
  await expect(queue).toContainText('Keep me when storage fails');
  await page.evaluate(() => (window as any).__restoreQueueStorage());
  await queue.getByRole('button', { name: 'Retry storage' }).click();
  await expect(queue.getByRole('alert')).toHaveCount(0);
  await expect(queue.getByText('Saving queue on this device…')).toHaveCount(0);
  await page.reload();
  await expect(queue).toContainText('Keep me when storage fails');
  await expect(queue).toContainText('Queue paused');
});

test('restored uncertain send requires review before it can be sent again', async ({ page }) => {
  const commands: any[] = [];
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => ws.onMessage(value => commands.push(JSON.parse(String(value)))));
  await fixture(page);
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Active turn'); await input.press('Enter');
  await input.fill('Check before resending'); await input.press('Enter');
  const queue = page.getByRole('region', { name: 'Message queue' });
  await expect(queue.getByText('Saving queue on this device…')).toHaveCount(0);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('dr-claw-message-queues', 1);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('queues', 'readwrite'); const store = tx.objectStore('queues');
      const cursor = store.openCursor(); cursor.onsuccess = () => { if (cursor.result) { const record = cursor.result.value; record.items[0].uncertain = true; cursor.result.update(record); } };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await queue.getByRole('button', { name: 'Continue queue' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Check the previous send' });
  await expect(confirmation).toBeVisible();
  expect(commands.filter(command => command.type === 'claude-command')).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(queue).toContainText('Queue paused');
  await queue.getByRole('button', { name: 'Continue queue' }).click();
  await confirmation.getByRole('button', { name: 'Send again and continue' }).click();
  // Dispatch awaits the IndexedDB write before sending. Observe that transition
  // before asserting the independently delivered WebSocket fixture callback.
  await expect(queue).toHaveCount(0);
  await expect.poll(() => commands.filter(command => command.type === 'claude-command').length).toBe(2);
});

test('queue read failure can retry without overwriting saved messages', async ({ page }) => {
  await page.routeWebSocket(/\/ws(?:\?|$)/, ws => ws.onMessage(() => {}));
  await fixture(page);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    (window as any).__restoreQueueStorage = () => { IDBDatabase.prototype.transaction = original; };
    IDBDatabase.prototype.transaction = function (...args: any[]) {
      if (this.name === 'dr-claw-message-queues' && args[1] === 'readonly') throw new Error('Fixture read failure');
      return original.apply(this, args as any);
    };
  });
  await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Message queue' });
  await expect(queue.getByRole('alert')).toContainText('saved queue could not be read');
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('Keep this input while retrying'); await input.press('Enter');
  await expect(input).toHaveValue('Keep this input while retrying');
  await page.evaluate(() => (window as any).__restoreQueueStorage());
  await queue.getByRole('button', { name: 'Retry storage' }).click();
  await expect(queue).toHaveCount(0);
  await expect(input).toHaveValue('Keep this input while retrying');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});

const localModelFixture = { name: 'research-baseline:8b', displayName: 'Research baseline evaluation model', size: '4.9 GB', sizeB: 8, family: 'llama', quantization: 'Q4_K_M' };
async function openLocalSettings(page: Page, width: number, setup?: () => Promise<void>, language = 'en') {
  const dialog = await openSettingsPanel(page, width, language, language === 'en' ? 'light' : 'dark');
  await page.route('**/api/cli/local/gpu-info', route => route.fulfill({ json: { gpus: [{ id: 'gpu-0', name: 'Research workstation GPU', memory: '24 GB', utilization: 12 }, { id: 'gpu-1', name: 'Evaluation GPU', memory: '16 GB' }] } }));
  await page.route('**/api/cli/local/models?*', route => route.fulfill({ json: { models: [localModelFixture], hasGpu: true } }));
  if (setup) await setup();
  await dialog.getByRole('button', { name: /^Local GPU/ }).click();
  const local = dialog.locator('[data-local-settings]');
  await expect(local.locator('#local-server-url')).toBeVisible();
  return { dialog, local };
}
for (const width of [1440, 320]) {
  test(`local account loads deliberately and ignores obsolete model replies at ${width}px`, async ({ page }) => {
    let reads = 0, gpuReads = 0;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const { local } = await openLocalSettings(page, width, async () => {
      await page.route('**/api/cli/local/gpu-info', route => { gpuReads++; return route.fulfill({ json: { gpus: [{ id: 'gpu-0', name: 'Research workstation GPU' }, { id: 'gpu-1', name: 'Evaluation GPU' }] } }); });
      await page.route('**/api/cli/local/models?*', async route => {
        reads++;
        const obsolete = new URL(route.request().url()).searchParams.get('serverUrl') === 'http://next-server:11434';
        if (obsolete) await held;
        await route.fulfill({ json: { models: [{ ...localModelFixture, name: obsolete ? 'obsolete-model' : localModelFixture.name, displayName: obsolete ? 'Obsolete model' : localModelFixture.displayName }], hasGpu: false } }).catch(() => {});
      });
    });
    await expect(local.getByRole('radio', { name: /Research baseline/ })).toBeVisible();
    const initialReads = reads, initialGpuReads = gpuReads;
    await local.getByRole('radio', { name: 'Evaluation GPU', exact: true }).check();
    const url = local.locator('#local-server-url');
    await url.fill('http://next-server:11434');
    await page.waitForTimeout(150);
    expect(reads).toBe(initialReads); expect(gpuReads).toBe(initialGpuReads);
    await expect(local.getByRole('radio', { name: /Research baseline/ })).toBeDisabled();
    await local.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => reads).toBe(initialReads + 1);
    await url.fill('http://latest-server:11434');
    release();
    await expect(local.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    await local.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(local.getByText('Results from http://latest-server:11434', { exact: true })).toBeVisible();
    await expect(local.getByRole('radio', { name: /Research baseline/ })).toBeEnabled();
    await expect(local.getByRole('radio', { name: /Obsolete model/ })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('local-gpu-server-url'))).toBeNull();
    await page.screenshot({ path: screenshotPath(`account-local-${width}.png`) });
  });

  test(`local account preserves failed edits and serializes server writes at ${width}px`, async ({ page }) => {
    let saves = 0, pulls = 0;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const { local } = await openLocalSettings(page, width, async () => {
      await page.route('**/api/cli/local/save-config', async route => {
        saves++; expect(route.request().postDataJSON()).toEqual({ serverUrl: 'http://research-server:11434' });
        await held; await route.fulfill({ status: 503, json: { error: 'Server unavailable fixture' } });
      });
      await page.route('**/api/cli/local/pull-model', async route => {
        pulls++; expect(route.request().postDataJSON()).toEqual({ serverUrl: 'http://research-server:11434', modelName: 'research:8b' });
        await route.fulfill({ status: 503, json: { error: 'Download failed fixture' } });
      });
    });
    const url = local.locator('#local-server-url'); await url.fill('http://research-server:11434');
    await url.press('Enter'); await url.press('Enter');
    await expect.poll(() => saves).toBe(1);
    await expect(url).toBeDisabled();
    await expect(local.getByRole('button', { name: 'Download', exact: true })).toBeDisabled();
    release(); await expect(local.getByRole('alert')).toBeVisible();
    await expect(url).toHaveValue('http://research-server:11434');
    expect(await page.evaluate(() => localStorage.getItem('local-gpu-server-url'))).toBeNull();
    await local.locator('#local-model-name').fill('research:8b');
    await local.locator('#local-model-name').press('Enter');
    await expect(local.getByRole('alert')).toBeVisible();
    await expect(local.locator('#local-model-name')).toHaveValue('research:8b');
    expect(pulls).toBe(1);
    await page.screenshot({ path: screenshotPath(`account-local-failure-${width}.png`) });
    await page.route('**/api/cli/local/save-config', route => route.fulfill({ json: { success: true } }));
    await local.getByRole('button', { name: 'Save & refresh', exact: true }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('local-gpu-server-url'))).toBe('http://research-server:11434');
    await expect(local.getByText('Results from http://research-server:11434', { exact: true })).toBeVisible();
  });
}

test('local account keeps the last model list visible when refresh fails', async ({ page }) => {
  const { local } = await openLocalSettings(page, 390);
  await expect(local.getByRole('radio', { name: /Research baseline/ })).toBeVisible();
  await page.route('**/api/cli/local/models?*', route => route.fulfill({ status: 503, json: { error: 'Offline fixture', models: [] } }));
  await local.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(local.getByRole('alert')).toBeVisible();
  await expect(local.getByRole('radio', { name: /Research baseline/ })).toBeVisible();
  await expect(local.getByText('No models found.', { exact: false })).toHaveCount(0);
  await page.route('**/api/cli/local/models?*', route => route.fulfill({ json: { models: [], hasGpu: false } }));
  await local.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(local.getByText('No models found. Download a model below to get started.', { exact: true })).toBeVisible();
});

for (const language of ['zh-CN', 'ko']) {
  test(`local account controls fit a short phone in ${language}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { local } = await openLocalSettings(page, 320, undefined, language);
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(local.getByRole('radio', { name: /Research baseline/ })).toBeVisible();
    for (const id of ['local-server-url', 'local-model-name']) {
      const input = local.locator(`#${id}`); await input.scrollIntoViewIfNeeded(); await expect(input).toBeVisible();
      expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await local.getByRole('button', { name: 'qwen3:8b', exact: true }).click();
    await expect(local.locator('#local-model-name')).toHaveValue('qwen3:8b');
    await expect(local.locator('#local-model-name')).toBeFocused();
    expect(await local.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: screenshotPath(`account-local-${language}-320.png`) });
  });
}

for (const width of [1440, 320]) {
  test(`unsaved settings guard protects Done Escape and page changes at ${width}px`, async ({ page }) => {
    const dialog = await openSettingsPanel(page, width); await settingsFormRoutes(page);
    let writes = 0;
    await page.route('**/api/user/git-config', route => {
      if (route.request().method() !== 'GET') writes++;
      return route.fulfill({ json: { gitName: 'Researcher', gitEmail: 'review@example.com' } });
    });
    await dialog.getByRole('tab', { name: 'Git', exact: true }).click();
    const input = dialog.locator('#settings-git-name'); await expect(input).toHaveValue('Researcher'); await input.fill('Unsaved researcher');
    const done = dialog.locator('[data-settings-footer]').getByRole('button', { name: 'Done', exact: true });
    await done.click(); const guard = page.getByRole('dialog', { name: 'Leave these changes?', exact: true });
    await expect(guard).toBeVisible(); expect(await guard.evaluate(el => el.matches(':modal'))).toBe(true);
    await guard.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(done).toBeFocused(); await expect(input).toHaveValue('Unsaved researcher');
    await page.keyboard.press('Escape'); await expect(guard).toBeVisible(); await page.keyboard.press('Escape'); await expect(guard).not.toBeVisible(); await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await expect(guard).toBeVisible(); await guard.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Email', exact: true }).click(); await expect(guard).toBeVisible();
    await page.screenshot({ path: screenshotPath(`settings-unsaved-${width}.png`) });
    await guard.getByRole('button', { name: 'Discard changes', exact: true }).click(); await expect(dialog.locator('[data-email-settings]')).toBeVisible(); expect(writes).toBe(0);
    await dialog.getByRole('tab', { name: 'Git', exact: true }).click(); await expect(input).toHaveValue('Researcher');
    await input.fill('Saved researcher'); await dialog.getByRole('button', { name: 'Save Configuration', exact: true }).click();
    await expect.poll(() => writes).toBe(1); await expect(dialog.getByRole('status')).toHaveText('Saved.');
    await done.click(); await expect(dialog).not.toBeVisible(); await expect(guard).not.toBeVisible();
  });
}

test('unsaved settings guard retains email secrets and protects in-flight writes', async ({ page }) => {
  const dialog = await openSettingsPanel(page, 390); await settingsFormRoutes(page);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/settings/auto-research-resend-key', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { maskedKey: 're_••••review' } });
    await held; await route.fulfill({ status: 503, json: { error: 'Key save failure fixture' } });
  });
  await dialog.getByRole('tab', { name: 'Email', exact: true }).click();
  const delivery = dialog.locator('[data-email-field="delivery"]'); await delivery.locator('input').fill('test-only-draft-key');
  await delivery.getByRole('button', { name: /Save/ }).click();
  await dialog.locator('[data-settings-footer]').getByRole('button', { name: 'Done', exact: true }).click();
  const busy = page.getByRole('dialog', { name: 'A request is still in progress', exact: true }); await expect(busy).toBeVisible(); await expect(busy.getByRole('button', { name: 'Discard changes', exact: true })).toHaveCount(0);
  await busy.getByRole('button', { name: 'Keep editing', exact: true }).click(); release(); await expect(delivery.getByRole('alert')).toBeVisible();
  await dialog.getByRole('tab', { name: 'Git', exact: true }).click(); const guard = page.getByRole('dialog', { name: 'Leave these changes?', exact: true }); await guard.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(delivery.locator('input')).toHaveValue('test-only-draft-key');
});

test('unsaved settings guard discards permission and appearance drafts before navigation', async ({ page }) => {
  const dialog = await openSettingsPanel(page, 1440); await settingsFormRoutes(page);
  await dialog.getByRole('button', { name: 'Permissions', exact: true }).click();
  const permission = dialog.getByRole('checkbox').first(); await permission.check();
  await dialog.getByRole('button', { name: /^Codex/ }).click(); const guard = page.getByRole('dialog', { name: 'Leave these changes?', exact: true }); await expect(guard).toBeVisible(); await guard.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await dialog.getByRole('button', { name: /^Claude/ }).click(); await expect(permission).not.toBeChecked();
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click();
  const sorting = dialog.locator('select').filter({ has: page.locator('option[value="date"]') }); await sorting.selectOption('date');
  await dialog.getByRole('tab', { name: 'Git', exact: true }).click(); await guard.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click(); await expect(sorting).toHaveValue('name');
  const root = dialog.locator('#settings-workspace-root'); await root.fill('/research/unsaved-workspace');
  let writes = 0; await page.route('**/api/projects/workspace-root', route => { if (route.request().method() === 'PUT') writes++; return route.fulfill({ json: { path: '' } }); });
  await dialog.getByRole('tab', { name: 'Git', exact: true }).click(); await guard.getByRole('button', { name: 'Discard changes', exact: true }).click(); expect(writes).toBe(0);
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click(); await expect(root).toHaveValue('');
});

test('unsaved settings guard protects memory edits and new credentials', async ({ page }) => {
  const dialog = await openSettingsPanel(page, 390); await settingsFormRoutes(page);
  await dialog.getByRole('button', { name: 'Memory', exact: true }).click(); await dialog.locator('#new-memory-content').fill('Keep this pending memory');
  await dialog.getByRole('button', { name: 'Account', exact: true }).click(); const guard = page.getByRole('dialog', { name: 'Leave these changes?', exact: true }); await guard.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(dialog.locator('#new-memory-content')).toHaveValue('Keep this pending memory');
  await dialog.getByRole('tab', { name: 'API & Tokens', exact: true }).click(); await guard.getByRole('button', { name: 'Discard changes', exact: true }).click();
  const group = dialog.locator('[data-credential-group="github"]'); await group.getByRole('button', { name: 'Add Token', exact: true }).click(); await group.locator('#github-credential-secret').fill('test-only-token');
  await dialog.locator('[data-settings-footer]').getByRole('button', { name: 'Done', exact: true }).click(); await guard.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(group.locator('#github-credential-secret')).toHaveValue('test-only-token');
});

for (const language of ['zh-CN', 'ko']) {
  test(`unsaved settings guard localizes and fits 320px in ${language}`, async ({ page }) => {
    const dialog = await openSettingsPanel(page, 320, language, 'dark'); await settingsFormRoutes(page); await page.setViewportSize({ width: 320, height: 568 });
    await dialog.getByRole('tab', { name: 'Git', exact: true }).click(); await dialog.locator('#settings-git-name').fill('Pending draft');
    await dialog.locator('[data-settings-footer]').getByRole('button').click();
    const guard = page.getByRole('dialog', { name: language === 'zh-CN' ? '放弃未保存的内容？' : '변경 사항을 남겨두고 나갈까요?', exact: true }); await expect(guard).toBeVisible();
    expect(await guard.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); await page.screenshot({ path: screenshotPath(`settings-unsaved-${language}-320.png`) });
    await guard.getByRole('button', { name: language === 'zh-CN' ? '继续编辑' : '계속 편집', exact: true }).click(); await expect(dialog.locator('#settings-git-name')).toHaveValue('Pending draft');
  });
}

test('unsaved settings guard warns before losing a newly created API key', async ({ page }) => {
  const dialog = await openSettingsPanel(page, 390); await settingsFormRoutes(page);
  await dialog.getByRole('tab', { name: 'API & Tokens', exact: true }).click(); const group = dialog.locator('[data-credential-group="api"]');
  await group.getByRole('button', { name: 'New API Key', exact: true }).click(); await group.getByLabel('Name', { exact: true }).fill('Review key');
  await page.route('**/api/settings/api-keys', route => route.fulfill({ json: route.request().method() === 'POST' ? { success: true, apiKey: { id: 91, apiKey: 'fake-review-key' } } : { apiKeys: [] } }));
  await group.getByRole('button', { name: 'Create', exact: true }).click(); await expect(dialog.getByText('fake-review-key', { exact: true })).toBeVisible();
  await dialog.locator('[data-settings-footer]').getByRole('button', { name: 'Done', exact: true }).click(); const guard = page.getByRole('dialog', { name: 'Leave these changes?', exact: true });
  await expect(guard.getByText(/already created/)).toBeVisible(); await expect(guard.getByRole('button', { name: 'Leave page', exact: true })).toBeVisible();
  await guard.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(dialog.getByText('fake-review-key', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: "I've saved it", exact: true }).click(); await dialog.locator('[data-settings-footer]').getByRole('button', { name: 'Done', exact: true }).click(); await expect(dialog).not.toBeVisible();
});

test('unsaved settings guard protects provider keys and MCP form edits', async ({ page }) => {
  const dialog = await openSettingsPanel(page, 1440);
  await dialog.getByRole('button', { name: /^Codex/ }).click(); const secret = dialog.locator('input[type="password"]'); await secret.fill('test-only-provider-key');
  await dialog.getByRole('button', { name: /^Claude/ }).click(); const guard = page.getByRole('dialog', { name: 'Leave these changes?', exact: true }); await guard.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await dialog.getByRole('button', { name: /^Codex/ }).click(); await expect(secret).toHaveValue(''); await dialog.getByRole('button', { name: /^Claude/ }).click();
  await dialog.getByRole('button', { name: 'MCP Servers', exact: true }).click(); await dialog.getByRole('button', { name: 'Add MCP Server', exact: true }).click();
  const name = page.getByPlaceholder('my-server', { exact: true }); await name.fill('pending-server');
  await page.keyboard.press('Escape'); await guard.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(name).toHaveValue('pending-server');
  await page.keyboard.press('Escape'); await guard.getByRole('button', { name: 'Discard changes', exact: true }).click(); await expect(name).toHaveCount(0); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^Codex/ }).click(); await dialog.getByRole('button', { name: /Add.*Server/ }).click(); await name.fill('pending-codex-server');
  await page.keyboard.press('Escape'); await guard.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(name).toHaveValue('pending-codex-server');
});

test('unsaved settings guard protects local address drafts and browser unload', async ({ page }) => {
  const { dialog, local } = await openLocalSettings(page, 390); const input = local.locator('#local-server-url'); await input.fill('http://pending-server:11434');
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false);
  await dialog.getByRole('button', { name: /^Claude/ }).click(); const guard = page.getByRole('dialog', { name: 'Leave these changes?', exact: true }); await guard.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(input).toHaveValue('http://pending-server:11434');
  await dialog.getByRole('button', { name: /^Claude/ }).click(); await guard.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(input).toHaveCount(0);
  expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
});


test('unsaved settings guard finishes a requested close after saving succeeds', async ({ page }) => {
  const dialog = await openSettingsPanel(page, 390); await settingsFormRoutes(page);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/user/git-config', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { gitName: 'Researcher', gitEmail: 'review@example.com' } });
    await held; await route.fulfill({ json: { success: true } });
  });
  await dialog.getByRole('tab', { name: 'Git', exact: true }).click(); await dialog.locator('#settings-git-name').fill('Saved researcher');
  await dialog.getByRole('button', { name: 'Save Configuration', exact: true }).click(); await dialog.locator('[data-settings-footer]').getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'A request is still in progress', exact: true })).toBeVisible(); release();
  await expect(dialog).not.toBeVisible(); await expect(page.getByRole('dialog', { name: 'Leave these changes?', exact: true })).toHaveCount(0);
});

const mcpEditFixture = { id: 'research-evidence', name: 'research-evidence', type: 'stdio', scope: 'user', config: { command: '/research/bin/evidence-server', args: ['--baseline'], env: { TEST_KEY: 'fixture-private-value' } }, raw: { command: '/research/bin/evidence-server', args: ['--baseline'], env: { TEST_KEY: 'fixture-private-value' }, startup_timeout_sec: 30 } };
for (const provider of ['claude','codex']) {
  for (const width of [1440,320]) {
    test(`MCP ${provider} edit keeps failed drafts and never deletes first at ${width}px`, async ({ page }) => {
      const dialog = await openSettingsPanel(page, width);
      await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
      const base = provider === 'claude' ? '/api/mcp' : '/api/codex/mcp';
      let servers = [mcpEditFixture], writes = 0, deletes = 0;
      let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
      await page.route(`**${base}/config/read`, route => route.fulfill({ json: { success: true, servers } }));
      await page.route(`**${base}/config/server`, async route => {
        writes++; expect(route.request().method()).toBe('PUT'); const data = route.request().postDataJSON();
        expect(data.expected).toEqual(mcpEditFixture.raw); expect(data.originalName).toBe('research-evidence');
        expect(data.config.args).toEqual(['--baseline', '--new-argument']); expect(data.config.env).toEqual({ TEST_KEY: 'fixture-private-value', NEW_KEY: 'value=with-equals' });
        if (writes === 1) { await held; await route.fulfill({ status: 503, json: { error: 'Fixture save failure' } }); }
        else { servers = [{ ...mcpEditFixture, name: data.name, id: data.name }]; await route.fulfill({ json: { success: true } }); }
      });
      await page.route(`**${base}/cli/remove/**`, route => { deletes++; return route.fulfill({ json: { success: true } }); });
      if (provider === 'codex') await dialog.getByRole('button', { name: /^Codex/ }).click();
      await dialog.getByRole('button', { name: 'MCP Servers', exact: true }).click();
      const list = dialog.locator('[data-mcp-settings]'); await list.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(list.getByText('research-evidence', { exact: true })).toBeVisible(); await expect(list.getByText('fixture-private-value', { exact: false })).toHaveCount(0);
      await list.getByRole('button', { name: 'Edit server', exact: true }).click();
      const form = page.locator('[data-mcp-form]'); const modal = page.getByRole('dialog').filter({ has: form });
      expect(await modal.evaluate(el => el.matches(':modal'))).toBe(true);
      const name = form.getByLabel('Server Name', { exact: true }); await name.fill('renamed-evidence');
      const args = form.getByLabel('Arguments (one per line)', { exact: true }); await args.fill('--baseline'); await args.press('Enter'); await args.pressSequentially('--new-argument'); await expect(args).toHaveValue('--baseline\n--new-argument');
      const env = form.getByLabel('Environment Variables (KEY=value, one per line)', { exact: true }); await env.fill('TEST_KEY=fixture-private-value'); await env.press('Enter'); await env.pressSequentially('NEW_KEY=value=with-equals');
      const submit = form.locator('button[type=submit]'); await submit.click(); await form.evaluate(el => el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await expect(name).toBeDisabled(); await expect(submit).toBeDisabled(); expect(writes).toBe(1); expect(deletes).toBe(0);
      release(); await expect(form.getByRole('alert')).toBeVisible(); await expect(name).toHaveValue('renamed-evidence');
      await page.keyboard.press('Escape'); const guard = page.getByRole('dialog', { name: 'Leave these changes?', exact: true }); await guard.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(name).toHaveValue('renamed-evidence');
      expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: screenshotPath(`mcp-${provider}-failure-${width}.png`) });
      await submit.click(); await expect(form).toHaveCount(0); await expect(list.getByText('renamed-evidence', { exact: true })).toBeVisible(); expect(writes).toBe(2); expect(deletes).toBe(0);
    });
  }
}

test('MCP list failure retains rows and failed deletion keeps its confirmation', async ({ page }) => {
  const dialog = await openSettingsPanel(page, 390);
  await page.route('**/api/mcp/config/read', route => route.fulfill({ json: { success: true, servers: [mcpEditFixture] } }));
  await dialog.getByRole('button', { name: 'MCP Servers', exact: true }).click(); const list = dialog.locator('[data-mcp-settings]');
  await list.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(list.getByText('research-evidence', { exact: true })).toBeVisible();
  await page.route('**/api/mcp/config/read', route => route.fulfill({ status: 500, json: { error: 'Fixture malformed configuration' } }));
  await list.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(list.getByRole('alert')).toBeVisible(); await expect(list.getByText('research-evidence', { exact: true })).toBeVisible(); await expect(list.getByText('No MCP servers configured', { exact: true })).toHaveCount(0);
  await page.route('**/api/mcp/cli/remove/**', route => route.fulfill({ status: 503, json: { error: 'Fixture removal failure' } }));
  await list.getByRole('button', { name: 'Delete server', exact: true }).click(); const confirm = page.getByRole('dialog', { name: 'Delete server', exact: true });
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click(); await expect(confirm.getByRole('alert')).toBeVisible(); await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(list.getByRole('button', { name: 'Delete server', exact: true })).toBeFocused();
  await page.route('**/api/mcp/config/read', route => route.fulfill({ json: { success: true, servers: [] } }));
  await list.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(list.getByText('No MCP servers configured', { exact: true })).toBeVisible();
});

for (const language of ['zh-CN','ko']) {
  test(`MCP form and list fit 320px in ${language} with reduced motion`, async ({ page }) => {
    const dialog = await openSettingsPanel(page, 320, language, 'dark'); await page.setViewportSize({ width: 320, height: 568 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/mcp/config/read', route => route.fulfill({ json: { success: true, servers: [{ ...mcpEditFixture, name: 'Research evidence extraction with reproducible evaluation and long names', config: { ...mcpEditFixture.config, command: '/research/workspace/with-a-very-long-path/evidence-server' } }] } }));
    await dialog.getByRole('button', { name: language === 'zh-CN' ? 'MCP 服务器' : 'MCP 서버', exact: true }).click();
    const list = dialog.locator('[data-mcp-settings]'); await list.getByRole('button', { name: language === 'zh-CN' ? '刷新' : '새로고침', exact: true }).click(); await expect(list.locator('[data-mcp-server]')).toHaveCount(1);
    expect(await list.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); await page.screenshot({ path: screenshotPath(`mcp-list-${language}-320.png`) });
    await list.locator('[data-mcp-server]').getByRole('button').first().click(); const form = page.locator('[data-mcp-form]'); await expect(form.locator('input').first()).toBeFocused();
    await form.locator('textarea').last().fill('TEST_KEY=保留输入'); const submit = form.locator('button[type=submit]'); await submit.scrollIntoViewIfNeeded(); await expect(submit).toBeVisible();
    expect(await form.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: screenshotPath(`mcp-form-${language}-320.png`) });
  });
}

for (const width of [1440, 320]) {
  test(`settings save stays open and clears stale success after edits at ${width}px`, async ({ page }) => {
    const dialog = await openSettingsPanel(page, width);
    await dialog.getByRole('button', { name: 'Permissions', exact: true }).click();
    const permission = dialog.getByRole('checkbox').first(); await permission.check();
    const footer = dialog.locator('[data-settings-footer]');
    await footer.getByRole('button', { name: 'Save Settings', exact: true }).click();
    await expect(footer.getByRole('status')).toHaveText('Saved'); await page.waitForTimeout(1200); await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('claude-settings')!).skipPermissions)).toBe(true);
    await permission.uncheck(); await expect(footer.getByRole('status')).toHaveCount(0);
    await footer.getByRole('button', { name: 'Save Settings', exact: true }).click();
    await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Leave these changes?', exact: true })).toHaveCount(0);
    const sort = dialog.getByLabel('Project Sorting', { exact: true }); await sort.selectOption('date');
    await footer.getByRole('button', { name: 'Save Settings', exact: true }).click(); await expect(footer.getByRole('status')).toHaveText('Saved');
    await page.waitForTimeout(1200); await expect(sort).toHaveValue('date'); await expect(dialog).toBeVisible();
    await dialog.getByRole('switch', { name: 'Toggle dark mode', exact: true }).click(); await expect(footer.getByRole('status')).toHaveCount(0);
    await sort.selectOption('name'); await footer.getByRole('button', { name: 'Save Settings', exact: true }).click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('claude-settings')!).projectSortOrder)).toBe('name');
    await page.screenshot({ path: screenshotPath(`appearance-saved-${width}.png`) });
    await dialog.getByRole('tab', { name: 'Git', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Leave these changes?', exact: true })).toHaveCount(0);
  });
}

test('settings workspace path retries initial failure and retains edits across failed saves', async ({ page }) => {
  const dialog = await openSettingsPanel(page, 320); let reads = 0, writes = 0, failReads = true;
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/projects/workspace-root', async route => {
    if (route.request().method() === 'GET') { reads++; return route.fulfill(failReads ? { status: 503, json: { error: 'Fixture read unavailable' } } : { json: { path: '/research/saved', defaultPath: '/research/default' } }); }
    writes++; const body = route.request().postDataJSON();
    if (writes === 1) { await held; return route.fulfill({ status: 503, json: { error: 'Fixture write unavailable' } }); }
    return route.fulfill({ json: { path: body.path || '/research/default', defaultPath: '/research/default' } });
  });
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click(); const form = dialog.locator('[data-workspace-root-settings]'), input = form.locator('input');
  await expect(input).toBeDisabled(); await expect(form.getByRole('alert')).toContainText('Could not load');
  failReads = false; await form.getByRole('button', { name: 'Retry', exact: true }).click(); await expect(input).toHaveValue('/research/saved');
  await input.fill('/research/changed'); await input.press('Enter'); await form.locator('form').evaluate(el => el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await expect(input).toBeDisabled(); expect(writes).toBe(1); release(); await expect(form.getByRole('alert')).toBeVisible(); await expect(input).toHaveValue('/research/changed');
  await page.screenshot({ path: screenshotPath('appearance-path-failure-320.png') });
  await input.press('Enter'); await expect(form.getByRole('status')).toHaveText('Saved.'); await input.fill('/research/next'); await expect(form.getByRole('status')).toHaveCount(0);
  await form.getByRole('button', { name: 'Reset', exact: true }).click(); await expect(input).toHaveValue('/research/default');
  await dialog.getByRole('tab', { name: 'Git', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Leave these changes?', exact: true })).toHaveCount(0);
});

for (const agent of ['claude', 'codex', 'gemini', 'openrouter']) {
  test(`settings provider ${agent} preserves failed secrets and verifies before clearing`, async ({ page }) => {
    const dialog = await openSettingsPanel(page, 320); let writes = 0, reads = 0;
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/cli/${agent}/status`, route => { reads++; return route.fulfill({ json: { authenticated: writes > 1, cliAvailable: true, email: 'review@example.com', hasApiKey: writes > 1 } }); });
    await page.route(`**/api/cli/${agent}/verify-*`, async route => {
      writes++; expect(route.request().postDataJSON()).toEqual(agent === 'claude' ? { baseUrl: 'https://fixture.example', token: 'test-only-key' } : { apiKey: 'test-only-key' });
      if (writes === 1) { await held; return route.fulfill({ json: { success: false, error: 'Fixture rejected key' } }); }
      return route.fulfill({ json: { success: true } });
    });
    await dialog.getByRole('button', { name: new RegExp('^' + (agent === 'openrouter' ? 'OpenRouter' : agent[0].toUpperCase() + agent.slice(1))) }).click();
    const form = dialog.locator('[data-provider-api]'); if (agent === 'claude') await form.getByLabel('API base URL', { exact: true }).fill('https://fixture.example');
    const input = form.locator('input[type=password]'); await input.fill('test-only-key'); await input.press('Enter'); await form.evaluate(el => el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await expect(input).toBeDisabled(); expect(writes).toBe(1); release(); await expect(form.getByRole('alert')).toBeVisible(); await expect(input).toHaveValue('test-only-key');
    await page.screenshot({ path: screenshotPath(`account-${agent}-failure-320.png`) });
    const readsBeforeSave = reads; await input.press('Enter'); await expect(input).toHaveValue(''); await expect(form.getByRole('status')).toHaveText('Saved.'); await expect.poll(() => reads).toBeGreaterThan(readsBeforeSave);
    await expect(dialog.locator('[data-provider-account]')).toContainText('review@example.com');
    await dialog.locator('[data-settings-footer]').getByRole('button', { name: 'Done', exact: true }).click(); await expect(dialog).not.toBeVisible();
  });
}

for (const language of ['zh-CN', 'ko']) {
  test(`settings appearance and provider account fit 320px in ${language}`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const dialog = await openSettingsPanel(page, 320, language, 'dark'); await page.setViewportSize({ width: 320, height: 568 });
    const account = dialog.locator('[data-provider-account]');
    const submit = account.locator('button[type=submit]'); await submit.scrollIntoViewIfNeeded();
    expect(await account.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await account.innerText()).not.toContain('providerAccount.'); await page.screenshot({ path: screenshotPath(`account-${language}-320.png`) });
    await dialog.getByRole('tab', { name: language === 'zh-CN' ? '外观' : '외관', exact: true }).click();
    const appearance = dialog.locator('[data-appearance-settings]');
    expect(await appearance.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); expect(await appearance.innerText()).not.toContain('appearanceSettings.');
    for (const control of await appearance.locator('button[role=switch],select').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await dialog.locator('#settings-workspace-root').scrollIntoViewIfNeeded(); await page.screenshot({ path: screenshotPath(`appearance-${language}-320.png`) });
    expect(errors).toEqual([]);
  });
}

async function openResearchHub(page: Page, width = 1440, language = 'en', theme = 'light') {
  await page.setViewportSize({ width, height: 900 }); await fixture(page, { language, theme });
  if (width < 769) await page.getByRole('button', { name: language === 'zh-CN' ? '打开菜单' : language === 'ko' ? '메뉴 열기' : 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: language === 'zh-CN' ? '自动研究' : language === 'ko' ? '자동 연구' : 'Auto Research', exact: true }).click();
  return page.locator('[data-research-pack="ARIS"]');
}

for (const width of [1440, 320]) {
  test(`research hub isolates pack drafts and configuration feedback at ${width}px`, async ({ page }) => {
    const aris = await openResearchHub(page, width); const inno = page.locator('[data-research-pack="Dr. Claw"]'); let writes = 0;
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/community-tools/configure', async route => {
      writes++; const body = route.request().postDataJSON(); expect(body.projectPath).toBe(null); expect(body.gpuConfig).toBe(null);
      if (writes === 1) { expect(body.apiKeys).toEqual({ GEMINI_API_KEY: 'aris-test-key' }); await held; return route.fulfill({ json: { success: false, steps: [{ step: 'env', status: 'ok', message: 'Fixture environment saved' }], errors: [{ step: 'mcp', error: 'Fixture registration failed' }] } }); }
      expect(body.mcpBackend).toBe('gemini'); return route.fulfill({ json: { success: true, steps: [], errors: [] } });
    });
    await inno.getByRole('button', { name: 'Configuration', exact: true }).click(); await inno.getByLabel('GEMINI_API_KEY', { exact: true }).fill('inno-test-key');
    await aris.getByRole('button', { name: 'Configuration', exact: true }).click(); await aris.getByRole('button', { name: 'Gemini', exact: true }).click();
    const key = aris.getByLabel('GEMINI_API_KEY', { exact: true }); await expect(key).toHaveValue(''); await key.fill('aris-test-key');
    await aris.getByRole('button', { name: 'Generic LLM', exact: true }).click(); await aris.getByLabel('LLM_MODEL', { exact: true }).fill('fixture-model'); await aris.getByRole('button', { name: 'Gemini', exact: true }).click(); await expect(key).toHaveValue('aris-test-key');
    await aris.getByRole('button', { name: 'Configuration', exact: true }).click(); await aris.getByRole('button', { name: 'Configuration', exact: true }).click(); await expect(key).toHaveValue('aris-test-key');
    await key.press('Enter'); await aris.locator('form').evaluate(el => el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); await inno.locator('form').evaluate(el => el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await expect(key).toBeDisabled(); await expect(inno.getByRole('button', { name: 'Auto Configure', exact: true })).toBeDisabled(); expect(writes).toBe(1);
    release(); await expect(aris.getByRole('alert')).toContainText('Some steps may have applied'); await expect(inno.getByRole('alert')).toHaveCount(0); await expect(key).toHaveValue('aris-test-key');
    await aris.getByText('Configuration details', { exact: true }).click(); await expect(aris.getByText('Fixture environment saved', { exact: true })).toBeVisible(); await expect(aris.getByText('Fixture registration failed', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(await aris.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: screenshotPath(`research-hub-failure-${width}.png`) });
    await key.press('Enter'); await expect(aris.getByRole('status')).toContainText('Configured!'); await expect(key).toHaveValue(''); await expect(inno.getByLabel('GEMINI_API_KEY', { exact: true })).toHaveValue('inno-test-key');
    await key.fill('another-key'); await expect(aris.getByRole('status')).toHaveCount(0); await aris.getByRole('button', { name: 'Generic LLM', exact: true }).click(); await expect(aris.getByLabel('LLM_MODEL', { exact: true })).toHaveValue('fixture-model');
  });
}

test('research hub reports clipboard and malformed response failures without losing input', async ({ page }) => {
  const aris = await openResearchHub(page, 320); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await aris.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Fixture denied'); } } }));
  await aris.getByRole('button', { name: 'Copy Install command', exact: true }).click(); await expect(aris.getByRole('alert')).toContainText('Could not copy');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).fixtureCopied = text; } } }));
  await aris.getByRole('button', { name: 'Copy Install command', exact: true }).click(); await expect(aris.getByRole('status')).toHaveText('Copied!'); expect(await page.evaluate(() => (window as any).fixtureCopied)).toBe('npm install -g @openai/codex');
  await page.route('**/api/community-tools/configure', route => route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Fixture proxy error</html>' }));
  const key = aris.getByLabel('OPENAI_API_KEY', { exact: true }); await key.fill('test-only-retained-key'); await key.press('Enter'); await expect(aris.getByRole('alert')).toContainText('input has been kept'); await expect(key).toHaveValue('test-only-retained-key');
  await aris.getByRole('button', { name: 'Show OPENAI_API_KEY', exact: true }).click(); await expect(key).toHaveAttribute('type', 'text'); await aris.getByRole('button', { name: 'Hide OPENAI_API_KEY', exact: true }).click(); await expect(key).toHaveAttribute('type', 'password');
  expect(errors).toEqual([]);
});

for (const language of ['zh-CN','ko']) {
  test(`research hub expanded workflows and configuration fit 320px in ${language}`, async ({ page }) => {
    const aris = await openResearchHub(page, 320, language, 'dark'); await page.setViewportSize({ width: 320, height: 568 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    const configName = language === 'zh-CN' ? '环境配置' : '환경 설정';
    await aris.getByRole('button', { name: configName, exact: true }).click(); await aris.getByRole('button', { name: 'Generic LLM', exact: true }).click();
    const model = aris.getByLabel('LLM_MODEL', { exact: true }); await model.fill('fixture-model');
    for (const control of await aris.locator('form button, form input').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const workflows = aris.locator('button[aria-expanded]').first(); await workflows.click(); await expect(workflows).toHaveAttribute('aria-expanded', 'true');
    expect(await aris.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await aris.locator('form button[type=submit]').scrollIntoViewIfNeeded(); await page.screenshot({ path: screenshotPath(`research-hub-${language}-320.png`) });
  });
}

for (const [width, language, title, login] of [
  [1440, 'en', 'Claude CLI Login', 'Login'],
  [320, 'zh-CN', 'Claude CLI 登录', '登录'],
  [320, 'ko', 'Claude CLI 로그인', '로그인'],
] as const) {
  test(`login terminal contains focus and Escape preserves settings at ${width}px ${language}`, async ({ page }) => {
    await page.routeWebSocket(/\/shell(?:\?|$)/, ws => ws.onMessage(value => {
      if (JSON.parse(String(value)).type === 'init') ws.send(JSON.stringify({ type: 'output', data: '\r\nFixture login terminal\r\n' }));
    }));
    const settings = await openSettingsPanel(page, width, language, language === 'en' ? 'light' : 'dark');
    if (width === 320) await page.setViewportSize({ width, height: 568 });
    await page.route('**/api/cli/claude/status', route => route.fulfill({ json: { authenticated: false, cliAvailable: true } }));
    // Refresh the status loaded before the route was installed.
    const refresh = settings.getByRole('button', { name: language === 'en' ? 'Refresh' : language === 'zh-CN' ? '刷新' : '새로고침', exact: true });
    await refresh.click();
    const trigger = settings.getByRole('button', { name: login, exact: true });
    await trigger.click();
    const terminal = page.getByRole('dialog', { name: title, exact: true });
    await expect(terminal).toBeVisible();
    await expect(terminal.locator('.xterm')).toBeVisible();
    for (let index = 0; index < 5; index++) {
      await page.keyboard.press('Tab');
      expect(await terminal.evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    expect(await terminal.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: screenshotPath(`login-terminal-${language}-${width}.png`) });
    await terminal.getByRole('button', { name: language === 'en' ? 'Close' : language === 'zh-CN' ? '关闭' : '닫기', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(terminal).toHaveCount(0);
    await expect(settings).toBeVisible();
    await expect(trigger).toBeFocused();
  });
}

test('CLI install dialog blocks duplicate requests and preserves failure feedback', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await fixture(page, { onboarding: true });
  await page.route('**/api/cli/claude/status', route => route.fulfill({ json: { authenticated: false, cliAvailable: false, installable: true, installerAvailable: true } }));
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Claude CLI Login', exact: true });
  let requests = 0; let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/cli/install/claude', async route => { requests++; await held; await route.fulfill({ status: 503, json: { error: 'Installer unavailable', stderr: 'Fixture installation failure' } }); });
  await dialog.getByRole('button', { name: 'Install Claude CLI', exact: true }).evaluate(button => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect.poll(() => requests).toBe(1);
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  release();
  await expect(dialog.getByRole('status')).toContainText('Installer unavailable');
  await expect(dialog.getByText('Fixture installation failure')).toBeVisible();
  await dialog.getByRole('button', { name: 'Install Claude CLI', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: screenshotPath('login-install-failure-320.png') });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Install', exact: true })).toBeFocused();
});

test('closing a completed login cancels its delayed close before reopening', async ({ page }) => {
  let socket!: WebSocketRoute;
  await page.routeWebSocket(/\/shell(?:\?|$)/, ws => { socket = ws; ws.onMessage(() => {}); });
  const settings = await openSettingsPanel(page, 1440);
  await page.route('**/api/cli/claude/status', route => route.fulfill({ json: { authenticated: false, cliAvailable: true } }));
  await settings.getByRole('button', { name: 'Refresh', exact: true }).click();
  const trigger = settings.getByRole('button', { name: 'Login', exact: true }); await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Claude CLI Login', exact: true });
  await expect(dialog.locator('.xterm')).toBeVisible();
  await expect.poll(() => Boolean(socket)).toBe(true);
  const refreshed = page.waitForRequest(request => request.url().endsWith('/api/cli/claude/status'));
  socket.send(JSON.stringify({ type: 'output', data: '\r\nProcess exited with code 0\r\n' }));
  await refreshed;
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await trigger.click();
  await page.waitForTimeout(1200); // The previous login's one-second completion timer must be cancelled.
  await expect(dialog).toBeVisible();
});

for (const agent of ['claude', 'gemini']) {
  for (const width of [1440, 320]) {
    test(`permission rules have labels, IME-safe entry and saved state for ${agent} at ${width}px`, async ({ page }) => {
      const dialog = await openSettingsPanel(page, width);
      if (agent !== 'claude') await dialog.getByRole('button', { name: agent === 'cursor' ? /^Cursor/ : /^Gemini/ }).click();
      await dialog.getByRole('button', { name: 'Permissions', exact: true }).click();
      if (width === 320) await page.setViewportSize({ width, height: 568 });
      const area = dialog.locator(`[data-permissions=${agent}]`);
      const allowed = area.getByLabel(agent === 'cursor' ? 'Command to allow' : 'Tool to allow', { exact: true });
      const blocked = area.getByLabel(agent === 'cursor' ? 'Command to block' : 'Tool to block', { exact: true });
      expect((await allowed.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await allowed.fill('   '); await expect(area.getByRole('button', { name: 'Add', exact: true }).first()).toBeDisabled();
      const rule = agent === 'cursor' ? 'Shell(git status)' : agent === 'gemini' ? 'read_file' : 'Bash(git status:*)';
      await allowed.fill(`  ${rule}  `);
      await allowed.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
      await expect(area.getByRole('button', { name: `Remove ${rule}`, exact: true })).toHaveCount(0);
      await allowed.press('Enter'); await expect(allowed).toHaveValue('');
      const remove = area.getByRole('button', { name: `Remove ${rule}`, exact: true }); await expect(remove).toBeVisible();
      await allowed.fill(rule); await expect(area.getByRole('button', { name: 'Add', exact: true }).first()).toBeDisabled(); await allowed.fill('');
      const longRule = 'restricted-command-'.repeat(14);
      await blocked.fill(longRule); await blocked.press('Enter');
      await expect(area.getByRole('button', { name: `Remove ${longRule}`, exact: true })).toBeVisible();
      expect(await area.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await dialog.locator('[data-settings-footer]').getByRole('button', { name: 'Save Settings', exact: true }).click();
      const saved = await page.evaluate(agent => JSON.parse(localStorage.getItem(agent === 'cursor' ? 'cursor-tools-settings' : `${agent}-settings`)!), agent);
      expect(saved[agent === 'cursor' ? 'allowedCommands' : 'allowedTools']).toEqual([rule]); expect(saved[agent === 'cursor' ? 'disallowedCommands' : 'disallowedTools']).toEqual([longRule]);
      await area.scrollIntoViewIfNeeded();
      await page.screenshot({ path: screenshotPath(`permissions-${agent}-${width}.png`) });
      await remove.click(); await expect(allowed).toBeFocused();
      await dialog.getByRole('tab', { name: 'Git', exact: true }).click();
      const guard = page.getByRole('dialog', { name: 'Leave these changes?', exact: true }); await expect(guard).toBeVisible();
      await page.keyboard.press('Escape'); await expect(area).toBeVisible();
    });
  }
}
for (const agent of ['codex', 'gemini']) {
  test(`permission modes support keyboard selection and explicit saving for ${agent}`, async ({ page }) => {
    const dialog = await openSettingsPanel(page, 320);
    await dialog.getByRole('button', { name: agent === 'codex' ? /^Codex/ : /^Gemini/ }).click(); await dialog.getByRole('button', { name: 'Permissions', exact: true }).click();
    const modes = dialog.locator(`[data-permissions=${agent}]`).getByRole('radio');
    await modes.nth(0).focus(); await page.keyboard.press('ArrowDown'); await expect(modes.nth(1)).toBeChecked();
    await dialog.locator('[data-settings-footer]').getByRole('button', { name: 'Save Settings', exact: true }).click();
    expect(await page.evaluate(agent => JSON.parse(localStorage.getItem(`${agent}-settings`)!).permissionMode, agent)).toBe('acceptEdits');
    await page.screenshot({ path: screenshotPath(`permissions-modes-${agent}-320.png`) });
  });
}
for (const [language, permissions, label, remove] of [['zh-CN', '权限', '允许的工具规则', '移除'], ['ko', '권한', '허용할 도구', '삭제']]) {
  test(`permission controls fit localized short screens in ${language}`, async ({ page }) => {
    const dialog = await openSettingsPanel(page, 320, language, 'dark'); await page.setViewportSize({ width: 320, height: 568 });
    await dialog.getByRole('button', { name: permissions, exact: true }).click();
    const input = dialog.getByLabel(label, { exact: true }); await input.fill('Read'); await input.press('Enter');
    const footer = await dialog.locator('[data-settings-footer]').boundingBox();
    await expect.poll(async () => { const box = (await input.boundingBox())!; return box.y + box.height; }).toBeLessThanOrEqual(footer!.y - 8);
    const button = dialog.getByRole('button', { name: language === 'ko' ? `Read ${remove}` : `${remove} Read`, exact: true }); await expect(button).toBeVisible();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: screenshotPath(`permissions-${language}-320.png`) });
  });
}

for (const [width, theme] of [[1440, 'light'], [390, 'dark']] as const) {
  test(`conversation selectors share keyboard behavior at ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, { theme });
    await page.locator('main article').getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Model and execution settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Model and execution settings' });
    const thinking = dialog.getByRole('button', { name: /^Thinking mode:/i });
    await thinking.click();
    const list = dialog.getByRole('listbox', { name: 'Thinking Mode', exact: true });
    await expect(list).toBeVisible();
    await page.keyboard.press('End');
    const last = list.getByRole('option').last();
    await expect(last).toBeFocused();
    const label = await last.locator('.font-medium').innerText();
    await page.keyboard.press('Enter');
    await expect(thinking).toContainText(label);
    await expect(thinking).toBeFocused();
    await thinking.click();
    await expect(list.getByRole('option', { selected: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(thinking).toBeFocused();
    const model = dialog.getByRole('button', { name: /^Model:/ });
    await model.click();
    await expect(dialog.getByRole('listbox', { name: 'Model', exact: true })).toBeVisible();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const control of [model, thinking]) {
      const box = await control.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: screenshotPath(`unified-selectors-${width}-${theme}.png`) });
  });
}
