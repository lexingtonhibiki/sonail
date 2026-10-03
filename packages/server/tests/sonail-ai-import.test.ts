import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Workflow, git } from '../src/services/workflow.js';
import { WorkflowStore } from '../src/services/workflow-store.js';
import { AiAccessStore } from '../src/services/ai-access.js';
import { workflowRouter } from '../src/routes/workflow.js';
import { aiIntegrationRouter } from '../src/routes/ai-integration.js';
import { authMiddleware } from '../src/middleware/auth.js';
import type { TaskRepository } from '../src/repositories/types.js';
import type { ProjectRepository } from '../src/repositories/project-types.js';
import type { AgentManager } from '../src/services/agent-manager.js';
import type { Task } from '../src/types.js';

const proposal = { originalIdea: 'Please make a clear introduction I can understand.', productSpec: 'A readable introduction', technicalSpec: 'Only README.md may be written; no upstream changes.', tasks: [{ title: '01 introduction', description: 'Write README.md in the task worktree.', criteria: [{ id: 'A1', text: 'README contains the introduction', kind: 'objective' }, { id: 'A2', text: 'User finds it clear', kind: 'human' }], dependsOn: [], complexity: 'small' }] };

async function fixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sonail-ai-import-'));
  const repoPath = path.join(temporary, 'repo'); fs.mkdirSync(repoPath);
  git(repoPath, ['init', '-b', 'main']); git(repoPath, ['config', 'user.name', 'Sonail Test']); git(repoPath, ['config', 'user.email', 'test@localhost']);
  fs.writeFileSync(path.join(repoPath, 'README.md'), 'Initial\n'); git(repoPath, ['add', '.']); git(repoPath, ['commit', '-m', 'Initial']);
  const tasks = new Map<string, Task>();
  const repository = { getAll: async (_archived: boolean, id: string) => [...tasks.values()].filter(task => task.projectId === id), getById: async (id: string) => tasks.get(id), create: async (task: Task) => { tasks.set(task.id, task); return task; }, delete: async (id: string) => tasks.delete(id) } as unknown as TaskRepository;
  const project = { id: 'p', name: 'Scope test', repoPath, defaultBaseBranch: 'main' };
  const projects = { getById: async (id: string) => id === 'p' ? project : undefined } as unknown as ProjectRepository;
  const engine = new Workflow(new WorkflowStore(path.join(temporary, 'workflow.json')), repository, projects, { setRedactor() {} } as unknown as AgentManager);
  const app = express(); app.use(express.json()); app.use('/api', authMiddleware); app.use('/api/workflow', workflowRouter(engine)); app.use('/api/ai', aiIntegrationRouter(engine));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number }; const url = `http://127.0.0.1:${address.port}`;
  const request = (route: string, method = 'GET', body?: unknown, token?: string) => fetch(url + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const close = async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep + 'sonail-ai-import-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  };
  return { engine, temporary, project, tasks, url, request, close };
}

