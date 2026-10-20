import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaults, selectProfile, validateProfile, validateAssessment, validateProposal, mayAutoAccept, type Assessment, type TaskPolicy } from '../../../shared/workflow.js';
import { endpointConfig, effortFor, openCodeRequest } from '../src/services/harness.js';
import { WorkflowStore } from '../src/services/workflow-store.js';
import { Workflow, git, workspaceDigest } from '../src/services/workflow.js';
import { AgentManager } from '../src/services/agent-manager.js';
import type { TaskRepository } from '../src/repositories/types.js';
import type { ProjectRepository } from '../src/repositories/project-types.js';
import type { Task } from '../src/types.js';
import { filterProjects, type ProjectSummary } from '../../../shared/workbench.js';

const criteria = [{ id: 'A1', text: 'README contains original requirement', kind: 'objective' as const }];
const pass: Assessment = { verdict: 'pass', summary: 'Ready', criteria: [{ id: 'A1', status: 'pass', evidence: 'README.md inspected' }], findings: [], humanChecks: [], revision: '' };
const proposal = { productSpec: 'User can read the introduction', technicalSpec: 'Write README only', tasks: [{ title: '01 introduction', description: 'Update README', criteria, dependsOn: [], complexity: 'small' as const }] };

function fixture(providerOverride?: unknown) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sonail-workflow-test-'));
  const main = path.join(tmp, 'main'); fs.mkdirSync(main);
  git(main, ['init', '-b', 'main']); git(main, ['config', 'user.name', 'Sonail Test']); git(main, ['config', 'user.email', 'test@localhost']);
  fs.writeFileSync(path.join(main, 'README.md'), 'Initial\n'); git(main, ['add', '.']); git(main, ['commit', '-m', 'Initial']);
  const wt = path.join(tmp, 'task'); git(main, ['worktree', 'add', '-b', 'sonail/test', wt]);
  const store = new WorkflowStore(path.join(tmp, 'workflow.json'));
  const tasks = new Map<string, Task>([['t', { id: 't', projectId: 'p', title: 'Task', description: 'Update README', columnId: 'review', agentStatus: 'complete', createdAt: 1, priority: 'medium', repoPath: main, worktreePath: wt, branchName: 'sonail/test', baseBranch: 'main' }]]);
  const repo = { getAll: async (_archived: boolean, projectId: string) => [...tasks.values()].filter(t => t.projectId === projectId), getById: async (id: string) => tasks.get(id), create: async (t: Task) => { tasks.set(t.id, t); return t; }, delete: async (id: string) => tasks.delete(id), update: async (id: string, u: Partial<Task>) => { const t = tasks.get(id); if (!t) return undefined; Object.assign(t, u); return t; } } as unknown as TaskRepository;
  const project = { id: 'p', name: 'Project', repoPath: main, defaultBaseBranch: 'main', isDefault: false, createdAt: 1, updatedAt: 1 };
  const projects = { getAllWithCounts: async () => [project], getById: async (id: string) => id === 'p' ? project : undefined } as unknown as ProjectRepository;
  const provider = () => ({ start: async () => {}, stop: async () => {}, createSession: async (config: { onEvent: (e: unknown) => void }) => ({ execute: async () => { config.onEvent({ type: 'output', content: JSON.stringify(pass) }); return { status: 'complete' }; }, abort: async () => {}, destroy: async () => {} }) });
  const agents = new AgentManager();
  const engine = new Workflow(store, repo, projects, agents, (providerOverride || provider) as never);
  const p = store.get('p'); p.productSpec = proposal.productSpec; p.tasks.t = { criteria, dependsOn: [], complexity: 'small', rounds: 0, phase: 'review-ready' };
  return { tmp, main, wt, store, tasks, repo, agents, engine, p, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}


