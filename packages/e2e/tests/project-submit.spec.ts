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

for (const staleStage of ['validation', 'save', 'picker'] as const) {
  test(`closed project dialog ignores a late ${staleStage} result after reopening`, async ({ page }) => {
    const pending = new Set<Route>();
    let hold = false;
    let captureRefresh = false;
    let resolveHeld!: (route: Route) => void;
    const held = new Promise<Route>((resolve) => { resolveHeld = resolve; });
    const submittedNames: string[] = [];
    await page.route('**/api/projects/validate-path', async (route) => {
      if (hold && staleStage === 'validation') {
        hold = false;
        pending.add(route);
        resolveHeld(route);
      } else await route.fulfill({ json: { valid: true } });
    });
    await page.route('**/api/projects/select-directory', async (route) => {
      pending.add(route);
      resolveHeld(route);
    });
    await page.route('**/api/projects', async (route) => {
      if (route.request().method() !== 'POST') {
        if (captureRefresh) {
          captureRefresh = false;
          await route.fulfill({ json: [], headers: { 'x-controlled-refresh': 'complete' } });
        } else await route.continue();
        return;
      }
      submittedNames.push(route.request().postDataJSON().name);
      if (hold && staleStage === 'save') {
        hold = false;
        pending.add(route);
        resolveHeld(route);
      } else await route.fulfill({ status: 503, json: { error: 'controlled save failure' } });
    });
    try {
      await openProjectForm(page);
      hold = true;
      if (staleStage === 'picker') await page.getByRole('button', { name: 'Browse…', exact: true }).click();
      else await page.getByRole('button', { name: 'Create Project', exact: true }).click();
      const old = await held;
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'New Project' }).click();
      await page.getByLabel('Project Name').fill('New session');
      await page.getByLabel('Local Path').fill('/controlled/new');
      await page.getByLabel('Project Name').focus();
      await expect(page.getByText('Local Path is valid', { exact: true })).toBeVisible();
      const responsePromise = page.waitForResponse((response) => response.request() === old.request());
      captureRefresh = staleStage === 'save';
      const refreshResponse = staleStage === 'save'
        ? page.waitForResponse((response) => response.headers()['x-controlled-refresh'] === 'complete')
        : undefined;
      await old.fulfill({ json: staleStage === 'validation' ? { valid: true }
        : staleStage === 'picker' ? { repoPath: '/obsolete/picker' }
          : { id: 'controlled-old', name: 'Single submission' } });
      pending.delete(old);
      const response = await responsePromise;
      await response.finished();
      // createProject waits for a GET refresh before the old dialog callback returns.
      if (refreshResponse) await (await refreshResponse).finished();
      // Drain the handled response's promise chain before interacting with the new form.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.getByRole('heading', { name: 'Create Project', exact: true })).toBeVisible();
      await expect(page.getByLabel('Project Name')).toHaveValue('New session');
      await expect(page.getByLabel('Local Path')).toHaveValue('/controlled/new');
      await expect(page.getByRole('button', { name: 'Create Project', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Create Project', exact: true }).click();
      await expect.poll(() => submittedNames.length).toBe(staleStage === 'save' ? 2 : 1);
      expect(submittedNames).toEqual(staleStage === 'save' ? ['Single submission', 'New session'] : ['New session']);
      await expect(page.getByRole('button', { name: 'Create Project', exact: true })).toBeEnabled();
    } finally {
      for (const route of pending) await route.abort().catch(() => {});
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
