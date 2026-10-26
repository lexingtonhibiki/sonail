import { test, expect } from '@playwright/test';

for (const fixture of [
  { columnId: 'done', agentStatus: 'complete' },
  { columnId: 'in-progress', agentStatus: 'failed' },
]) {
  test(`archived ${fixture.columnId} tasks leave ordinary columns and restore once`, async ({ page }) => {
    const projectId = 'archive-board-fixture';
    const title = `Archive fixture ${fixture.columnId}`;
    let task = { id: 'archive-task', projectId, title, description: '', priority: 'medium',
      agentType: 'copilot', createdAt: 1, archived: false, ...fixture };
    const writes: string[] = [];
    // Keep all task operations in memory; never start an agent or mutate a real project.
    await page.routeWebSocket('**/ws', () => {});
    await page.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (request.method() === 'PATCH' && ['/api/tasks/archive-task/archive', '/api/tasks/archive-task/unarchive'].includes(path)) {
        writes.push(path);
        task = { ...task, archived: path.endsWith('/archive') };
        await route.fulfill({ json: task }); return;
      }
      if (request.method() !== 'GET') throw new Error(`Unexpected API write: ${request.method()} ${path}`);
      if (path === '/api/projects') { await route.fulfill({ json: [{ id: projectId, name: 'Archive fixture', isDefault: false, createdAt: 1, taskCounts: {} }] }); return; }
      if (path === '/api/projects/config') { await route.fulfill({ json: { cloneRoot: '/fixture' } }); return; }
      if (path === '/api/tasks') { await route.fulfill({ json: !task.archived || url.searchParams.get('includeArchived') === 'true' ? [task] : [] }); return; }
      await route.fulfill({ json: [] });
    });
    await page.goto(`/projects/${projectId}`);
    const ordinary = page.locator(`[data-column="${fixture.columnId}"]`);
    await expect(ordinary.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await ordinary.getByRole('button', { name: 'Archive task', exact: true }).click();
    // Regression: archive returns the same columnId; the hook retains the updated record.
    await expect(ordinary.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show Archived', exact: true }).click();
    const archived = page.locator('[data-column="archived"]');
    await expect(archived.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(ordinary.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(1);
    await archived.getByRole('button', { name: 'Unarchive task', exact: true }).click();
    await expect(ordinary.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(archived.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Hide Archived', exact: true }).click();
    await expect(ordinary.getByRole('heading', { name: title, exact: true })).toBeVisible();
    expect(writes).toEqual(['/api/tasks/archive-task/archive', '/api/tasks/archive-task/unarchive']);
  });
}
