import { test, expect, type Page, type Route } from '@playwright/test';

// Control only the validation/create endpoints. No projects are written to the backend.
async function openProjectForm(page: Page) {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'New Project' }).click();
  await expect(page.getByRole('heading', { name: 'Create Project' })).toBeVisible();
  await page.getByLabel('Project Name').fill('Single submission');
  await page.getByLabel('Local Path').fill('/controlled/project');
  // Finish the field's independent blur validation before testing submit validation.
  await page.getByLabel('Project Name').focus();
  await expect(page.getByText('Local Path is valid', { exact: true })).toBeVisible();
}

for (const firstValidation of ['success', 'invalid', 'unavailable'] as const) {
  test(`project submission reserves validation and permits retry after ${firstValidation}`, async ({ page }) => {
    let holdValidation = false;
    let validationCalls = 0;
    let createCalls = 0;
    const pending = new Set<Route>();
    let resolveValidation!: (route: Route) => void;
    let nextValidation = new Promise<Route>((resolve) => { resolveValidation = resolve; });
    let resolveCreate!: (route: Route) => void;
    let nextCreate = new Promise<Route>((resolve) => { resolveCreate = resolve; });
    await page.route('**/api/projects/validate-path', async (route) => {
      if (!holdValidation) {
        await route.fulfill({ json: { valid: true } });
        return;
      }
      validationCalls++;
      pending.add(route);
      resolveValidation(route);
    });
    await page.route('**/api/projects', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      createCalls++;
      pending.add(route);
      resolveCreate(route);
    });
    try {
      await openProjectForm(page);
      holdValidation = true;
      const form = page.locator('form').filter({ has: page.getByLabel('Project Name') });
      const submit = form.locator('button[type="submit"]');
      // Two same-tick form submissions exercise the synchronous reservation too.
      await form.evaluate((element) => {
        (element as HTMLFormElement).requestSubmit();
        (element as HTMLFormElement).requestSubmit();
      });
      const first = await nextValidation;
      await expect(submit).toBeDisabled();
      expect(validationCalls).toBe(1);
      expect(createCalls).toBe(0);
      await first.fulfill(firstValidation === 'unavailable'
        ? { status: 503, json: { error: 'controlled validation failure' } }
        : { json: { valid: firstValidation === 'success', error: 'controlled invalid path' } });
      pending.delete(first);
      if (firstValidation === 'success') {
        const create = await nextCreate;
        await expect(submit).toBeDisabled();
        await form.evaluate((element) => (element as HTMLFormElement).requestSubmit());
        expect(createCalls).toBe(1);
        await create.fulfill({ status: 503, json: { error: 'controlled create failure' } });
        pending.delete(create);
      }
      await expect(submit).toBeEnabled();
      expect(createCalls).toBe(firstValidation === 'success' ? 1 : 0);
      nextValidation = new Promise<Route>((resolve) => { resolveValidation = resolve; });
      nextCreate = new Promise<Route>((resolve) => { resolveCreate = resolve; });
      await submit.click();
      const retry = await nextValidation;
      await retry.fulfill({ json: { valid: true } });
      pending.delete(retry);
      const created = await nextCreate;
      expect(validationCalls).toBe(2);
      expect(createCalls).toBe(firstValidation === 'success' ? 2 : 1);
      await created.fulfill({ status: 503, json: { error: 'controlled create failure' } });
      pending.delete(created);
      await expect(submit).toBeEnabled();
    } finally {
      // Never release pending create requests onto the real test backend on failure.
      for (const route of pending) await route.abort().catch(() => {});
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
