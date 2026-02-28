import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import jwt from 'jsonwebtoken';

/**
 * Verify the Skills refactor:
 * - Only ONE "Import Local Skills" button exists (sky-blue "Import Your Local Skills" removed)
 * - "Project Skills" section is gone
 * - The remaining "Import Local Skills" button opens the scan/import modal
 * - Removed API endpoints return non-200
 */

const JWT_SECRET = process.env.JWT_SECRET || 'claude-ui-dev-secret-change-in-production';
const MAX_USER_ID_SCAN = Number(process.env.PLAYWRIGHT_MAX_USER_ID_SCAN || 10);
const LOGIN_USERNAME = process.env.PLAYWRIGHT_USERNAME;
const LOGIN_PASSWORD = process.env.PLAYWRIGHT_PASSWORD;

async function findValidTokenForExistingUser(request: APIRequestContext): Promise<string | null> {
  for (let userId = 1; userId <= MAX_USER_ID_SCAN; userId += 1) {
    const candidateToken = jwt.sign(
      { userId, username: `playwright-e2e-${userId}` },
      JWT_SECRET,
    );
    const response = await request.get('/api/auth/user', {
      headers: { Authorization: `Bearer ${candidateToken}` },
    });
    if (response.ok()) return candidateToken;
  }
  return null;
}

async function getAuthToken(request: APIRequestContext): Promise<string> {
  const authStatusResponse = await request.get('/api/auth/status');
  const authStatus = await authStatusResponse.json();

  // Auth might be disabled (isAuthenticated: true without setup) — return empty token
  if (authStatus.isAuthenticated && !authStatus.needsSetup) {
    // Try to find a valid token anyway
    const discovered = await findValidTokenForExistingUser(request);
    if (discovered) return discovered;
    // Auth wall might be disabled — return empty token, pages should load fine
    return '';
  }

  if (authStatus.needsSetup) {
    const setupUsername = process.env.PLAYWRIGHT_SETUP_USERNAME || `playwright-${Date.now()}`;
    const setupPassword = process.env.PLAYWRIGHT_SETUP_PASSWORD || 'playwright-password-123';
    const registerResponse = await request.post('/api/auth/register', {
      data: { username: setupUsername, password: setupPassword },
    });
    expect(registerResponse.ok()).toBeTruthy();
    return (await registerResponse.json()).token;
  }

  if (LOGIN_USERNAME && LOGIN_PASSWORD) {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: LOGIN_USERNAME, password: LOGIN_PASSWORD },
    });
    expect(loginResponse.ok()).toBeTruthy();
    return (await loginResponse.json()).token;
  }

  const discoveredToken = await findValidTokenForExistingUser(request);
  if (discoveredToken) return discoveredToken;

  // Fall back to empty token — auth wall may be disabled
  return '';
}

