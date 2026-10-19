import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { AgentManager } from '../src/services/agent-manager.js';
import type { Task } from '../src/types.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

function fixture(destroyError = false) {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE task_status (id TEXT PRIMARY KEY, status TEXT); INSERT INTO task_status VALUES ('status-order', 'planning')");
  const manager = new AgentManager();
  let executions = 0;
  let destroyed = 0;
  const session = { execute: async () => { executions++; return { status: 'complete' }; }, abort: async () => {}, destroy: async () => { destroyed++; if (destroyError) throw new Error('Cleanup unavailable'); } };
  const internals = manager as unknown as { providers: Map<string, unknown>; availableAgents: unknown[] };
  internals.providers.set('opencode', { displayName: 'Offline test provider', createSession: async () => session });
  internals.availableAgents = [{ name: 'opencode', available: true }];
  const task: Task = { id: 'status-order', projectId: 'p', title: 'Offline task', description: '', priority: 'medium', columnId: 'in-progress', agentStatus: 'planning', agentType: 'opencode', createdAt: 1 };
  const save = (status: string) => { db.prepare('UPDATE task_status SET status = ? WHERE id = ?').run(status, task.id); };
  const status = () => (db.prepare('SELECT status FROM task_status WHERE id = ?').get(task.id) as { status: string }).status;
  return { db, manager, task, save, status, executions: () => executions, destroyed: () => destroyed };
}

test('delayed executing persistence cannot overwrite a completed task', { timeout: 5000 }, async () => {
  const f = fixture(); const entered = deferred(); const release = deferred(); const completed = deferred();
  try {
    f.manager.startAgent(f.task, async status => {
      if (status === 'executing') { entered.resolve(); await release.promise; }
      f.save(status);
      if (status === 'complete' || status === 'failed') completed.resolve();
    });
    await entered.promise;
    // Drain a fast provider's completion without relying on a wall-clock delay.
    await setImmediate();
    release.resolve();
    await completed.promise; await setImmediate();
    assert.equal(f.status(), 'complete');
    assert.equal(f.executions(), 1);
    assert.equal(f.manager.isRunning(f.task.id), false);
  } finally { release.resolve(); f.db.close(); }
});

test('cancellation while executing persistence is pending does not launch the provider', { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); const entered = deferred(); const release = deferred();
  try {
    f.manager.startAgent(f.task, async status => {
      if (status === 'executing') { entered.resolve(); await release.promise; }
      f.save(status);
    });
    await entered.promise;
    await f.manager.stopAgent(f.task.id);
    release.resolve(); await setImmediate();
    assert.equal(f.executions(), 0);
    assert.equal(f.manager.isRunning(f.task.id), false);
  } finally { release.resolve(); f.db.close(); }
});

test('executing persistence failure fails the task without launching the provider', { timeout: 5000 }, async () => {
  const f = fixture(); const completed = deferred();
  try {
    f.manager.startAgent(f.task, async status => {
      if (status === 'executing') throw new Error('Status persistence unavailable');
      f.save(status); completed.resolve();
    });
    await completed.promise;
    assert.equal(f.status(), 'failed');
    assert.equal(f.destroyed(), 1);
    assert.equal(f.executions(), 0);
    assert.equal(f.manager.isRunning(f.task.id), false);
    assert.ok((await f.manager.getEvents(f.task.id)).some(e => e.content.includes('Status persistence unavailable')));
  } finally { f.db.close(); }
});

test('cancelled status failure leaves session cleanup to cancellation', { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); const entered = deferred(); const release = deferred();
  try {
    f.manager.startAgent(f.task, async status => {
      if (status === 'executing') { entered.resolve(); await release.promise; throw new Error('Cancelled storage write'); }
      f.save(status);
    });
    await entered.promise;
    await f.manager.stopAgent(f.task.id);
    release.resolve(); await setImmediate();
    assert.equal(f.executions(), 0);
    assert.equal(f.destroyed(), 1);
    assert.equal(f.manager.isRunning(f.task.id), false);
  } finally { release.resolve(); f.db.close(); }
});


test('cleanup failure preserves the original status persistence error', { timeout: 5000 }, async () => {
  const f = fixture(true); const completed = deferred();
  try {
    f.manager.startAgent(f.task, async status => {
      if (status === 'executing') throw new Error('Original persistence failure');
      f.save(status); completed.resolve();
    });
    await completed.promise;
    assert.equal(f.status(), 'failed');
    assert.equal(f.executions(), 0);
    assert.equal(f.destroyed(), 1);
    assert.equal(f.manager.isRunning(f.task.id), false);
    const events = await f.manager.getEvents(f.task.id);
    assert.ok(events.some(e => e.content.includes('Original persistence failure')));
    assert.equal(events.some(e => e.content.includes('Cleanup unavailable')), false);
  } finally { f.db.close(); }
});

test('a cancelled callback rejection cannot terminate its replacement run', { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); const oldEntered = deferred(); const oldRelease = deferred();
  const newEntered = deferred(); const newRelease = deferred(); const completed = deferred();
  const destroyed: number[] = []; const executed: number[] = []; let sessions = 0;
  const internals = f.manager as unknown as { providers: Map<string, unknown> };
  internals.providers.set('opencode', { createSession: async () => {
    const id = ++sessions;
    return { execute: async () => { executed.push(id); return { status: 'complete' }; }, abort: async () => {}, destroy: async () => { destroyed.push(id); } };
  } });
  try {
    f.manager.startAgent(f.task, async status => {
      if (status === 'executing') { oldEntered.resolve(); await oldRelease.promise; throw new Error('Old write failed'); }
      f.save(status);
    });
    await oldEntered.promise; await f.manager.stopAgent(f.task.id);
    f.manager.startAgent(f.task, async status => {
      if (status === 'executing') { newEntered.resolve(); await newRelease.promise; }
      f.save(status); if (status === 'complete') completed.resolve();
    });
    await newEntered.promise; oldRelease.resolve(); await setImmediate();
    assert.deepEqual(destroyed, [1]);
    assert.equal(f.manager.isRunning(f.task.id), true);
    newRelease.resolve(); await completed.promise; await setImmediate();
    assert.deepEqual(executed, [2]); assert.deepEqual(destroyed, [1, 2]);
    assert.equal(f.status(), 'complete');
  } finally { oldRelease.resolve(); newRelease.resolve(); f.db.close(); }
});
