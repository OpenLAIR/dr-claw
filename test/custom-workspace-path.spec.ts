import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import jwt from 'jsonwebtoken';
import os from 'os';
import path from 'path';

/**
 * Bug verification: "Can't customize the folder for the new workspace" (Qin Ye)
 *
 * Root cause: commit 389da8d changed WORKSPACES_ROOT from os.homedir() to
 * path.join(os.homedir(), 'vibelab'), which previously restricted all
 * workspace operations to the legacy default root only.
 *
 * Current expected default root after the rename pass: ~/dr-claw.
 *
 * Fix: revert WORKSPACES_ROOT default back to os.homedir().
 */

const JWT_SECRET = process.env.JWT_SECRET || 'claude-ui-dev-secret-change-in-production';
const MAX_USER_ID_SCAN = Number(process.env.PLAYWRIGHT_MAX_USER_ID_SCAN || 10);
const LOGIN_USERNAME = process.env.PLAYWRIGHT_USERNAME;
const LOGIN_PASSWORD = process.env.PLAYWRIGHT_PASSWORD;

// --- Auth helpers ---

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
  expect(authStatusResponse.ok()).toBeTruthy();
  const authStatus = await authStatusResponse.json();

  if (authStatus.needsSetup) {
    const registerResponse = await request.post('/api/auth/register', {
      data: {
        username: process.env.PLAYWRIGHT_SETUP_USERNAME || `playwright-${Date.now()}`,
        password: process.env.PLAYWRIGHT_SETUP_PASSWORD || 'playwright-password-123',
      },
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

  throw new Error('Authentication required.');
}

// --- Tests ---

test.describe('Workspace Path Customization', () => {
  test.describe.configure({ mode: 'serial' });

  test('API accepts workspace creation under ~/Documents (outside ~/dr-claw)', async ({ request }) => {
    const token = await getAuthToken(request);
    const customPath = path.join(os.homedir(), 'Documents', `dr-claw-test-${Date.now()}`);

    const response = await request.post('/api/projects/create-workspace', {
      headers: { Authorization: `Bearer ${token}` },
      data: { workspaceType: 'new', path: customPath },
    });

    const body = await response.json();
    console.log(`Status: ${response.status()}, path: ${customPath}`);
    console.log(`Response: ${JSON.stringify(body)}`);

    expect(response.ok()).toBe(true);
    expect(body.success).toBe(true);

    // Cleanup
    const fs = await import('fs');
    fs.rmSync(customPath, { recursive: true, force: true });
  });

  test('API accepts workspace creation under ~/dr-claw (still works)', async ({ request }) => {
    const token = await getAuthToken(request);
    const validPath = path.join(os.homedir(), 'dr-claw', `pw-test-${Date.now()}`);

    const response = await request.post('/api/projects/create-workspace', {
      headers: { Authorization: `Bearer ${token}` },
      data: { workspaceType: 'new', path: validPath },
    });

    const body = await response.json();
    expect(response.ok()).toBe(true);
    expect(body.success).toBe(true);

    // Cleanup
    const fs = await import('fs');
    fs.rmSync(validPath, { recursive: true, force: true });
  });

  test('new project initializes Promotion directories and canonical instance.json paths', async ({ request }) => {
    const token = await getAuthToken(request);
    const projectPath = path.join(os.homedir(), 'dr-claw', `pw-promotion-${Date.now()}`);
    const fs = await import('fs/promises');

    try {
      const response = await request.post('/api/projects/create-workspace', {
        headers: { Authorization: `Bearer ${token}` },
        data: { workspaceType: 'new', path: projectPath },
      });

      const body = await response.json();
      expect(response.ok()).toBe(true);
      expect(body.success).toBe(true);

      const expectedDirs = [
        'Survey/references',
        'Survey/reports',
        'Ideation/ideas',
        'Ideation/references',
        'Experiment/code_references',
        'Experiment/datasets',
        'Experiment/core_code',
        'Experiment/analysis',
        'Publication/paper',
        'Promotion/homepage',
        'Promotion/slides',
        'Promotion/audio',
        'Promotion/video',
      ];

      for (const relPath of expectedDirs) {
        await fs.access(path.join(projectPath, relPath));
      }

      const instanceRaw = await fs.readFile(path.join(projectPath, 'instance.json'), 'utf8');
      const instance = JSON.parse(instanceRaw);

      expect(instance.Publication).toEqual({
        paper: path.join(projectPath, 'Publication', 'paper'),
      });
      expect(instance.Promotion).toEqual({
        homepage: path.join(projectPath, 'Promotion', 'homepage'),
        slides: path.join(projectPath, 'Promotion', 'slides'),
        audio: path.join(projectPath, 'Promotion', 'audio'),
        video: path.join(projectPath, 'Promotion', 'video'),
      });
      expect(instance.Publication.homepage).toBeUndefined();
      expect(instance.Publication.slide).toBeUndefined();
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true });
    }
  });

  test('browse-filesystem ~ resolves to actual home directory', async ({ request }) => {
    const token = await getAuthToken(request);

    const response = await request.get('/api/browse-filesystem?path=~', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    const actualHome = os.homedir();

    console.log(`~ resolves to: ${body.path}`);
    console.log(`Actual home dir: ${actualHome}`);

    // After fix: ~ should map to the real home directory
    expect(body.path.toLowerCase()).toBe(actualHome.toLowerCase());
  });

  test('API still rejects forbidden system paths', async ({ request }) => {
    const token = await getAuthToken(request);

    const response = await request.post('/api/projects/create-workspace', {
      headers: { Authorization: `Bearer ${token}` },
      data: { workspaceType: 'new', path: '/etc/dr-claw-test' },
    });

    expect(response.ok()).toBe(false);
    const body = await response.json();
    expect(body.details || body.error).toMatch(/system directory/i);
  });
});
