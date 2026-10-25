import { test, expect, type Route, type Page } from '@playwright/test';

async function fillGroup(page: Page, title: string) {
  await page.getByRole('button', { name: 'New Group', exact: true }).click();
  await page.getByPlaceholder('e.g., Q2 Feature Sprint').fill(title);
  const children = page.getByPlaceholder('Task title', { exact: true });
  await children.nth(0).fill('First child');
  await children.nth(1).fill('Second child');
}

for (const scenario of ['old-success', 'old-success-new-pending', 'old-failure-new-pending'] as const) {
  test(`group session ignores ${scenario}`, async ({ page }) => {
    const pending = new Set<Route>();
    const held: Route[] = [];
    await page.route('**/api/groups', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      pending.add(route);
      held.push(route);
    });
    try {
      await page.goto('/projects/default');
      await fillGroup(page, 'Old session');
      await page.getByRole('button', { name: 'Create Group', exact: true }).click();
      await expect.poll(() => held.length).toBe(1);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await fillGroup(page, 'New session');
      if (scenario !== 'old-success') {
        await page.getByRole('button', { name: 'Create Group', exact: true }).click();
        await expect.poll(() => held.length).toBe(2);
      }
      const responsePromise = page.waitForResponse((r) => r.request() === held[0].request());
      await held[0].fulfill(scenario === 'old-failure-new-pending'
        ? { status: 503, json: { error: 'controlled old failure' } }
        : { json: { id: 'controlled-group', projectId: 'default', title: 'Old session', description: '', priority: 'medium', columnId: 'backlog', maxConcurrency: 2, children: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() } });
      pending.delete(held[0]);
      await (await responsePromise).finished();
      // The real hook updates its list/error then returns; it has no follow-up fetch.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.getByRole('heading', { name: 'Create Task Group', exact: true })).toBeVisible();
      await expect(page.getByPlaceholder('e.g., Q2 Feature Sprint')).toHaveValue('New session');
      if (scenario === 'old-success') {
        await expect(page.getByRole('button', { name: 'Create Group', exact: true })).toBeEnabled();
      } else {
        await expect(page.getByRole('button', { name: 'Creating…', exact: true })).toHaveCount(2);
        for (const button of await page.getByRole('button', { name: 'Creating…', exact: true }).all()) await expect(button).toBeDisabled();
        await held[1].fulfill({ status: 503, json: { error: 'controlled current failure' } });
        pending.delete(held[1]);
        await expect(page.getByRole('button', { name: 'Create Group', exact: true })).toBeEnabled();
      }
    } finally {
      // Pending writes must never escape to the real test backend during cleanup.
      for (const route of pending) await route.abort().catch(() => {});
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
