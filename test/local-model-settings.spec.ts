import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const fixture = (window as any).localModelFixture = {
      modelUrls: [] as string[],
      holdModels: false,
      pending: [] as any[],
      resolveConfig: null as null | (() => void),
    };
    window.fetch = async (input, options = {}) => {
      const url = String(input);
      if (url.includes('/local/config')) {
        await new Promise<void>(resolve => { fixture.resolveConfig = resolve; });
        return Response.json({ serverUrl: 'http://localhost:8000/v1' });
      }
      if (url.includes('/gpu-info')) return Response.json({ gpus: [], system: {} });
      if (url.includes('/local/models')) {
        fixture.modelUrls.push(new URL(url, location.origin).searchParams.get('serverUrl'));
        if (fixture.holdModels) {
          // Deliberately ignore abort to exercise the stale-response guard too.
          return new Promise<Response>((resolve, reject) => {
            fixture.pending.push({ resolve, reject, signal: options.signal });
          });
        }
        return Response.json({ provider: 'openai-compatible', models: [{ name: 'org/vllm-model' }] });
      }
      if (url.includes('/local/save-config')) {
        return Response.json({ success: true, serverUrl: JSON.parse(String(options.body)).serverUrl });
      }
      return Response.json({});
    };
  });
});

const serverUrl = (page: Page) => page.getByPlaceholder('http://localhost:11434', { exact: true });
const model = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });
// The account panel has its own status Refresh; target the one in the models section.
const button = (page: Page, name: string) => (name === 'Refresh' ? page.locator('[data-local-models]') : page)
  .getByRole('button', { name, exact: true });

async function openSettings(page: Page) {
  await page.goto('/test/fixtures/local-model-settings.html');
  await page.waitForFunction(() => (window as any).localModelFixture.resolveConfig);
  await page.evaluate(() => (window as any).localModelFixture.resolveConfig());
  await expect(serverUrl(page)).toHaveValue('http://localhost:8000/v1');
  await expect(model(page, 'org/vllm-model')).toBeVisible();
}

// Render real Settings and provider state against an in-browser server fixture;
// no credentials, GPU, or model download is needed.
test('local settings hydrates backend defaults and updates an already-mounted chat', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openSettings(page);
  await expect(page.getByText('Download a model', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(page.getByText('Connected. 1 model available.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save & refresh', exact: true }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await model(page, 'org/vllm-model').check();
  await expect(page.locator('#chat-model')).toHaveText('Mounted chat model: org/vllm-model');
  expect(await page.evaluate(() => localStorage.getItem('local-model'))).toBe('org/vllm-model');
  expect(await page.evaluate(() => localStorage.getItem('local-gpu-server-url'))).toBe('http://localhost:8000/v1');
  expect(errors).toEqual([]);
});

test('waits for backend configuration before discovering models', async ({ page }) => {
  await page.goto('/test/fixtures/local-model-settings.html');
  await page.waitForFunction(() => (window as any).localModelFixture.resolveConfig);
  expect(await page.evaluate(() => (window as any).localModelFixture.modelUrls)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Test connection', exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).localModelFixture.resolveConfig());
  await expect(model(page, 'org/vllm-model')).toBeVisible();
  expect(await page.evaluate(() => (window as any).localModelFixture.modelUrls)).toEqual(['http://localhost:8000/v1']);
});

test('shows model downloads only for an Ollama server', async ({ page }) => {
  await openSettings(page);
  await page.evaluate(() => { (window as any).localModelFixture.holdModels = true; });
  await button(page, 'Refresh').click();
  await page.waitForFunction(() => (window as any).localModelFixture.pending.length === 1);
  await page.evaluate(() => {
    (window as any).localModelFixture.pending[0].resolve(Response.json({ provider: 'ollama', models: [{ name: 'qwen3:8b' }] }));
  });
  await expect(model(page, 'qwen3:8b')).toBeVisible();
  await expect(page.getByText('Download a model', { exact: true })).toBeVisible();
  // A different, not-yet-loaded address must not inherit the Ollama-only section.
  await serverUrl(page).fill('http://localhost:30000/v1');
  await expect(page.getByText('Download a model', { exact: true })).toHaveCount(0);
});

for (const trigger of ['Refresh', 'Test connection']) {
  for (const outcome of ['ollama', 'http-error', 'network-error']) {
    test(`${trigger}: late ${outcome} cannot replace the current server`, async ({ page }) => {
      await openSettings(page);
      await page.evaluate(() => { (window as any).localModelFixture.holdModels = true; });
      await button(page, trigger).click();
      await page.waitForFunction(() => (window as any).localModelFixture.pending.length === 1);
      // Editing the address supersedes the pending read; loading the new one is explicit.
      await serverUrl(page).fill('http://localhost:30000/v1');
      await button(page, 'Refresh').click();
      await page.waitForFunction(() => (window as any).localModelFixture.pending.length === 2);
      await page.evaluate(() => {
        (window as any).localModelFixture.pending[1].resolve(Response.json({
          provider: 'openai-compatible', models: [{ name: 'org/sglang-model' }],
        }));
      });
      await expect(model(page, 'org/sglang-model')).toBeVisible();
      await page.evaluate(async outcome => {
        const old = (window as any).localModelFixture.pending[0];
        if (outcome === 'network-error') old.reject(new TypeError('fetch failed'));
        else old.resolve(outcome === 'http-error'
          ? Response.json({ error: 'Old server offline', models: [] }, { status: 503 })
          : Response.json({ provider: 'ollama', models: [{ name: 'old-ollama' }] }));
        // Let the async response handlers and React render settle.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, outcome);
      await expect(serverUrl(page)).toHaveValue('http://localhost:30000/v1');
      await expect(model(page, 'org/sglang-model')).toBeVisible();
      await expect(model(page, 'old-ollama')).toHaveCount(0);
      await expect(page.getByText('Download a model', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Old server offline', { exact: true })).toHaveCount(0);
      await expect(page.getByText(/^Connected\./)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Test connection', exact: true })).toBeEnabled();
      expect(await page.evaluate(() => (window as any).localModelFixture.pending[0].signal?.aborted)).toBe(true);
    });
  }
}
