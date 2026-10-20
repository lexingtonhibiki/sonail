import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import { createAttachmentsRouter, UPLOADS_DIR } from '../src/routes/attachments.js';
import { SqliteAttachmentStore } from '../src/repositories/sqlite-attachments.js';
import type { TaskRepository } from '../src/repositories/types.js';

async function fixture(run: (f: {
  db: Database.Database; store: SqliteAttachmentStore; file: string; url: string; id: string;
}) => Promise<void>) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE task_attachments (
    id TEXT PRIMARY KEY, task_id TEXT, filename TEXT, original_name TEXT,
    mime_type TEXT, size INTEGER, created_at INTEGER
  )`);
  const store = new SqliteAttachmentStore(db);
  const id = randomUUID(); const taskId = `attachment-delete-test-${id}`;
  const directory = path.join(UPLOADS_DIR, taskId);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'image.png');
  fs.writeFileSync(file, 'original image bytes');
  await store.insert({ id, taskId, filename: 'image.png', originalName: 'image.png', mimeType: 'image/png', size: 20, createdAt: 1 });
  const app = express();
  app.use('/api', createAttachmentsRouter({} as TaskRepository, store));
  app.use((_error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ error: 'storage unavailable' }); });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  try { await run({ db, store, file, url: `http://127.0.0.1:${address.port}/api/attachments/${id}`, id }); }
  finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('failed metadata deletion preserves the image and allows a successful retry', async t => {
  // Observe real unlink completion so the regression cannot pass due to pending I/O.
  const unlink = fs.unlink; const removals: Promise<void>[] = [];
  t.mock.method(fs, 'unlink', (...args: Parameters<typeof fs.unlink>) => {
    removals.push(new Promise(resolve => unlink(args[0], error => { args[1](error); resolve(); })));
  });
  await fixture(async ({ db, store, file, url, id }) => {
    db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON task_attachments BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END");
    const failed = await fetch(url, { method: 'DELETE' });
    assert.equal(failed.status, 500); await failed.text();
    await Promise.all(removals);
    assert.ok(await store.getById(id), 'failed deletion must retain metadata');
    const image = await fetch(`${url}/file`);
    assert.equal(image.status, 200, 'a failed delete must not destroy the image');
    assert.equal(await image.text(), 'original image bytes');
    assert.equal(fs.readFileSync(file, 'utf8'), 'original image bytes');
    db.exec('DROP TRIGGER fail_delete');
    assert.equal((await fetch(url, { method: 'DELETE' })).status, 204);
    await Promise.all(removals);
    assert.equal(await store.getById(id), undefined);
    assert.equal(fs.existsSync(file), false);
    assert.equal((await fetch(`${url}/file`)).status, 404);
    assert.equal((await fetch(url, { method: 'DELETE' })).status, 404);
  });
});

test('deleting an attachment whose file is already missing still removes metadata', async () => {
  await fixture(async ({ store, file, url, id }) => {
    fs.unlinkSync(file);
    assert.equal((await fetch(url, { method: 'DELETE' })).status, 204);
    assert.equal(await store.getById(id), undefined);
  });
});

test('pending metadata deletion does not remove the file early', async () => {
  await fixture(async ({ store, file, url }) => {
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const remove = store.deleteById.bind(store);
    store.deleteById = async id => { entered(); await gate; return remove(id); };
    const request = fetch(url, { method: 'DELETE' });
    try {
      await started;
      const image = await fetch(`${url}/file`);
      assert.equal(image.status, 200);
      assert.equal(await image.text(), 'original image bytes');
      assert.equal(fs.readFileSync(file, 'utf8'), 'original image bytes');
    } finally { release(); await request; }
  });
});

test('concurrent deletes remain idempotent when both read the metadata first', async () => {
  await fixture(async ({ store, url, id }) => {
    let release!: () => void; let entered = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const remove = store.deleteById.bind(store);
    store.deleteById = async target => {
      if (++entered === 2) release();
      await gate;
      return remove(target);
    };
    const results = await Promise.all([fetch(url, { method: 'DELETE' }), fetch(url, { method: 'DELETE' })]);
    assert.deepEqual(results.map(result => result.status), [204, 204]);
    assert.equal(await store.getById(id), undefined);
    assert.equal((await fetch(`${url}/file`)).status, 404);
  });
});

test('file cleanup failure keeps the committed metadata deletion and existing response contract', async t => {
  t.mock.method(fs, 'unlink', (_file: fs.PathLike, callback: (error: NodeJS.ErrnoException | null) => void) => {
    callback(Object.assign(new Error('file is locked'), { code: 'EACCES' }));
  });
  await fixture(async ({ store, file, url, id }) => {
    assert.equal((await fetch(url, { method: 'DELETE' })).status, 204);
    assert.equal(await store.getById(id), undefined);
    assert.equal(fs.existsSync(file), true, 'best-effort cleanup can leave an orphaned file');
    assert.equal((await fetch(`${url}/file`)).status, 404);
  });
});
