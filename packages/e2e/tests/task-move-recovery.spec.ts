import { test, expect, type Page } from '@playwright/test';

async function dragToReview(page: Page, title: string) {
  const card = page.locator('[data-column="in-progress"] .group').filter({
    // Task headings include a priority icon in their accessible name.
    has: page.getByRole('heading', { name: title }),
  });
  await card.scrollIntoViewIfNeeded();
  // dnd-kit hides the original card while its drop overlay animates back.
  // Wait for the actual card to receive pointer input before a second drag.
  await expect(card).toHaveCSS('opacity', '1');
  await card.hover();
  const source = await card.boundingBox();
  const target = await page.locator('[data-column="review"]').boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 20 });
  await page.mouse.up();
}

for (const failure of ['rejection', 'offline'] as const) {
  test(`failed task move stays retryable after ${failure}, even without refresh`, async ({ page }) => {
    const projectId = 'move-recovery-fixture';
    const title = `Move recovery ${failure}`;
    let task = { id: 'move-task', projectId, title, description: '', priority: 'medium',
      agentType: 'copilot', createdAt: 1, columnId: 'in-progress', agentStatus: 'complete' };
    let moves = 0;
    let refreshesAfterMove = 0;
    // No real writes, provider execution or WebSocket updates in this fixture.
    await page.routeWebSocket('**/ws', () => {});
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'PATCH' && path === '/api/tasks/move-task') {
        expect(request.postDataJSON()).toEqual({ columnId: 'review' });
        moves++;
        if (moves === 1) {
          if (failure === 'offline') await route.abort('failed');
          else await route.fulfill({ status: 403, json: { error: 'Move rejected' } });
        } else {
          task = { ...task, columnId: 'review' };
          await route.fulfill({ json: task });
        }
        return;
      }
      if (request.method() !== 'GET') throw new Error(`Unexpected write: ${request.method()} ${path}`);
      if (path === '/api/projects') { await route.fulfill({ json: [{ id: projectId, name: 'Move fixture', isDefault: false, createdAt: 1, taskCounts: {} }] }); return; }
      if (path === '/api/projects/config') { await route.fulfill({ json: { cloneRoot: '/fixture' } }); return; }
      if (path === '/api/tasks') {
        // Baseline recovery fails here too, leaving its optimistic move stuck.
        if (moves) { refreshesAfterMove++; await route.abort('failed'); }
        else await route.fulfill({ json: [task] });
        return;
      }
      await route.fulfill({ json: [] });
    });
    await page.goto(`/projects/${projectId}`);
    const originalColumn = page.locator('[data-column="in-progress"]');
    const review = page.locator('[data-column="review"]');
    await expect(originalColumn.getByRole('heading', { name: title })).toBeVisible();
    await dragToReview(page, title);
    await expect.poll(() => moves).toBe(1);
    await expect(page.getByText(/Move failed:/)).toBeVisible();
    await expect(originalColumn.getByRole('heading', { name: title })).toBeVisible();
    await expect(review.getByRole('heading', { name: title })).toHaveCount(0);
    await dragToReview(page, title);
    await expect.poll(() => moves).toBe(2);
    await expect(review.getByRole('heading', { name: title })).toBeVisible();
    await expect(originalColumn.getByRole('heading', { name: title })).toHaveCount(0);
    expect(refreshesAfterMove).toBe(0);
  });
}
