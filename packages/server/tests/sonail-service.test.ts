import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { LocalService, isLocalServicePeer } from '../src/services/local-service.js';
import express from 'express';
import { createServer } from 'node:http';
import { workflowRouter } from '../src/routes/workflow.js';
import type { ShortcutStatus } from '../../../shared/workbench.js';
const exec = promisify(execFile);
const off: ShortcutStatus = { enabled: false, conflict: false, desktopExists: false, startupPath: 'startup.lnk', desktopPath: 'desktop.lnk' };
test('native startup access allows real local TCP peers including IPv4 mapped IPv6', () => {
  for (const address of ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1']) assert.equal(isLocalServicePeer(address), true);
  for (const address of [undefined, '', '192.168.1.2', '10.0.0.1', '127.evil.example', '::ffff:192.168.1.2']) assert.equal(isLocalServicePeer(address), false);
});
test('actual HTTP service routes accept local status and fixed actions without generic project routing', async () => {
  let enabled = false; const actions: string[] = [];
  const service = new LocalService('C:/Test', 'win32', async action => { actions.push(action); if (action === 'EnableAutostart') enabled = true; return { ...off, enabled }; }, async () => true);
  const app = express(); app.use(express.json()); app.use('/api/workflow', workflowRouter({ store: { redact: (text: string) => text } } as never, service));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number }; const url = `http://127.0.0.1:${address.port}/api/workflow/service`;
  try {
    const response = await fetch(url); assert.equal(response.status, 200); assert.equal((await response.json()).shortcuts.enabled, false);
    const changed = await fetch(url + '/autostart', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    assert.equal(changed.status, 200); assert.equal((await changed.json()).shortcuts.enabled, true);
    const count = actions.length;
    const bad = await fetch(url + '/autostart', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, command: 'unapproved' }) }); assert.equal(bad.status, 409); assert.equal(actions.length, count);
    const launcher = await fetch(url + '/launcher'); assert.match(launcher.headers.get('content-disposition')!, /Start-Sonail.cmd/); assert.match(await launcher.text(), /EncodedCommand/);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('service startup reflects actual OS state, not an unrelated saved UI flag', async () => {
  const actions: string[] = []; let current = { ...off };
  const service = new LocalService('C:/Test', 'win32', async action => { actions.push(action); if (action === 'EnableAutostart') current.enabled = true; if (action === 'DisableAutostart') current.enabled = false; if (action === 'CreateDesktop') current.desktopExists = true; return { ...current }; }, async () => true);
  assert.equal((await service.status()).shortcuts?.enabled, false);
  assert.equal((await service.setAutostart({ enabled: true })).shortcuts?.enabled, true);
  assert.equal((await service.createDesktop()).shortcuts?.desktopExists, true);
  assert.equal((await service.setAutostart({ enabled: false })).shortcuts?.enabled, false);
  assert.ok(actions.includes('EnableAutostart') && actions.includes('DisableAutostart') && actions.includes('CreateDesktop'));
  await assert.rejects(service.setAutostart({ enabled: 'true' }), /Invalid autostart/);
  await assert.rejects(service.setAutostart({ enabled: true, path: 'another startup item' }), /Invalid autostart/);
});
test('service does not turn failed startup inspection into a disabled success state', async () => {
  const service = new LocalService('C:/Test', 'win32', async () => { throw new Error('OS access failed'); }, async () => false);
  const status = await service.status(); assert.equal(status.uiRunning, false); assert.equal(status.shortcuts, undefined); assert.match(status.error!, /OS access failed/);
  await assert.rejects(service.setAutostart({ enabled: true }), /OS access failed/);
});
test('launcher preserves spaces, unicode, percent signs and quotes without shell interpolation', () => {
  const service = new LocalService("C:/My Project/中文/%PATH%/O'Brien", 'win32');
  const launcher = service.launcher(); const encoded = launcher.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)![1];
  const command = Buffer.from(encoded, 'base64').toString('utf16le');
  assert.match(command, /O''Brien/); assert.ok(command.includes('%PATH%')); assert.ok(command.endsWith("launch-sonail.ps1' -Open"));
  assert.equal(launcher.includes('%PATH%'), false); assert.equal(launcher.includes('中文'), false);
});
test('unsupported platforms report capability honestly and reject OS changes', async () => {
  const service = new LocalService('/tmp/test', 'linux', undefined, async () => true);
  assert.equal((await service.status()).supported, false); await assert.rejects(service.createDesktop(), /Windows/); assert.throws(() => service.launcher(), /Windows/);
});
test('Windows shortcuts use real native metadata, toggle safely and preserve foreign files', { skip: process.platform !== 'win32' }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sonail-shortcut test-'));
  const startup = path.join(tmp, 'startup'); const desktop = path.join(tmp, 'desktop'); fs.mkdirSync(startup); fs.mkdirSync(desktop);
  const app = path.resolve('../..');
  const binary = path.join(process.env.WINDIR || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const run = async (action: string) => {
    const { stdout } = await exec(binary, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(app, 'scripts/manage-shortcuts.ps1'), '-Action', action, '-StartupDirectory', startup, '-DesktopDirectory', desktop], { windowsHide: true, encoding: 'utf8' });
    return JSON.parse(stdout.trim().replace(/^\uFEFF/, '')) as ShortcutStatus;
  };
  try {
    assert.equal((await run('Status')).enabled, false);
    const enabled = await run('EnableAutostart'); assert.equal(enabled.enabled, true);
    const original = fs.readFileSync(enabled.startupPath);
    assert.equal((await run('EnableAutostart')).enabled, true); assert.deepEqual(fs.readFileSync(enabled.startupPath), original);
    assert.equal((await run('CreateDesktop')).desktopExists, true);
    const disabled = await run('DisableAutostart'); assert.equal(disabled.enabled, false); assert.equal(disabled.desktopExists, true);
    fs.writeFileSync(enabled.startupPath, 'foreign shortcut - preserve');
    assert.equal((await run('Status')).conflict, true);
    await assert.rejects(run('DisableAutostart'), /not owned|identity mismatch/i);
    await assert.rejects(run('EnableAutostart'), /not owned/i);
    assert.equal(fs.readFileSync(enabled.startupPath, 'utf8'), 'foreign shortcut - preserve');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
