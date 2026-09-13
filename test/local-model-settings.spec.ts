import { test, expect } from '@playwright/test';

// Render real Settings and provider state against an in-browser server fixture;
// no credentials, GPU, or model download is needed.
test('local settings hydrates backend defaults and updates an already-mounted chat', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/test/fixtures/local-model-settings.html');
  await expect(page.getByRole('textbox')).toHaveValue('http://localhost:8000/v1');
  await expect(page.getByText('Pull New Model', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await expect(page.getByText(/Connected! Local server has/)).toBeVisible();
  await page.getByRole('button', { name: 'Save & Refresh', exact: true }).click();
  await expect(page.getByText('Configuration saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'org/vllm-model', exact: true }).click();
  await expect(page.locator('#chat-model')).toHaveText('Mounted chat model: org/vllm-model');
  expect(await page.evaluate(() => localStorage.getItem('local-model'))).toBe('org/vllm-model');
  expect(errors).toEqual([]);
});
