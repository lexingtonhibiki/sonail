import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import Database from 'better-sqlite3';
import { SqliteAttachmentStore } from '../src/repositories/sqlite-attachments.js';
import type { TaskRepository } from '../src/repositories/types.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sonail-upload-test-'));
const originalCwd = process.cwd();
process.chdir(root);
const { createAttachmentsRouter, UPLOADS_DIR } = await import('../src/routes/attachments.js');
process.chdir(originalCwd);

function database() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE task_attachments (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, filename TEXT NOT NULL,
    original_name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL
  )`);
  return db;
}

async function upload(store: SqliteAttachmentStore, taskId: string, names: string[]) {
  const router = createAttachmentsRouter({ getById: async () => ({ id: taskId }) } as unknown as TaskRepository, store);
  const handler = (router as any).stack.find((layer: any) => layer.route?.methods.post).route.stack[0].handle;
  const boundary = 'sonail-test-boundary';
  const body = Buffer.from(names.map(name => `--${boundary}\r\nContent-Disposition: form-data; name="images"; filename="${name}"\r\nContent-Type: image/png\r\n\r\npng-fixture\r\n`).join('') + `--${boundary}--\r\n`);
  const req = Object.assign(new PassThrough(), {
    params: { id: taskId }, headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) }, method: 'POST',
  });
  const result = new Promise<{ status: number; body: any }>((resolve, reject) => {
    const res = { headersSent: false, statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(value: any) { this.headersSent = true; resolve({ status: this.statusCode, body: value }); return this; } };
    handler(req, res, reject);
  });
  req.end(body);
  return result;
}

test('failed second metadata insert leaves no broken attachments or quota and allows retry', async () => {
  const db = database();
  const store = new SqliteAttachmentStore(db);
  const taskId = 'partial-failure';
  const dir = path.join(UPLOADS_DIR, taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'existing.png'), 'existing');
  await store.insert({ id: 'existing', taskId, filename: 'existing.png', originalName: 'existing.png', mimeType: 'image/png', size: 8, createdAt: 1 });
  db.exec(`CREATE TRIGGER fail_second_upload BEFORE INSERT ON task_attachments WHEN NEW.original_name = 'fail.png' BEGIN SELECT RAISE(ABORT, 'injected metadata failure'); END`);
  try {
    const response = await upload(store, taskId, ['first.png', 'fail.png']);
    assert.equal(response.status, 500);
    // Allow the old implementation's fire-and-forget unlink callbacks to finish.
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual((await store.getByTaskId(taskId)).map(a => a.id), ['existing']);
    assert.equal(await store.countByTaskId(taskId), 1);
    assert.deepEqual(fs.readdirSync(dir), ['existing.png']);
    assert.equal(fs.readFileSync(path.join(dir, 'existing.png'), 'utf8'), 'existing');
    db.exec('DROP TRIGGER fail_second_upload');
    const retry = await upload(store, taskId, ['first.png', 'fail.png']);
    assert.equal(retry.status, 201);
    assert.equal(retry.body.length, 2);
    assert.equal(await store.countByTaskId(taskId), 3);
    for (const attachment of await store.getByTaskId(taskId)) assert.ok(fs.existsSync(path.join(dir, attachment.filename)));
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('failed first metadata insert removes the batch without touching existing data', async () => {
  const db = database();
  const store = new SqliteAttachmentStore(db);
  const taskId = 'first-failure';
  db.exec(`CREATE TRIGGER reject_upload BEFORE INSERT ON task_attachments BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  try {
    assert.equal((await upload(store, taskId, ['one.png', 'two.png'])).status, 500);
    assert.equal(await store.countByTaskId(taskId), 0);
    assert.deepEqual(fs.readdirSync(path.join(UPLOADS_DIR, taskId)), []);
  } finally { db.close(); fs.rmSync(path.join(UPLOADS_DIR, taskId), { recursive: true, force: true }); }
});

test('SQLite batch insert rolls back only the failed batch and accepts empty batches', async () => {
  const db = database();
  const store = new SqliteAttachmentStore(db);
  const a = { id: 'existing', taskId: 'task', filename: 'old.png', originalName: 'old.png', mimeType: 'image/png', size: 3, createdAt: 1 };
  try {
    await store.insert(a);
    await store.insertMany([]);
    await assert.rejects(store.insertMany([{ ...a, id: 'new' }, a]), /UNIQUE/);
    assert.deepEqual(await store.getByTaskId('task'), [a]);
  } finally { db.close(); }
});

test('PostgreSQL sends one parameterized atomic statement and propagates rejection', async () => {
  const { PostgresAttachmentStore } = await import('../src/repositories/postgres-attachments.js');
  const calls: { sql: string; values: unknown[] }[] = [];
  const failure = new Error('injected database failure');
  let reject = false;
  const store = new PostgresAttachmentStore({ query: async (sql: string, values: unknown[]) => {
    calls.push({ sql, values });
    if (reject) throw failure;
    return { rows: [], rowCount: 2 };
  } } as never);
  const first = { id: 'a', taskId: 'task', filename: 'a.png', originalName: "quote' name.png", mimeType: 'image/png', size: 3, createdAt: 1 };
  const second = { ...first, id: 'b', filename: 'b.png' };
  await store.insertMany([]);
  assert.equal(calls.length, 0);
  await store.insertMany([first, second]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7\), \(\$8, \$9, \$10, \$11, \$12, \$13, \$14\)/);
  assert.ok(!calls[0].sql.includes(first.originalName));
  assert.deepEqual(calls[0].values, [first, second].flatMap(a => [a.id, a.taskId, a.filename, a.originalName, a.mimeType, a.size, a.createdAt]));
  reject = true;
  await assert.rejects(store.insertMany([first, second]), error => error === failure);
  assert.equal(calls.length, 2);
});
