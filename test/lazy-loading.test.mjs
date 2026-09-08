import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

// A real React DOM/Suspense regression without starting the app backend or
// reading developer credentials. Run with node --test test/lazy-loading.test.mjs.
let browser;
let server;
let origin;

before(async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./fixtures/lazy-loading.tsx', import.meta.url))],
    bundle: true, write: false, format: 'esm', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  server = createServer((req, res) => {
    if (req.url === '/fixture.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(result.outputFiles[0].contents);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<div id="root"></div><script type="module" src="/fixture.js"></script>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function openFixture(t, query = '') {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(`${origin}/${query}`);
  return page;
}

async function recover(page) {
  await page.evaluate(() => { window.loadingFixture.mode = 'success'; });
}

test('exhausted retries reach the error boundary and Try Again starts one new load', async t => {
  const page = await openFixture(t);
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  assert.equal(await page.evaluate(() => window.loadingFixture.attempts.shared), 3);
  await recover(page);
  await page.getByRole('button', { name: 'Try Again' }).click();
  await expect(page.getByRole('button', { name: 'first loaded 0' })).toBeVisible();
  assert.equal(await page.evaluate(() => window.loadingFixture.attempts.shared), 4);
});

test('resetKey retries a failed subtree without remounting a healthy subtree', async t => {
  const page = await openFixture(t);
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  await recover(page);
  await page.getByRole('button', { name: 'Change reset key' }).click();
  await page.getByRole('button', { name: 'first loaded 0' }).click();
  await page.getByRole('button', { name: 'Change reset key' }).click();
  await page.getByRole('button', { name: 'Rerender 0' }).click();
  await expect(page.getByRole('button', { name: 'first loaded 1' })).toBeVisible();
  assert.equal(await page.evaluate(() => window.loadingFixture.attempts.shared), 4);
});

test('boundaries stay isolated for the same lazy component and a shared rejection object', async t => {
  const page = await openFixture(t, '?multiple');
  await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(3);
  await recover(page);
  await page.getByTestId('first').getByRole('button', { name: 'Try Again' }).click();
  await expect(page.getByRole('button', { name: 'first loaded 0' })).toBeVisible();
  await page.getByRole('button', { name: 'first loaded 0' }).click();
  await expect(page.getByRole('button', { name: 'Try Again' })).toHaveCount(2);
  assert.deepEqual(await page.evaluate(() => window.loadingFixture.attempts), { shared: 7, other: 3 });

  // Let both siblings fail again with the same Error object, then force the
  // recovered wrapper to render. Its cached success must remain untouched.
  await page.evaluate(() => { window.loadingFixture.mode = 'failure'; });
  await page.getByTestId('second').getByRole('button', { name: 'Try Again' }).click();
  await page.waitForFunction(() => window.loadingFixture.attempts.shared === 10);
  await expect(page.getByTestId('second').getByRole('button', { name: 'Try Again' })).toBeVisible();
  await page.getByTestId('third').getByRole('button', { name: 'Try Again' }).click();
  await page.waitForFunction(() => window.loadingFixture.attempts.other === 6);
  await expect(page.getByTestId('third').getByRole('button', { name: 'Try Again' })).toBeVisible();
  await page.getByRole('button', { name: 'Rerender 0' }).click();
  await expect(page.getByRole('button', { name: 'Rerender 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'first loaded 1' })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.loadingFixture.attempts), { shared: 10, other: 6 });

  await recover(page);
  await page.getByTestId('second').getByRole('button', { name: 'Try Again' }).click();
  await page.getByTestId('third').getByRole('button', { name: 'Try Again' }).click();
  await expect(page.getByRole('button', { name: 'second loaded 0' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'third loaded 0' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'first loaded 1' })).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.loadingFixture.attempts), { shared: 11, other: 7 });
});

test('closing a pending subtree isolates its late rejection from the reopened subtree', async t => {
  const page = await openFixture(t);
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  await page.evaluate(() => { window.loadingFixture.mode = 'pending'; });
  await page.getByRole('button', { name: 'Try Again' }).click();
  await page.waitForFunction(() => typeof window.loadingFixture.rejectPending === 'function');
  await page.getByRole('button', { name: 'Toggle first' }).click();
  await recover(page);
  await page.getByRole('button', { name: 'Toggle first' }).click();
  await expect(page.getByRole('button', { name: 'first loaded 0' })).toBeVisible();
  await page.evaluate(() => {
    window.loadingFixture.mode = 'failure';
    window.loadingFixture.rejectPending();
  });
  // Initial failure (3), pending load (1), reopened success (1), old retries (2).
  await page.waitForFunction(() => window.loadingFixture.attempts.shared === 7);
  await page.getByRole('button', { name: 'first loaded 0' }).click();
  await page.getByRole('button', { name: 'Rerender 0' }).click();
  await expect(page.getByRole('button', { name: 'first loaded 1' })).toBeVisible();
});

test('a boundary inside an outer Suspense still commits a failure and can retry', async t => {
  const page = await openFixture(t, '?reverse');
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  await recover(page);
  await page.getByRole('button', { name: 'Try Again' }).click();
  await expect(page.getByRole('button', { name: 'first loaded 0' })).toBeVisible();
});

test('persistent chunk failures show reload UI instead of an infinite spinner', async t => {
  const page = await openFixture(t);
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  await page.evaluate(() => { window.loadingFixture.mode = 'chunk-failure'; });
  await page.getByRole('button', { name: 'Try Again' }).click();
  await expect(page.getByRole('alert')).toContainText('Module unavailable');
  await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
});