async function ensureAuthenticated(page: Page, request: APIRequestContext) {
  const token = await getAuthToken(request);
  if (token) {
    try {
      await request.post('/api/user/complete-onboarding', {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* non-fatal */ }
    await page.addInitScript((authToken) => {
      window.localStorage.setItem('auth-token', authToken);
    }, token);
  }
}

/** Select the first project in the sidebar (desktop layout). */
async function selectFirstProject(page: Page) {
  // Wait for project list to load — look for any project button in sidebar
  // Desktop buttons use md:flex class
  const projectBtn = page.locator('button.md\\:flex').first();
  await expect(projectBtn).toBeVisible({ timeout: 20000 });
  await projectBtn.click();
  await page.waitForTimeout(2000);
}

/** Click the Skills tab */
async function clickSkillsTab(page: Page) {
  // Try the span inside tab button first (lg+ screens)
  const skillsSpan = page.locator('button span.lg\\:inline:has-text("Skills")').first();
  const visible = await skillsSpan.isVisible({ timeout: 3000 }).catch(() => false);
  if (visible) {
    await skillsSpan.click();
  } else {
    // Fallback: click the tab button by aria or tooltip
    const skillsBtn = page.locator('button[title="Skills"], button:has(svg.lucide-sparkles)').first();
    await skillsBtn.click();
  }
  await page.waitForTimeout(2000);
}

/** Navigate to Skills Dashboard with a project selected */
async function goToSkillsDashboard(page: Page) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await selectFirstProject(page);
  await clickSkillsTab(page);
}

test.describe('Skills Refactor — Single Import Button + No Project Skills', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await ensureAuthenticated(page, page.request);
  });

  test('1. "Import Your Local Skills" button is removed', async ({ page }) => {
    await goToSkillsDashboard(page);

    await page.screenshot({ path: 'test-results/skills-01-dashboard.png', fullPage: true });

    // The old sky-blue "Import Your Local Skills" button must be gone
    const oldButton = page.locator('button:has-text("Import Your Local Skills")');
    await expect(oldButton).toHaveCount(0);

    console.log('PASS: "Import Your Local Skills" button is removed');
  });

  test('2. Exactly one "Import Local Skills" button exists', async ({ page }) => {
    await goToSkillsDashboard(page);

    // There should be exactly one button with this text — use a broad locator
    // The button has Download icon + translated text ("Import Local Skills" or "导入本地技能")
    const importButtons = page.getByRole('button', { name: /Import Local Skills|导入本地技能/ });
    const count = await importButtons.count();
    expect(count).toBe(1);

    await page.screenshot({ path: 'test-results/skills-02-single-button.png', fullPage: true });

    console.log('PASS: Exactly one "Import Local Skills" button exists');
  });

  test('3. "Project Skills" section is removed', async ({ page }) => {
    await goToSkillsDashboard(page);

    // "Project Skills" heading must be gone
    const projectSkillsHeading = page.locator('h3:has-text("Project Skills")');
    await expect(projectSkillsHeading).toHaveCount(0);

    // The description text must also be gone
    const projectSkillsDesc = page.locator('text=Skills imported into this project');
    await expect(projectSkillsDesc).toHaveCount(0);

    console.log('PASS: "Project Skills" section is removed');
  });

  test('4. Import modal opens with default path', async ({ page }) => {
    await goToSkillsDashboard(page);

    // Click the "Import Local Skills" button
    const importBtn = page.getByRole('button', { name: /Import Local Skills|导入本地技能/ }).first();
    await expect(importBtn).toBeVisible({ timeout: 10000 });
    await importBtn.click();

    // Modal should appear
    const modalTitle = page.locator('text=Import skills from local directory');
    await expect(modalTitle).toBeVisible({ timeout: 5000 });

    // Path input should default to ~/.claude/skills
    const pathInput = page.locator('input[placeholder="~/.claude/skills"]');
    await expect(pathInput).toBeVisible();
    const pathValue = await pathInput.inputValue();
    expect(pathValue).toBe('~/.claude/skills');

    // Scan button should be visible
    const scanBtn = page.getByRole('button', { name: /^Scan$|^扫描$/ });
    await expect(scanBtn).toBeVisible();

    await page.screenshot({ path: 'test-results/skills-03-import-modal.png', fullPage: true });

    console.log('PASS: Import modal opens with default path ~/.claude/skills');
  });

  test('5. Scan works and shows results or empty state', async ({ page }) => {
    await goToSkillsDashboard(page);

    // Open modal
    const importBtn = page.getByRole('button', { name: /Import Local Skills|导入本地技能/ }).first();
    await importBtn.click();
    await expect(page.locator('text=Import skills from local directory')).toBeVisible({ timeout: 5000 });

    // Click Scan
    const scanBtn = page.getByRole('button', { name: /^Scan$|^扫描$/ });
    await scanBtn.click();

    // Wait for the scan to complete (scan-local API call)
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'test-results/skills-04-scan-result.png', fullPage: true });

    // Either: skills listed (checkboxes), "no skills found", or path error — all valid
    const checkboxes = page.locator('input[type="checkbox"]');
    const noSkillsMsg = page.locator('text=/No skills found|未在该目录中发现/');
    const errorMsg = page.locator('text=/Path does not exist|does not exist/');

    const hasCheckboxes = (await checkboxes.count()) > 0;
    const hasNoSkills = (await noSkillsMsg.count()) > 0;
    const hasError = (await errorMsg.count()) > 0;

    expect(hasCheckboxes || hasNoSkills || hasError).toBeTruthy();

    console.log(`PASS: Scan completed — checkboxes: ${await checkboxes.count()}, noSkills: ${hasNoSkills}, error: ${hasError}`);
  });

  test('6. Removed API endpoints no longer return JSON', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // GET /:projectName/user-skills should no longer return a JSON skills list
    // (Vite SPA fallback may return 200 with HTML, so we check content-type)
    const userSkillsResponse = await page.request.get('/api/skills/test-project/user-skills');
    const contentType = userSkillsResponse.headers()['content-type'] || '';
    const isJsonSkillsList = contentType.includes('application/json') &&
      userSkillsResponse.status() === 200;

    if (isJsonSkillsList) {
      // If it somehow returns JSON 200, the body should NOT have a "skills" array
      const body = await userSkillsResponse.json().catch(() => ({}));
      expect(body).not.toHaveProperty('skills');
    }

    // PUT /:projectName/user-skills/:skillName should not return success JSON
    const updateResponse = await page.request.put('/api/skills/test-project/user-skills/some-skill');
    const updateContentType = updateResponse.headers()['content-type'] || '';
    const isJsonUpdate = updateContentType.includes('application/json') &&
      updateResponse.status() === 200;

    if (isJsonUpdate) {
      const body = await updateResponse.json().catch(() => ({}));
      expect(body).not.toHaveProperty('success');
    }

    console.log(`PASS: GET user-skills → ${userSkillsResponse.status()} (${contentType}), PUT → ${updateResponse.status()} (${updateContentType})`);
  });
});
