import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import express from 'express';
import { createProjectsRouter } from '../src/routes/projects.js';

function router() {
  return createProjectsRouter({} as never, {} as never, {} as never, {} as never);
}

test('another HTTP request completes while a native picker is still open', { skip: process.platform !== 'linux' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sonail-picker-'));
  const previousPath = process.env.PATH;
  const ready = join(dir, 'ready');
  const done = join(dir, 'done');
  // A bounded stand-in for a user keeping the native picker open, then cancelling.
  writeFileSync(join(dir, 'zenity'), `#!/bin/sh\ntouch '${ready}'\nsleep 2\ntouch '${done}'\nexit 1\n`, { mode: 0o700 });
  process.env.PATH = `${dir}:${previousPath}`;
  const app = express();
  app.use(express.json());
  app.use('/api/projects', router());
  app.get('/health', (_req, res) => res.json({ ok: true }));
  const server = createServer(app);
  let picker: Promise<Response> | undefined;
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    picker = fetch(`${base}/api/projects/select-directory`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    const deadline = Date.now() + 5000;
    while (!existsSync(ready) && Date.now() < deadline) await delay(10);
    assert.ok(existsSync(ready), 'the picker process started');
    const health = await fetch(`${base}/health`);
    assert.deepEqual(await health.json(), { ok: true });
    assert.equal(existsSync(done), false, 'health must respond before the picker closes');
    assert.deepEqual(await (await picker).json(), { repoPath: null });
  } finally {
    if (picker) await picker;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    process.env.PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

type Result = { code?: string | number; stdout?: string; stderr?: string };
async function mockedPicker(platform: NodeJS.Platform, results: Result[], initialPath = '') {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const calls: Array<{ command: string; args: string[]; options: { env?: NodeJS.ProcessEnv } }> = [];
  const original = childProcess.execFile;
  childProcess.execFile = ((command: string, args: string[], options: { env?: NodeJS.ProcessEnv }, callback: Function) => {
    calls.push({ command, args, options });
    const result = results.shift();
    assert.ok(result, 'unexpected picker invocation');
    queueMicrotask(() => callback(result.code === undefined ? null : Object.assign(new Error('picker error'), { code: result.code }), result.stdout ?? '', result.stderr ?? ''));
    return {};
  }) as typeof childProcess.execFile;
  syncBuiltinESMExports();
  Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
  try {
    const layer = router().stack.find((item: any) => item.route?.path === '/select-directory');
    let status = 200;
    const body = await new Promise<any>((resolve, reject) => {
      const res = { status(value: number) { status = value; return this; }, json: resolve };
      layer.route.stack[0].handle({ body: { initialPath } }, res, reject);
    });
    return { status, body, calls };
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
    childProcess.execFile = original;
    syncBuiltinESMExports();
  }
}

for (const platform of ['win32', 'darwin', 'linux'] as const) {
  test(`${platform} picker preserves a selected path`, async () => {
    const { status, body, calls } = await mockedPicker(platform, [{ stdout: '  /chosen/目录 with spaces\n' }], '/initial path');
    assert.equal(status, 200);
    assert.deepEqual(body, { repoPath: '/chosen/目录 with spaces' });
    assert.equal(calls[0].command, { win32: 'powershell.exe', darwin: 'osascript', linux: 'zenity' }[platform]);
    if (platform === 'win32') assert.equal(calls[0].options.env?.AI_AGENT_BOARD_INITIAL_DIR, '/initial path');
  });
  test(`${platform} picker preserves cancellation`, async () => {
    const result = await mockedPicker(platform, [{ code: platform === 'win32' ? 2 : 1, stderr: platform === 'darwin' ? 'User canceled. (-128)' : '' }]);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { repoPath: null });
    assert.equal(result.calls.length, 1);
  });
  test(`${platform} picker preserves errors`, async () => {
    const result = await mockedPicker(platform, [{ code: 3, stderr: 'native picker failure' }]);
    assert.equal(result.status, 501);
    assert.deepEqual(result.body, { error: 'Folder picker failed: native picker failure' });
  });
}

test('Linux falls back to kdialog only when zenity is missing', async () => {
  const result = await mockedPicker('linux', [{ code: 'ENOENT' }, { stdout: '/chosen\n' }], '/initial path');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { repoPath: '/chosen' });
  assert.deepEqual(result.calls.map(call => call.command), ['zenity', 'kdialog']);
  assert.deepEqual(result.calls[1].args, ['--getexistingdirectory', '/initial path']);
});

test('Linux reports when neither picker is installed', async () => {
  const result = await mockedPicker('linux', [{ code: 'ENOENT' }, { code: 'ENOENT' }]);
  assert.equal(result.status, 501);
  assert.match(result.body.error, /Install zenity or kdialog, or type the path manually/);
});

test('Linux does not fall back after a permission error', async () => {
  const result = await mockedPicker('linux', [{ code: 'EACCES' }]);
  assert.equal(result.status, 501);
  assert.equal(result.calls.length, 1);
});

for (const platform of ['win32', 'darwin', 'linux'] as const) {
  test(`${platform} empty selection remains null`, async () => {
    const result = await mockedPicker(platform, [{ stdout: ' \n' }]);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { repoPath: null });
  });
}

for (const platform of ['win32', 'darwin'] as const) {
  test(`${platform} missing picker remains an error`, async () => {
    const result = await mockedPicker(platform, [{ code: 'ENOENT' }]);
    assert.equal(result.status, 501);
    assert.equal(result.calls.length, 1);
    assert.match(result.body.error, /^Folder picker failed:/);
  });
}

test('Linux kdialog retains its default initial path', async () => {
  const result = await mockedPicker('linux', [{ code: 'ENOENT' }, { code: 1 }]);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { repoPath: null });
  assert.deepEqual(result.calls[1].args, ['--getexistingdirectory', '.']);
});
