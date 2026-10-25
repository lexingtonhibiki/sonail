import { test, expect, type Page, type Route } from '@playwright/test';
import { API, createTaskViaAPI, waitForBoard } from './helpers';

const image = (id: string, taskId: string) => ({
  id, taskId, originalName: `${id}.png`, mimeType: 'image/png', size: 1, createdAt: 1,
});

// Real dialog interactions with delayed attachment responses, not a persistence test.
test.describe('attachment loads belong to the current dialog session', () => {
  let tasks: { id: string; title: string }[];
  let pending: { routes: Route[]; response?: { status?: number; json: unknown } }[];
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
    await page.route('**/api/tasks/*/attachments', async route => {
      if (route.request().method() !== 'GET') {
        uploads.push(route);
        return;
      }
      const session = Number(route.request().headers()['x-test-attachment-session']);
      const load = pending[session];
      if (!load) throw new Error(`Unidentified attachment load session: ${session}`);
      load.routes.push(route);
      if (load.response) await route.fulfill(load.response);
    });
    await page.route('**/api/attachments/*', route => { deletions.push(route); });
    // Stamp at fetch issuance, not route arrival: a delayed old StrictMode
    // request must never be attributed to a newer dialog session.
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const request = new Request(input, init);
        if (request.method === 'GET' && /^\/api\/tasks\/[^/]+\/attachments$/.test(new URL(request.url).pathname)) {
          const headers = new Headers(request.headers);
          headers.set('x-test-attachment-session', String((window as Window & { attachmentTestSession?: number }).attachmentTestSession));
          return originalFetch(new Request(request, { headers }));
        }
        return originalFetch(request).then(response => {
          if (request.method === 'DELETE' && response.status === 204) {
            const state = window as Window & { attachmentTestCompletedDeletes?: string[] };
            (state.attachmentTestCompletedDeletes ??= []).push(request.url);
          }
          return response;
        });
      };
    });
    await page.goto('/projects/default');
    await waitForBoard(page);
  });

  test.afterEach(async ({ page, request }) => {
    // A failed test must not release a held mutation to the real server when
    // removing routes. Completed routes can already be handled or closed.
    const held = [...pending.flatMap(load => load.routes), ...uploads, ...deletions];
    await Promise.all(held.map(route => route.abort().catch(() => {})));
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    for (const task of tasks) await request.delete(`${API}/api/tasks/${task.id}`);
  });

  async function open(page: Page, index: number) {
    const load = { routes: [] as Route[] };
    pending.push(load);
    await page.evaluate(session => {
      (window as Window & { attachmentTestSession?: number }).attachmentTestSession = session;
    }, pending.length - 1);
    const card = page.locator('.group').filter({ has: page.getByRole('heading', { name: tasks[index].title }) });
    await expect(card).toHaveCount(1);
    await card.hover();
    await card.getByRole('button', { name: 'Edit task' }).click();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    // This suite runs Vite development mode with StrictMode. Register both
    // setups before switching, so we release the active old GET as well.
    await expect.poll(() => load.routes.length).toBeGreaterThanOrEqual(2);
  }

  async function respond(page: Page, index: number, taskIndex: number, id: string, fail = false) {
    const load = pending[index];
    await expect.poll(() => load.routes.length).toBeGreaterThan(0);
    // Vite's development StrictMode can set up the load effect twice. Fulfill
    // the whole dialog session, including any request that arrives afterward,
    // rather than assuming one HTTP request per opening.
    load.response = fail
      ? { status: 500, json: { error: 'controlled attachment load failure' } }
      : { json: [image(id, tasks[taskIndex].id)] };
    const routes = [...load.routes];
    const completed = routes.map(route => page.waitForEvent('requestfinished', request => request === route.request()));
    await Promise.all(routes.map(route => route.fulfill(load.response!)));
    await Promise.all(completed);
    // Let the fulfilled fetch and React's resulting render run before absence checks.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }

  for (const sameTask of [false, true]) {
    for (const fail of [false, true]) {
      test(`ignores old ${fail ? 'failure' : 'success'} after reopening ${sameTask ? 'the same task' : 'another task'}`, async ({ page }) => {
        await open(page, 0);
        await expect.poll(() => pending[0].routes.length).toBeGreaterThan(0);
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
    if (json) {
      const completed = page.waitForEvent('requestfinished', request => request === route.request());
      await route.fulfill({ json });
      await completed;
    } else {
      await route.fulfill({ status: 204 });
      // Chromium may report an unread 204 body as ERR_ABORTED rather than emit
      // requestfinished. Require the browser fetch promise to resolve with 204.
      await page.waitForFunction(url =>
        (window as Window & { attachmentTestCompletedDeletes?: string[] }).attachmentTestCompletedDeletes?.includes(url),
      route.request().url());
    }
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }

  const file = { name: 'new.png', mimeType: 'image/png', buffer: Buffer.from('test') };

  for (const fail of [false, true]) {
    test(`initial load ${fail ? 'failure' : 'success'} enables uploads only after it finishes`, async ({ page }) => {
      await open(page, 0);
      await expect(page.getByRole('dialog').getByRole('status')).toHaveText('Loading images…');
      await expect(page.locator('input[type=file]')).toHaveCount(0);
      await respond(page, 0, 0, 'existing', fail);
      await expect(page.getByRole('dialog').getByRole('status')).toHaveCount(0);
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