test('project credentials scope real HTTP/MCP drafts; user confirmation alone creates cards', async () => {
  const f = await fixture(); const client = new Client({ name: 'sonail-test', version: '1' });
  try {
    const issue = async (permission: string) => (await f.request('/api/workflow/ai-access/p', 'POST', { name: permission, permission })).json();
    const read = await issue('read'); const write = await issue('preview');
    assert.equal((await f.request('/api/workflow/quota', 'GET', undefined, read.token)).status, 403);
    const saved = fs.readFileSync(path.join(f.temporary, 'sonail-ai-access.json'), 'utf8');
    assert.ok(!saved.includes(read.token) && !saved.includes(write.token));
    assert.equal(new AiAccessStore(path.join(f.temporary, 'sonail-ai-access.json')).authenticate(write.token)?.projectId, 'p');
    const context = await (await f.request('/api/ai/context', 'GET', undefined, read.token)).json();
    assert.equal(context.toolsDirectory, f.engine.store.workbenchSettings().toolsDirectory);
    assert.equal(context.projectId, 'p'); assert.equal(context.repoPath, fs.realpathSync(f.project.repoPath));
    assert.ok(!('roles' in context) && !('events' in context));
    const input = { proposal, fingerprint: context.fingerprint, expectedRevision: context.revision };
    assert.equal((await f.request('/api/ai/preview', 'POST', input, read.token)).status, 403);
    assert.equal((await f.request('/api/workflow/p/publish', 'POST', {}, write.token)).status, 403);
    assert.equal((await fetch(f.url + '/api/workflow/p/publish', { method: 'POST', headers: { Authorization: `bearer ${write.token}`, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await f.request('/api/workflow/ai-access/p', 'POST', { name: 'escalate', permission: 'preview' }, write.token)).status, 403);
    assert.equal((await f.request('/api/ai/preview', 'POST', { ...input, fingerprint: 'wrong-project' }, write.token)).status, 409);
    assert.equal((await f.request('/api/ai/preview', 'POST', { ...input, expectedRevision: context.revision + 1 }, write.token)).status, 409);
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../../../scripts/sonail-mcp.mjs', import.meta.url))], env: { SONAIL_URL: f.url, SONAIL_AI_TOKEN: write.token } }));
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['get_project_context', 'preview_task_plan']);
    assert.ok(!(await client.callTool({ name: 'get_project_context', arguments: {} })).isError);
    const result = await client.callTool({ name: 'preview_task_plan', arguments: input }); assert.ok(!result.isError);
    const staged = JSON.parse((result.content as { text: string }[])[0].text);
    const forReviewer = await (await f.request('/api/ai/context', 'GET', undefined, read.token)).json();
    assert.equal(forReviewer.pendingPlan.proposal.originalIdea, proposal.originalIdea);
    assert.equal(f.tasks.size, 0); assert.equal(f.engine.store.get('p').proposal?.tasks.length, 1); assert.equal(f.engine.store.get('p').idea, '');
    const again = await (await f.request('/api/ai/preview', 'POST', input, write.token)).json();
    assert.equal(again.preview.id, staged.preview.id); assert.equal(again.preview.idempotent, true);
    const confirmed = await f.request('/api/workflow/p/publish', 'POST', {}); assert.equal(confirmed.status, 200);
    assert.equal(f.tasks.size, 1); assert.equal(f.engine.store.get('p').idea, proposal.originalIdea); assert.equal(Object.values(f.engine.store.get('p').tasks)[0].phase, 'ready');
    assert.ok(!Object.values(f.engine.store.get('p').tasks)[0].acceptedAt);
    await f.request(`/api/workflow/ai-access/p/${write.credential.id}`, 'DELETE');
    assert.equal((await f.request('/api/ai/context', 'GET', undefined, write.token)).status, 401);
    assert.ok((await client.callTool({ name: 'get_project_context', arguments: {} })).isError);
  } finally { await client.close(); await f.close(); }
});

test('a changed repository baseline blocks draft confirmation; discarding restores planning', async () => {
  const f = await fixture();
  try {
    const context = await f.engine.importContext('p');
    await f.engine.previewImport('p', proposal as never, context.revision, context.fingerprint, 'fixture');
    fs.writeFileSync(path.join(f.project.repoPath, 'README.md'), 'Changed\n'); git(f.project.repoPath, ['add', '.']); git(f.project.repoPath, ['commit', '-m', 'Changed baseline']);
    assert.equal((await f.request('/api/workflow/p/publish', 'POST', {})).status, 409); assert.equal(f.tasks.size, 0);
    assert.equal((await f.request('/api/workflow/p/discard-proposal', 'POST', {})).status, 200);
    assert.ok(!f.engine.store.get('p').proposal && !f.engine.store.get('p').importPreview);
    const newer = await f.engine.importContext('p');
    assert.equal(newer.fingerprint, context.fingerprint);
    await f.engine.previewImport('p', proposal as never, newer.revision, newer.fingerprint, 'fixture');
    assert.equal((await f.request('/api/workflow/p/publish', 'POST', {})).status, 200);
  } finally { await f.close(); }
});
