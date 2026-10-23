import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import Database from 'better-sqlite3';
import { migrateSqliteDatabase } from '../src/db.js';
import { SqliteTaskRepository } from '../src/repositories/sqlite.js';
import { SqliteTaskGroupRepository } from '../src/repositories/sqlite-groups.js';
import { SqliteProjectRepository } from '../src/repositories/sqlite-projects.js';
import { createGroupsRouter } from '../src/routes/groups.js';
import type { AgentManager } from '../src/services/agent-manager.js';
import type { Task, TaskGroup } from '../src/types.js';

async function withGroup(archived: boolean, status: Task['agentStatus'], run: (url: string, groups: SqliteTaskGroupRepository, tasks: SqliteTaskRepository) => Promise<void>) {
  const db = new Database(':memory:');
  migrateSqliteDatabase(db);
  const groups = new SqliteTaskGroupRepository(db);
  const tasks = new SqliteTaskRepository(db);
  const projects = new SqliteProjectRepository(db);
  const group: TaskGroup = { id: 'group-1', projectId: 'default', title: 'Group', priority: 'medium', columnId: 'in-progress', maxConcurrency: 1, createdAt: 1, startedAt: 2, completedAt: 3, archived };
  await groups.create(group, [{ id: 'child-1', title: 'Child', description: 'preserve me' }]);
  await tasks.update('child-1', { agentStatus: status, archived, startedAt: 2, completedAt: 3 });
  // No agent invocation is needed for an unarchive request.
  const manager = {} as AgentManager;
  const app = express();
  app.use(express.json());
  app.use('/api/groups', createGroupsRouter(groups, tasks, manager, projects));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`, groups, tasks); }
  finally { await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); db.close(); }
}

for (const status of ['idle', 'executing', 'complete', 'failed'] as const) {
  test(`unarchive rejects a non-archived group without changing ${status} children`, async () => {
    await withGroup(false, status, async (url, groups, tasks) => {
      const beforeGroup = await groups.getById('group-1');
      const beforeTask = await tasks.getById('child-1');
      const response = await fetch(`${url}/api/groups/group-1/unarchive`, { method: 'PATCH' });
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: 'group is not archived' });
      assert.deepEqual(await groups.getById('group-1'), beforeGroup);
      assert.deepEqual(await tasks.getById('child-1'), beforeTask);
    });
  });
}

test('unarchive restores an archived group once and rejects stale repeated requests', async () => {
  await withGroup(true, 'complete', async (url, groups, tasks) => {
    const first = await fetch(`${url}/api/groups/group-1/unarchive`, { method: 'PATCH' });
    assert.equal(first.status, 200);
    const group = await groups.getById('group-1');
    const child = await tasks.getById('child-1');
    assert.equal(group?.archived, false);
    assert.equal(group?.columnId, 'backlog');
    assert.equal(group?.startedAt, undefined);
    assert.equal(group?.completedAt, undefined);
    assert.equal(child?.archived, false);
    assert.equal(child?.agentStatus, 'idle');
    assert.equal(child?.columnId, 'backlog');
    // A later retry must not overwrite progress made since the restore.
    await tasks.update('child-1', { agentStatus: 'executing', columnId: 'in-progress' });
    const beforeTask = await tasks.getById('child-1');
    const retry = await fetch(`${url}/api/groups/group-1/unarchive`, { method: 'PATCH' });
    assert.equal(retry.status, 400);
    assert.deepEqual(await tasks.getById('child-1'), beforeTask);
  });
});

test('unarchive keeps the missing-group response', async () => {
  await withGroup(false, 'idle', async (url) => {
    const response = await fetch(`${url}/api/groups/missing/unarchive`, { method: 'PATCH' });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'group not found' });
  });
});
