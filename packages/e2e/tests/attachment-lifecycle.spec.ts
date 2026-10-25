import { test, expect, type Page, type Route } from '@playwright/test';
import { API, createTaskViaAPI, waitForBoard } from './helpers';

const image = (id: string, taskId: string) => ({
  id, taskId, originalName: `${id}.png`, mimeType: 'image/png', size: 1, createdAt: 1,
});

// Real dialog interactions with delayed attachment responses, not a persistence test.
test.describe('attachment loads belong to the current dialog session', () => {
  let tasks: { id: string; title: string }[];
  let pending: Route[];
  let uploads: Route[];
  let deletions: Route[];

  test.beforeEach(async ({ page, request }) => {
    tasks = [];
    pending = [];
    uploads = [];
    deletions = [];
    for (const label of ['A', 'B']) {
      tasks.push(await createTaskViaAPI(request, { title: `Attachment lifecycle ${label} ${Date.now()}` }));
    }
    await page.route('**/api/attachments/*/file', route => route.fulfill({
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    }));
    await page.route('**/api/tasks/*/attachments', route => {
      (route.request().method() === 'GET' ? pending : uploads).push(route);
    });
    await page.route('**/api/attachments/*', route => { deletions.push(route); });
    await page.goto('/projects/default');
    await waitForBoard(page);
  });

  test.afterEach(async ({ page, request }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    for (const task of tasks) await request.delete(`${API}/api/tasks/${task.id}`);
  });

  async function open(page: Page, index: number) {
    const card = page.locator('.group').filter({ has: page.getByRole('heading', { name: tasks[index].title }) });
    await expect(card).toHaveCount(1);
    await card.hover();
    await card.getByRole('button', { name: 'Edit task' }).click();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  }

  async function respond(page: Page, index: number, taskIndex: number, id: string, fail = false) {
    await expect.poll(() => pending.length).toBeGreaterThan(index);
    const route = pending[index];
    const completed = page.waitForEvent('requestfinished', request => request === route.request());
    await route.fulfill(fail
      ? { status: 500, json: { error: 'controlled attachment load failure' } }
      : { json: [image(id, tasks[taskIndex].id)] });
    await completed;
    // Let the fulfilled fetch and React's resulting render run before absence checks.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }

  for (const sameTask of [false, true]) {
    for (const fail of [false, true]) {
      test(`ignores old ${fail ? 'failure' : 'success'} after reopening ${sameTask ? 'the same task' : 'another task'}`, async ({ page }) => {
        await open(page, 0);
        await expect.poll(() => pending.length).toBe(1);
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        const next = sameTask ? 0 : 1;
        await open(page, next);
        await respond(page, 1, next, 'current');
        await expect(page.getByRole('img', { name: 'current.png', exact: true })).toBeVisible();
        await respond(page, 0, 0, 'stale', fail);
        await expect(page.getByRole('img', { name: 'current.png', exact: true })).toBeVisible();
        await expect(page.getByRole('img', { name: 'stale.png', exact: true })).toHaveCount(0);
      });
    }
  }

  test('a current failure leaves an empty list and reopening can load successfully', async ({ page }) => {
    await open(page, 0);
    await respond(page, 0, 0, 'failed', true);
    await expect(page.locator('input[type=file]')).toHaveCount(1);
    await expect(page.getByRole('img', { name: 'failed.png', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await open(page, 0);
    await respond(page, 1, 0, 'retried');
    await expect(page.getByRole('img', { name: 'retried.png', exact: true })).toBeVisible();
  });

  async function finishMutation(page: Page, route: Route, json?: ReturnType<typeof image>[]) {
    const completed = page.waitForEvent('requestfinished', request => request === route.request());
    await route.fulfill(json ? { json } : { status: 204 });
    await completed;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }

  const file = { name: 'new.png', mimeType: 'image/png', buffer: Buffer.from('test') };

  for (const fail of [false, true]) {
    test(`initial load ${fail ? 'failure' : 'success'} enables uploads only after it finishes`, async ({ page }) => {
      await open(page, 0);
      await expect(page.getByRole('status')).toHaveText('Loading images…');
      await expect(page.locator('input[type=file]')).toHaveCount(0);
      await respond(page, 0, 0, 'existing', fail);
      await expect(page.getByRole('status')).toHaveCount(0);
      await page.locator('input[type=file]').setInputFiles(file);
      await expect.poll(() => uploads.length).toBe(1);
      await finishMutation(page, uploads[0], [image('new', tasks[0].id)]);
      await expect(page.getByRole('img', { name: 'new.png', exact: true })).toBeVisible();
    });
  }

  for (const sameTask of [false, true]) {
    test(`an old upload cannot replace images after reopening ${sameTask ? 'the same task' : 'another task'}`, async ({ page }) => {
      await open(page, 0);
      await respond(page, 0, 0, 'existing');
      await page.locator('input[type=file]').setInputFiles(file);
      await expect.poll(() => uploads.length).toBe(1);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      const next = sameTask ? 0 : 1;
      await open(page, next);
      await respond(page, 1, next, 'current');
      await finishMutation(page, uploads[0], [image('old-upload', tasks[0].id)]);
      await expect(page.getByRole('img', { name: 'current.png', exact: true })).toBeVisible();
      await expect(page.getByRole('img', { name: 'old-upload.png', exact: true })).toHaveCount(0);
      await expect(page.getByRole('img', { name: 'existing.png', exact: true })).toHaveCount(0);
    });
  }

  test("an old deletion cannot replace another task's images", async ({ page }) => {
    await open(page, 0);
    await respond(page, 0, 0, 'existing');
    const thumb = page.getByRole('img', { name: 'existing.png', exact: true }).locator('..');
    await thumb.hover();
    await thumb.getByRole('button').click();
    await expect.poll(() => deletions.length).toBe(1);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await open(page, 1);
    await respond(page, 1, 1, 'current');
    await finishMutation(page, deletions[0]);
    await expect(page.getByRole('img', { name: 'current.png', exact: true })).toBeVisible();
  });

});