// Local union validation: fake execution/providers with real temporary Git repositories.
for (const outside of [false, true]) {
  test(`combined delegation routes small scoped execution and ${outside ? 'blocks outside delivery before provider/auto-add' : 'requires explicit acceptance after strong review'}`, async () => {
    const calls: string[] = [];
    const f = fixture((profile: { model: string }, role: string) => {
      calls.push(`${role}:${profile.model}`);
      return { start: async () => {}, stop: async () => {}, createSession: async (config: { onEvent: (e: unknown) => void }) => ({ execute: async () => {
        config.onEvent({ type: 'output', content: JSON.stringify(pass) }); return { status: 'complete' };
      }, abort: async () => {}, destroy: async () => {} }) };
    });
    try {
      for (const role of ['executor', 'reviewer', 'manager'] as const) Object.assign(f.p.roles[role], { auto: true, candidates: [
        { model: `${role}/light`, effort: 'low' }, { model: `${role}/strong`, effort: 'high' },
      ] });
      f.p.tasks.t.allowedWritePaths = ['README.md'];
      let finish!: (status: 'complete') => Promise<void>;
      let dispatched!: Task;
      f.agents.startAgent = (task, onStatus) => { dispatched = task; finish = onStatus as typeof finish; };
      await f.engine.start('p', 't');
      assert.equal(dispatched.runProfile!.model, 'executor/light');
      assert.equal(dispatched.runProfile!.effort, 'low');
      assert.match(dispatched.description, /\["README.md"\]/);
      fs.writeFileSync(path.join(f.wt, outside ? 'outside.txt' : 'README.md'), 'Executor delivery\n');
      const head = git(f.wt, ['rev-parse', 'HEAD']); const status = git(f.wt, ['status', '--porcelain']);
      await finish('complete');
      for (let i = 0; i < 500 && !['blocked', 'awaiting-user'].includes(f.p.tasks.t.phase); i++) await new Promise(r => setTimeout(r, 10));
      if (outside) {
        assert.equal(f.p.tasks.t.phase, 'blocked'); assert.deepEqual(calls, []);
        assert.equal(git(f.wt, ['rev-parse', 'HEAD']), head); assert.equal(git(f.wt, ['status', '--porcelain']), status);
        assert.equal(f.p.tasks.t.acceptedAt, undefined);
      } else {
        assert.deepEqual(calls, ['reviewer:reviewer/strong', 'manager:manager/strong']);
        assert.equal(f.p.tasks.t.phase, 'awaiting-user'); assert.equal(f.p.tasks.t.acceptedAt, undefined);
        await assert.rejects(f.engine.merge('p', 't'));
        fs.writeFileSync(path.join(f.wt, 'README.md'), 'Changed since review\n');
        await assert.rejects(f.engine.accept('p', 't'), /stale review/i);
        await f.engine.review('p', 't');
        assert.equal(f.p.tasks.t.acceptedAt, undefined);
        await f.engine.accept('p', 't'); await f.engine.merge('p', 't');
        assert.equal(fs.readFileSync(path.join(f.main, 'README.md'), 'utf8'), 'Changed since review\n');
      }
    } finally { await f.engine.pause('p'); f.cleanup(); }
  });
}
test('combined scoped repair retains the allowlist and lightweight executor after strongest review format retry', async () => {
  const calls: { role: string; model: string; effort: string }[] = [];
  let reviewerCalls = 0;
  const revise: Assessment = { ...pass, verdict: 'revise', summary: 'Fix README', revision: 'Add missing introduction' };
  const f = fixture((profile: { model: string; effort: string }, role: string) => {
    calls.push({ role, model: profile.model, effort: profile.effort });
    return { start: async () => {}, stop: async () => {}, createSession: async (config: { onEvent: (e: unknown) => void }) => ({ execute: async () => {
      const response = role === 'reviewer' && ++reviewerCalls === 1 ? 'invalid JSON' : JSON.stringify(revise);
      config.onEvent({ type: 'output', content: response }); return { status: 'complete' };
    }, abort: async () => {}, destroy: async () => {} }) };
  });
  try {
    for (const role of ['manager', 'reviewer', 'executor'] as const) Object.assign(f.p.roles[role], { auto: true, candidates: [
      { model: `${role}/light`, effort: 'low' }, { model: `${role}/strong`, effort: 'high' },
    ] });
    f.p.tasks.t.allowedWritePaths = ['README.md'];
    fs.writeFileSync(path.join(f.wt, 'README.md'), 'Scoped initial delivery\n');
    let dispatched: Task | undefined;
    f.agents.startAgent = task => { dispatched = task; };
    await f.engine.review('p', 't');
    assert.deepEqual(calls, [
      { role: 'reviewer', model: 'reviewer/strong', effort: 'high' },
      { role: 'reviewer', model: 'reviewer/strong', effort: 'high' },
      { role: 'manager', model: 'manager/strong', effort: 'high' },
    ]);
    assert.equal(dispatched!.runProfile!.model, 'executor/light');
    assert.equal(dispatched!.runProfile!.effort, 'low');
    assert.deepEqual(f.p.tasks.t.allowedWritePaths, ['README.md']);
    assert.match(dispatched!.description, /\["README.md"\]/);
    assert.equal(f.p.tasks.t.rounds, 1); assert.equal(f.p.tasks.t.acceptedAt, undefined);
    await f.engine.pause('p');
  } finally { f.cleanup(); }
});

