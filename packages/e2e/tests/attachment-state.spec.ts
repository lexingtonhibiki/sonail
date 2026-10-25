import { test, expect, type Route } from '@playwright/test';
import { API, createTaskViaAPI, waitForBoard } from './helpers';

const image = (id: string, taskId: string) => ({
  id, taskId, originalName: `${id}.png`, mimeType: 'image/png', size: 1, createdAt: 1,
});

// Delay individual HTTP responses to exercise overlapping actions in the real UI.
// Attachment payloads are mocked; this suite does not test backend persistence.
test.describe('attachment state during overlapping requests', () => {
  let taskId: string;
  let pending: Map<string, Route[]>;

  test.beforeEach(async ({ page, request }) => {
    const task = await createTaskViaAPI(request, { title: `Attachment state ${Date.now()}` });
    taskId = task.id;
    pending = new Map();
    await page.route('**/api/attachments/*/file', route => route.fulfill({
      contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    }));
    await page.route(`**/api/tasks/${taskId}/attachments`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: [image('a', taskId), image('b', taskId)] });
      } else {
        pending.set('upload', [...(pending.get('upload') ?? []), route]);
      }
    });
    await page.route('**/api/attachments/*', route => {
      const id = new URL(route.request().url()).pathname.split('/').pop()!;
      pending.set(id, [...(pending.get(id) ?? []), route]);
    });
    await page.goto('/projects/default');
    await waitForBoard(page);
    const card = page.locator('.group').filter({ has: page.getByRole('heading', { name: task.title }) });
    await expect(card).toHaveCount(1);
    await card.hover();
    await card.getByRole('button', { name: 'Edit task' }).click();
    await expect(page.getByRole('img', { name: 'a.png', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'b.png', exact: true })).toBeVisible();
  });

  test.afterEach(async ({ page, request }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await request.delete(`${API}/api/tasks/${taskId}`);
  });

  async function response(key: string, status = 204) {
    await expect.poll(() => pending.get(key)?.length ?? 0).toBeGreaterThan(0);
    const route = pending.get(key)!.shift()!;
    await route.fulfill(status === 204 ? { status } : status === 200
      ? { status, json: [image('c', taskId)] }
      : { status, json: { error: 'controlled request failure' } });
  }

  for (const order of [['a', 'b'], ['b', 'a']]) {
    test(`deleting two images retains both removals (${order.join(',')})`, async ({ page }) => {
      for (const id of ['a', 'b']) {
        const thumb = page.getByRole('img', { name: `${id}.png`, exact: true }).locator('..');
        await thumb.hover();
        await thumb.getByRole('button').click();
      }
      await response(order[0]);
      await expect(page.getByRole('img', { name: `${order[0]}.png`, exact: true })).toHaveCount(0);
      await response(order[1]);
      await expect(page.getByRole('img', { name: 'a.png', exact: true })).toHaveCount(0);
      await expect(page.getByRole('img', { name: 'b.png', exact: true })).toHaveCount(0);
    });
  }

  for (const first of ['upload', 'delete']) {
    test(`upload and deletion compose when ${first} completes first`, async ({ page }) => {
      await page.locator('input[type=file]').setInputFiles({ name: 'c.png', mimeType: 'image/png', buffer: Buffer.from('test') });
      const thumb = page.getByRole('img', { name: 'a.png', exact: true }).locator('..');
      await thumb.hover();
      await thumb.getByRole('button').click();
      if (first === 'upload') {
        await response('upload', 200);
        await expect(page.getByRole('img', { name: 'c.png', exact: true })).toBeVisible();
        await response('a');
      } else {
        await response('a');
        await expect(page.getByRole('img', { name: 'a.png', exact: true })).toHaveCount(0);
        await response('upload', 200);
      }
      await expect(page.getByRole('img', { name: 'a.png', exact: true })).toHaveCount(0);
      await expect(page.getByRole('img', { name: 'b.png', exact: true })).toBeVisible();
      await expect(page.getByRole('img', { name: 'c.png', exact: true })).toBeVisible();
    });
  }

  test('failed deletion retains its image while another succeeds, and retry removes it', async ({ page }) => {
    for (const id of ['a', 'b']) {
      const thumb = page.getByRole('img', { name: `${id}.png`, exact: true }).locator('..');
      await thumb.hover(); await thumb.getByRole('button').click();
    }
    await response('a', 500); await response('b');
    await expect(page.getByText('controlled request failure', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'a.png', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'b.png', exact: true })).toHaveCount(0);
    const thumb = page.getByRole('img', { name: 'a.png', exact: true }).locator('..');
    await thumb.hover(); await thumb.getByRole('button').click(); await response('a');
    await expect(page.getByRole('img', { name: 'a.png', exact: true })).toHaveCount(0);
  });

  test('failed upload does not undo deletion and can be retried', async ({ page }) => {
    const file = { name: 'c.png', mimeType: 'image/png', buffer: Buffer.from('test') };
    await page.locator('input[type=file]').setInputFiles(file);
    const thumb = page.getByRole('img', { name: 'a.png', exact: true }).locator('..');
    await thumb.hover(); await thumb.getByRole('button').click();
    await response('a'); await response('upload', 500);
    await expect(page.getByText('controlled request failure', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'a.png', exact: true })).toHaveCount(0);
    await expect(page.getByRole('img', { name: 'b.png', exact: true })).toBeVisible();
    await page.locator('input[type=file]').setInputFiles(file); await response('upload', 200);
    await expect(page.getByRole('img', { name: 'c.png', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'a.png', exact: true })).toHaveCount(0);
  });
});
