import { test, expect, type Route } from '@playwright/test';

for (const outcome of ['success', 'failure'] as const) {
  test(`project history navigation ignores old task load ${outcome}`, async ({ page }) => {
    const projects = ['a', 'b'].map(id => ({ id, name: `Ownership ${id.toUpperCase()}`, isDefault: false, createdAt: 1, taskCounts: {} }));
    const task = (projectId: string) => ({ id: `${projectId}-task`, projectId, title: `${projectId.toUpperCase()} scoped task`, description: '',
      priority: 'medium', agentType: 'copilot', columnId: 'backlog', agentStatus: 'idle', createdAt: 1 });
    let delayed: Route | undefined;
    let readsA = 0;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.routeWebSocket('**/ws', () => {});
    await page.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== 'GET') throw new Error(`Unexpected write: ${request.method()} ${url.pathname}`);
      if (url.pathname === '/api/projects') { await route.fulfill({ json: projects }); return; }
      if (url.pathname === '/api/projects/config') { await route.fulfill({ json: { cloneRoot: '/fixture' } }); return; }
      if (url.pathname === '/api/tasks') {
        if (url.searchParams.get('projectId') === 'b') {
          delayed = route;
          await held;
          if (outcome === 'success') await route.fulfill({ json: [task('b')] });
          else await route.fulfill({ status: 500, json: { error: 'Old B load failed' } });
        } else {
          readsA++;
          await route.fulfill({ json: [task('a')] });
        }
        return;
      }
      await route.fulfill({ json: [] });
    });
    await page.goto('/projects/a');
    await expect(page.getByRole('heading', { name: 'A scoped task' })).toBeVisible();
    // Same-project history changes must not reset board-local UI or reload tasks.
    const search = page.getByRole('textbox', { name: 'Search tasks', exact: true });
    await search.fill('A scoped');
    const initialReadsA = readsA;
    await page.evaluate(() => history.pushState(null, '', '/projects/a?history-check=1'));
    await page.goBack();
    await expect(search).toHaveValue('A scoped');
    expect(readsA).toBe(initialReadsA);
    await page.getByRole('button', { name: 'Back to Projects' }).click();
    await page.getByRole('article', { name: 'Ownership B' }).getByRole('button', { name: 'Open Project' }).click();
    await expect(page).toHaveURL(/\/projects\/b$/);
    await expect.poll(() => Boolean(delayed)).toBe(true);
    // The browser's history menu can jump over the intermediate project list.
    const readsBeforeReturn = readsA;
    await page.evaluate(() => history.go(-2));
    await expect(page).toHaveURL(/\/projects\/a$/);
    await expect.poll(() => readsA).toBeGreaterThan(readsBeforeReturn);
    await expect(page.getByRole('heading', { name: 'A scoped task' })).toBeVisible();
    const oldResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get('projectId') === 'b');
    release();
    await (await oldResponse).finished();
    // Cross the fetch/json microtasks and React's next paint before the negative assertions.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.getByRole('heading', { name: 'A scoped task' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'B scoped task' })).toHaveCount(0);
    await expect(page.getByText(/Old B load failed/)).toHaveCount(0);
  });
}
