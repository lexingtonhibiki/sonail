import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaults, selectProfile, validateAssessment, validateProposal, mayAutoAccept, type Assessment, type TaskPolicy } from '../../../shared/workflow.js';
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

test('non-blocking manager advice does not reject a passed review awaiting human experience', () => {
  const human = [...criteria, { id: 'A2', text: 'User finds the document easy to read', kind: 'human' as const }];
  const report = { ...pass, criteria: [...pass.criteria, { id: 'A2', status: 'human', evidence: 'User reads the actual document' }], findings: [{ severity: 'advisory', text: 'The optional change-history table may be shortened' }], humanChecks: ['Read the document and confirm it is clear'] } as unknown as Assessment;
  assert.doesNotThrow(() => validateAssessment(report, human));
  assert.equal(mayAutoAccept({ criteria: human, dependsOn: [], complexity: 'small', rounds: 0, phase: 'awaiting-user', reviewer: report, manager: report }), false);
});

test('blocking findings still reject a passing review', () => {
  const report = { ...pass, findings: [{ severity: 'blocking', text: 'Requested file is missing' }] } as unknown as Assessment;
  assert.throws(() => validateAssessment(report, criteria), /cannot pass/);
});
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

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

test('real review flow repairs contradictory optional findings once and waits for actual user experience', async () => {
  const human = [...criteria, { id: 'A2', text: 'User finds the document clear', kind: 'human' as const }];
  const base: Assessment = { ...pass, criteria: [...pass.criteria, { id: 'A2', status: 'human', evidence: 'User must read README.md' }], humanChecks: ['Read README.md and confirm it is clear'] };
  let managers = 0;
  const f = fixture((_profile: unknown, role: string) => ({ start: async () => {}, stop: async () => {}, createSession: async (config: { onEvent: (e: unknown) => void }) => ({ execute: async () => {
    const findings = role === 'manager' && ++managers === 1 ? ['非阻塞：可删除冗余变更记录'] : [{ severity: 'advisory', text: '可删除冗余变更记录' }];
    config.onEvent({ type: 'output', content: JSON.stringify({ ...base, findings: role === 'manager' ? findings : [] }) }); return { status: 'complete' };
  }, abort: async () => {}, destroy: async () => {} }) }));
  try {
    f.p.tasks.t.criteria = human; f.p.tasks.t.allowedWritePaths = ['README.md']; f.engine.saveSettings('p', { fullManaged: true });
    await f.engine.review('p', 't');
    assert.equal(managers, 2); assert.equal(f.p.tasks.t.phase, 'awaiting-user'); assert.equal(f.p.tasks.t.acceptedAt, undefined);
    assert.equal(f.p.managerRecords.filter(r => r.kind === 'assessment').length, 1); assert.equal(f.p.tasks.t.attention, undefined);
    await f.engine.accept('p', 't');
    const internal = f.engine as unknown as { projects: { getAllWithCounts: () => Promise<{ id: string }[]> }; pump: () => Promise<void> };
    internal.projects.getAllWithCounts = async () => [{ id: 'p' }];
    await internal.pump(); assert.equal(f.p.tasks.t.phase, 'integrated');
  } finally { f.cleanup(); }
});

test('review failure still reaches the manager for explicit actionable revision guidance', async () => {
  let managerCalled = false;
  const revise: Assessment = { ...pass, verdict: 'revise', summary: '缺少需求中的简介', criteria: [{ ...pass.criteria[0], status: 'fail' }], findings: [{ severity: 'blocking', text: '简介未实现' }], revision: '在 README 中补全原始需求的简介' };
  const f = fixture((_profile: unknown, role: string) => ({ start: async () => {}, stop: async () => {}, createSession: async (config: { onEvent: (e: unknown) => void }) => ({ execute: async () => { managerCalled ||= role === 'manager'; config.onEvent({ type: 'output', content: JSON.stringify(revise) }); return { status: 'complete' }; }, abort: async () => {}, destroy: async () => {} }) }));
  try { f.p.paused = true; await f.engine.review('p', 't'); assert.equal(managerCalled, true); assert.equal(f.p.tasks.t.phase, 'needs-changes'); assert.match(f.p.tasks.t.attention!.nextStep, /暂停/); assert.ok(f.p.managerRecords.some(r => r.assessment?.revision === revise.revision)); }
  finally { f.cleanup(); }
});

test('disclosed full-management authorization is explicit, reversible and leaves an audit record', () => {
  const f = fixture(); try {
    assert.equal(f.p.fullManaged, false); f.engine.saveSettings('p', { fullManaged: true });
    assert.ok(f.p.autonomous && f.p.autoAccept && f.p.autoMerge && f.p.managerMayEdit);
    assert.equal(f.p.maxRevisions, 2); assert.equal(f.p.maxConcurrency, 2);
    f.engine.saveSettings('p', { autoMerge: false }); assert.equal(f.p.fullManaged, false); assert.equal(f.p.autonomous, true);
    f.engine.saveSettings('p', { fullManaged: false }); assert.ok(!f.p.autonomous && !f.p.autoAccept && !f.p.autoMerge && !f.p.managerMayEdit);
    assert.equal(f.p.managerRecords.filter(r => r.kind === 'authorization').length, 2);
  } finally { f.cleanup(); }
});

test('authorized manager changes only supplemental execution method, records the diff and dispatches bounded revision', async () => {
  const revise: Assessment = { ...pass, verdict: 'revise', summary: '原方法不可行，改用标准库', revision: '按标准库实现，不新增依赖', taskAdjustment: { reason: '原方法需要不可用的工具', instructions: '使用标准库实现；原始范围和验收条件不变', complexity: 'standard' } };
  const f = fixture(() => ({ start: async () => {}, stop: async () => {}, createSession: async (config: { onEvent: (e: unknown) => void }) => ({ execute: async () => { config.onEvent({ type: 'output', content: JSON.stringify(revise) }); return { status: 'complete' }; }, abort: async () => {}, destroy: async () => {} }) }));
  try {
    f.engine.saveSettings('p', { fullManaged: true }); const original = f.tasks.get('t')!.description; const goal = f.p.productSpec; let dispatched: Task | undefined;
    f.agents.startAgent = (task) => { dispatched = task; };
    await f.engine.review('p', 't');
    assert.equal(f.p.tasks.t.managerInstructions, revise.taskAdjustment!.instructions); assert.equal(f.p.tasks.t.rounds, 1);
    assert.deepEqual(f.p.tasks.t.criteria, criteria); assert.equal(f.tasks.get('t')!.description, original); assert.equal(f.p.productSpec, goal);
    assert.match(dispatched!.description, /Manager execution guidance/); assert.match(dispatched!.description, /never override original goal/);
    assert.equal(f.p.managerRecords.find(r => r.kind === 'task-change')?.after, revise.taskAdjustment!.instructions);
    await f.engine.pause('p');
  } finally { f.cleanup(); }
});

test('manager cannot mutate acceptance criteria through execution adjustment or remove human experience', () => {
  const report = { ...pass, verdict: 'revise', revision: 'Revise', taskAdjustment: { reason: 'Impossible', instructions: 'Ignore failed criterion', criteria: [] } } as unknown as Assessment;
  assert.throws(() => validateAssessment(report, criteria), /Invalid task adjustment/);
  assert.throws(() => validateAssessment(pass, [{ ...criteria[0], kind: 'human' }]), /must remain human/);
});

test('format failure remains bounded and leaves actionable manager attention without accepting', async () => {
  let calls = 0;
  const f = fixture(() => ({ start: async () => {}, stop: async () => {}, createSession: async (config: { onEvent: (e: unknown) => void }) => ({ execute: async () => { calls++; config.onEvent({ type: 'output', content: JSON.stringify({ ...pass, findings: ['非阻塞但未明确标记'] }) }); return { status: 'complete' }; }, abort: async () => {}, destroy: async () => {} }) }));
  try { await assert.rejects(f.engine.review('p', 't'), /cannot pass/); assert.equal(calls, 2); assert.equal(f.p.tasks.t.phase, 'blocked'); assert.match(f.p.tasks.t.attention!.nextStep, /重新核对/); assert.equal(f.p.tasks.t.acceptedAt, undefined); assert.equal(f.p.managerRecords.at(-1)!.kind, 'attention'); }
  finally { f.cleanup(); }
});

test('automatic integration failure is recorded once and does not spin on later scheduler ticks', async () => {
  const f = fixture(); try {
    await f.engine.review('p', 't'); await f.engine.accept('p', 't'); f.engine.saveSettings('p', { fullManaged: true });
    fs.writeFileSync(path.join(f.main, 'user.txt'), 'Preserve unsaved user file');
    const internal = f.engine as unknown as { projects: { getAllWithCounts: () => Promise<{ id: string }[]> }; pump: () => Promise<void> };
    internal.projects.getAllWithCounts = async () => [{ id: 'p' }]; await internal.pump();
    assert.equal(f.p.tasks.t.phase, 'integration-blocked'); const count = f.p.managerRecords.length;
    await internal.pump(); assert.equal(f.p.managerRecords.length, count); assert.equal(fs.readFileSync(path.join(f.main, 'user.txt'), 'utf8'), 'Preserve unsaved user file');
  } finally { f.cleanup(); }
});

test('deliverable preview reads only registered task changes and redacts configured secrets', async () => {
  const f = fixture(); try {
    f.store.saveEndpoint({ id: 'local', name: 'Local', protocol: 'openai', baseUrl: 'http://localhost:9000', apiKey: 'test-preview-secret' });
    fs.writeFileSync(path.join(f.wt, 'delivery.md'), 'Hello test-preview-secret'); await f.engine.review('p', 't');
    const files = await f.engine.artifacts('p', 't'); assert.equal(files.length, 1); assert.equal(files[0].path, 'delivery.md'); assert.equal(files[0].content, 'Hello [REDACTED]');
    await assert.rejects(f.engine.artifacts('other-project', 't'), /does not belong/);
    f.tasks.get('t')!.worktreePath = f.main; await assert.rejects(f.engine.artifacts('p', 't'), /identity mismatch/);
  } finally { f.cleanup(); }
});

test('manager corrects one malformed draft without publishing tasks', async () => {
  let calls = 0;
  const f = fixture(() => ({ start: async () => {}, stop: async () => {}, createSession: async (config: { onEvent: (e: unknown) => void }) => ({ execute: async () => { calls++; config.onEvent({ type: 'output', content: JSON.stringify(calls === 1 ? { ...proposal, productSpec: { invalid: 'Object' } } : proposal) }); return { status: 'complete' }; }, abort: async () => {}, destroy: async () => {} }) }));
  try { f.p.idea = 'Minimal demo'; delete f.p.tasks.t; await f.engine.propose('p'); assert.equal(calls, 2); assert.deepEqual(f.p.proposal, proposal); assert.equal(Object.keys(f.p.tasks).length, 0); }
  finally { f.cleanup(); }
});

test('repeated malformed manager output stops after one correction and never publishes', async () => {
  let calls = 0;
  const f = fixture(() => ({ start: async () => {}, stop: async () => {}, createSession: async (config: { onEvent: (e: unknown) => void }) => ({ execute: async () => { calls++; config.onEvent({ type: 'output', content: JSON.stringify({ ...proposal, productSpec: { invalid: 'Object' } }) }); return { status: 'complete' }; }, abort: async () => {}, destroy: async () => {} }) }));
  try { f.p.idea = 'Minimal demo'; delete f.p.tasks.t; await assert.rejects(f.engine.propose('p'), /Invalid proposal/); assert.equal(calls, 2); assert.equal(f.p.proposal, undefined); assert.equal(Object.keys(f.p.tasks).length, 0); }
  finally { f.cleanup(); }
});

test('spec changes and re-review invalidate previous integration, allowing a fresh merge', async () => {
  const f = fixture(); try {
    await f.engine.review('p', 't'); await f.engine.accept('p', 't'); await f.engine.merge('p', 't');
    assert.ok(f.p.tasks.t.integratedCommit);
    f.engine.saveSettings('p', { productSpec: 'Revised need' });
    assert.equal(f.p.tasks.t.mergedAt, undefined); assert.equal(f.p.tasks.t.integratedCommit, undefined);
    fs.writeFileSync(path.join(f.wt, 'README.md'), 'New need\n');
    await f.engine.review('p', 't'); await f.engine.accept('p', 't'); await f.engine.merge('p', 't');
    assert.equal(fs.readFileSync(path.join(f.main, 'README.md'), 'utf8'), 'New need\n');
    await f.engine.review('p', 't'); assert.equal(f.p.tasks.t.mergedAt, undefined);
  } finally { f.cleanup(); }
});

test('stale downstream cannot bypass dependencies through manual review, acceptance or merge', async () => {
  const f = fixture(); try {
    await f.engine.review('p', 't'); await f.engine.accept('p', 't'); await f.engine.merge('p', 't');
    const childWt = path.join(f.tmp, 'child'); git(f.main, ['worktree', 'add', '-b', 'sonail/child', childWt]);
    f.tasks.set('child', { ...f.tasks.get('t')!, id: 'child', worktreePath: childWt, branchName: 'sonail/child' });
    f.p.tasks.child = { criteria, complexity: 'small', rounds: 0, phase: 'review-ready', dependsOn: ['t'], inputCommits: { t: f.p.tasks.t.integratedCommit! } };
    await f.engine.review('p', 'child');
    await f.engine.reopen('p', 't', 'Upstream changed');
    await assert.rejects(f.engine.review('p', 'child'), /Dependencies/);
    Object.assign(f.p.tasks.child, { phase: 'awaiting-user', reviewer: pass, manager: pass });
    await assert.rejects(f.engine.accept('p', 'child'), /Dependencies/);
    f.p.tasks.child.acceptedAt = Date.now();
    await assert.rejects(f.engine.merge('p', 'child'), /Dependencies/);
  } finally { f.cleanup(); }
});

test('downstream rerun incorporates the new upstream commit; dirty edits are preserved', async () => {
  const f = fixture(); try {
    fs.writeFileSync(path.join(f.wt, 'upstream.txt'), 'v1');
    await f.engine.review('p', 't'); await f.engine.accept('p', 't'); await f.engine.merge('p', 't');
    const childWt = path.join(f.tmp, 'child'); git(f.main, ['worktree', 'add', '-b', 'sonail/child', childWt]);
    f.tasks.set('child', { ...f.tasks.get('t')!, id: 'child', worktreePath: childWt, branchName: 'sonail/child', summary: undefined });
    f.p.tasks.child = { criteria, complexity: 'small', rounds: 0, phase: 'ready', dependsOn: ['t'], inputCommits: { t: f.p.tasks.t.integratedCommit! } };
    await f.engine.reopen('p', 't', 'Upstream update'); fs.writeFileSync(path.join(f.wt, 'upstream.txt'), 'v2');
    await f.engine.review('p', 't'); await f.engine.accept('p', 't'); await f.engine.merge('p', 't');
    fs.writeFileSync(path.join(childWt, 'user.txt'), 'Uncommitted user work');
    await assert.rejects(f.engine.start('p', 'child'), /Dirty task workspace/);
    assert.equal(fs.readFileSync(path.join(childWt, 'user.txt'), 'utf8'), 'Uncommitted user work');
    git(childWt, ['add', 'user.txt']); git(childWt, ['commit', '-m', 'Save user work']);
    let launched = false; f.agents.startAgent = () => { launched = true; };
    await f.engine.start('p', 'child'); assert.equal(launched, true);
    assert.equal(fs.readFileSync(path.join(childWt, 'upstream.txt'), 'utf8'), 'v2');
    assert.equal(f.p.tasks.child.inputCommits!.t, f.p.tasks.t.integratedCommit);
    await f.engine.pause('p');
  } finally { f.cleanup(); }
});

test('manual review respects concurrency including asynchronous provider preparation', async () => {
  const ready = deferred<void>(); const release = deferred<void>();
  const f = fixture(() => ({ start: async () => { ready.resolve(); await release.promise; }, stop: async () => {}, createSession: async () => { throw new Error('Should not execute cancelled preparation'); } }));
  try {
    f.p.maxConcurrency = 1; f.tasks.set('child', { ...f.tasks.get('t')!, id: 'child' });
    f.p.tasks.child = { criteria, complexity: 'small', rounds: 0, phase: 'review-ready', dependsOn: [] };
    const running = f.engine.review('p', 't'); await ready.promise;
    await assert.rejects(f.engine.review('p', 'child'), /Concurrency/);
    await f.engine.pause('p'); release.resolve(); await running;
    assert.equal(f.p.tasks.t.phase, 'interrupted'); assert.equal(f.p.tasks.t.acceptedAt, undefined);
  } finally { release.resolve(); f.cleanup(); }
});

test('pause during executor repository preparation prevents dispatch', async () => {
  const entered = deferred<void>(); const release = deferred<void>(); const f = fixture();
  try {
    const originalUpdate = f.repo.update.bind(f.repo);
    f.repo.update = async (id, update) => { if (update.agentStatus === 'planning') { entered.resolve(); await release.promise; } return originalUpdate(id, update); };
    let launched = false; f.agents.startAgent = () => { launched = true; };
    const starting = f.engine.start('p', 't'); await entered.promise;
    await f.engine.pause('p'); release.resolve(); await starting;
    assert.equal(launched, false); assert.equal(f.p.tasks.t.phase, 'interrupted');
  } finally { release.resolve(); f.cleanup(); }
});

test('native executor cancelled while createSession awaits never executes or emits stale events', async () => {
  const f = fixture(); const entered = deferred<void>(); const created = deferred<unknown>();
  try {
    const internals = f.agents as unknown as { providers: Map<string, unknown>; availableAgents: unknown[] };
    let executed = false; let destroyed = false; let emit!: (e: unknown) => void;
    internals.providers.set('opencode', { displayName: 'Test', createSession: async (config: { onEvent: typeof emit }) => { emit = config.onEvent; entered.resolve(); return created.promise; } });
    internals.availableAgents = [{ name: 'opencode', available: true }];
    f.agents.startAgent({ ...f.tasks.get('t')!, agentType: 'opencode' }, () => {}); await entered.promise;
    await f.agents.stopAgent('t');
    created.resolve({ execute: async () => { executed = true; return { status: 'complete' }; }, abort: async () => {}, destroy: async () => { destroyed = true; } });
    await new Promise(r => setImmediate(r));
    emit({ id: 'late', type: 'output', content: 'stale output', timestamp: Date.now() });
    assert.equal(executed, false); assert.equal(destroyed, true); assert.equal(f.agents.isRunning('t'), false);
    assert.ok(!(await f.agents.getEvents('t')).some(e => e.id === 'late'));
  } finally { f.cleanup(); }
});

test('executor redacts endpoint secrets in persisted output, nested metadata and task summary', async () => {
  const f = fixture(); const finished = deferred<void>(); const events: unknown[] = [];
  try {
    f.store.saveEndpoint({ id: 'local', name: 'local', protocol: 'openai', baseUrl: 'http://localhost:9000/v1', apiKey: 'secret-test-key' });
    const internals = f.agents as unknown as { providers: Map<string, unknown>; availableAgents: unknown[] };
    f.agents.initEventPersistence({ ...f.repo, insertEvent: async (e: unknown) => { events.push(e); }, getEventsByTaskId: async () => [] } as unknown as TaskRepository);
    internals.providers.set('opencode', { displayName: 'Test', createSession: async (config: { onEvent: (e: unknown) => void }) => ({
      execute: async () => { config.onEvent({ id: 'key', type: 'output', content: 'secret-test-key\n<task-summary>\n## Completed\nsecret-test-key\n</task-summary>', metadata: { nested: { value: 'secret-test-key' } }, timestamp: Date.now() }); return { status: 'complete' }; },
      abort: async () => {}, destroy: async () => {},
    }) }); internals.availableAgents = [{ name: 'opencode', available: true }];
    f.agents.startAgent({ ...f.tasks.get('t')!, agentType: 'opencode' }, status => { if (status === 'complete') finished.resolve(); }); await finished.promise;
    assert.ok(!JSON.stringify(events).includes('secret-test-key')); assert.ok(!f.tasks.get('t')!.summary?.includes('secret-test-key'));
    assert.match(JSON.stringify(events), /REDACTED/);
  } finally { f.cleanup(); }
});
test('manual role selection wins; auto selects only user allowed candidates', () => {
  const p = defaults().roles.executor; p.candidates = [{ model: 'free/local', effort: 'high' }, { model: 'go/strong', effort: 'max' }];
  assert.equal(selectProfile(p, 'deep').model, p.model); p.auto = true;
  assert.equal(selectProfile(p, 'small').model, 'free/local'); assert.equal(selectProfile(p, 'deep').model, 'go/strong');
});
test('OpenCode forwards model and effort, reviewer tool restrictions and custom protocol', () => {
  const p = { ...defaults().roles.reviewer, model: 'opencode-go/deepseek-v4.1-flash', effort: 'max' };
  const request = openCodeRequest(p, 's', 'C:/repo', 'prompt', 'reviewer');
  assert.deepEqual(request.model, { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' }); assert.equal(request.variant, 'max'); assert.equal(request.tools?.bash, false);
  assert.throws(() => effortFor({ ...p, harness: 'codex' }), /Codex/);
  assert.throws(() => effortFor({ ...p, endpointId: 'local' }), /capability is unknown/);
  const config = endpointConfig({ ...p, model: 'local-model', endpointId: 'local' }, { id: 'local', name: 'Local', protocol: 'anthropic', baseUrl: 'http://127.0.0.1:8080', apiKey: 'secret' });
  assert.match(JSON.stringify(config), /@ai-sdk\/anthropic/);
});
test('proposal dependency cycles and unsupported reference rejected', () => {
  validateProposal(proposal); assert.throws(() => validateProposal({ ...proposal, tasks: [{ ...proposal.tasks[0], dependsOn: [0] }] }), /Dependencies/);
});
test('review must cover criteria with evidence; model confidence cannot pass unknowns', () => {
  validateAssessment(pass, criteria);
  assert.throws(() => validateAssessment({ ...pass, criteria: [] }, criteria), /evidence/);
  assert.throws(() => validateAssessment({ ...pass, criteria: [{ ...pass.criteria[0], status: 'unknown' }] }, criteria), /Unresolved/);
  const t: TaskPolicy = { criteria, dependsOn: [], complexity: 'small', phase: 'awaiting-user', rounds: 0, reviewer: pass, manager: pass };
  assert.equal(mayAutoAccept(t), true); assert.equal(mayAutoAccept({ ...t, criteria: [{ ...criteria[0], kind: 'human' }] }), false);
});
test('endpoint keys never returned and old key retained on edit', () => {
  const f = fixture(); try {
    f.store.saveEndpoint({ id: 'local', name: 'Local', protocol: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: 'secret-test' });
    f.store.saveEndpoint({ id: 'local', name: 'Renamed', protocol: 'openai', baseUrl: 'http://127.0.0.1:1234/v1' });
    assert.equal(f.store.endpoint('local').apiKey, 'secret-test'); assert.ok(!JSON.stringify(f.store.listEndpoints()).includes('secret-test'));
    assert.equal(f.store.redact('error secret-test'), 'error [REDACTED]');
    assert.throws(() => f.store.saveEndpoint({ id: 'bad', name: 'bad', protocol: 'openai', baseUrl: 'http://example.com' }), /HTTPS/);
  } finally { f.cleanup(); }
});
test('executor completion alone cannot accept; workspace edits make review stale', async () => {
  const f = fixture(); try {
    await assert.rejects(f.engine.accept('p', 't'), /Review not passed/);
    await f.engine.review('p', 't'); assert.equal(f.p.tasks.t.phase, 'awaiting-user');
    fs.writeFileSync(path.join(f.wt, 'README.md'), 'Changed after review');
    await assert.rejects(f.engine.accept('p', 't'), /Stale review/);
  } finally { f.cleanup(); }
});
test('review commits executor changes before checking and actual merge includes them', async () => {
  const f = fixture(); try {
    fs.writeFileSync(path.join(f.wt, 'README.md'), 'Delivered requirement\n');
    await f.engine.review('p', 't');
    assert.equal(git(f.wt, ['status', '--porcelain']), '');
    await f.engine.accept('p', 't'); await f.engine.merge('p', 't');
    assert.equal(fs.readFileSync(path.join(f.main, 'README.md'), 'utf8'), 'Delivered requirement\n');
    assert.equal(f.engine.blockers(f.p, { ...f.p.tasks.t, dependsOn: ['t'] }).length, 0);
  } finally { f.cleanup(); }
});
test('main dirty workspace blocks merge without losing user edits', async () => {
  const f = fixture(); try {
    await f.engine.review('p', 't'); await f.engine.accept('p', 't');
    fs.writeFileSync(path.join(f.main, 'README.md'), 'User unsaved change');
    await assert.rejects(f.engine.merge('p', 't'), /must be clean/);
    assert.equal(fs.readFileSync(path.join(f.main, 'README.md'), 'utf8'), 'User unsaved change');
  } finally { f.cleanup(); }
});

test('parallel task integration invalidates an old review until it includes the latest base', async () => {
  const f = fixture(); try {
    fs.writeFileSync(path.join(f.wt, 'task.txt'), 'Task output');
    await f.engine.review('p', 't');
    fs.writeFileSync(path.join(f.main, 'parallel.txt'), 'Other integrated task');
    git(f.main, ['add', 'parallel.txt']); git(f.main, ['commit', '-m', 'Parallel integration']);
    await assert.rejects(f.engine.accept('p', 't'), /Stale review/);
    await f.engine.review('p', 't');
    assert.equal(fs.readFileSync(path.join(f.wt, 'parallel.txt'), 'utf8'), 'Other integrated task');
    await f.engine.accept('p', 't'); await f.engine.merge('p', 't');
    assert.equal(fs.readFileSync(path.join(f.main, 'task.txt'), 'utf8'), 'Task output');
  } finally { f.cleanup(); }
});

test('merge rechecks the accepted base after waiting for the repository lock', async () => {
  const f = fixture(); const release = deferred<void>(); try {
    await f.engine.review('p', 't'); await f.engine.accept('p', 't');
    const internals = f.agents as unknown as { repoLocks: Map<string, Promise<void>> };
    internals.repoLocks.set(f.main, release.promise);
    const merging = f.engine.merge('p', 't');
    await new Promise(r => setImmediate(r));
    fs.writeFileSync(path.join(f.main, 'parallel.txt'), 'Other project update');
    git(f.main, ['add', 'parallel.txt']); git(f.main, ['commit', '-m', 'Update while waiting']);
    release.resolve();
    await assert.rejects(merging, /changed while waiting for merge/);
    assert.equal(f.p.tasks.t.mergedAt, undefined);
    assert.equal(fs.readFileSync(path.join(f.main, 'parallel.txt'), 'utf8'), 'Other project update');
  } finally { release.resolve(); f.cleanup(); }
});
test('digest detects untracked files and criteria changes', () => {
  const f = fixture(); try {
    const initial = workspaceDigest(f.wt, f.p.tasks.t, 1);
    fs.writeFileSync(path.join(f.wt, 'new.txt'), 'new'); assert.notEqual(workspaceDigest(f.wt, f.p.tasks.t, 1), initial);
    assert.notEqual(workspaceDigest(f.wt, f.p.tasks.t, 2), initial);
  } finally { f.cleanup(); }
});
test('restart pauses uncertain work and never auto resumes it', () => {
  const f = fixture(); try {
    f.p.autonomous = true; f.p.tasks.t.phase = 'executing'; f.store.save();
    const restarted = new WorkflowStore(path.join(f.tmp, 'workflow.json'));
    assert.equal(restarted.get('p').paused, true); assert.equal(restarted.get('p').tasks.t.phase, 'interrupted');
  } finally { f.cleanup(); }
});
test('reopening invalidates dependent acceptance without reverting merged content', async () => {
  const f = fixture(); try {
    await f.engine.review('p', 't'); await f.engine.accept('p', 't');
    f.tasks.set('child', { ...f.tasks.get('t')!, id: 'child', columnId: 'done' });
    f.p.tasks.child = { ...f.p.tasks.t, dependsOn: ['t'], acceptedAt: Date.now(), mergedAt: Date.now(), phase: 'integrated' };
    await f.engine.reopen('p', 't', 'Wrong click'); assert.equal(f.p.paused, true); assert.equal(f.p.tasks.child.acceptedAt, undefined); assert.equal(f.p.tasks.child.phase, 'dependency-invalidated');
    assert.equal(fs.readFileSync(path.join(f.main, 'README.md'), 'utf8'), 'Initial\n');
  } finally { f.cleanup(); }
});

test('project archive requires every actual task to be accepted and integrated, never only done', async () => {
  const f = fixture(); try {
    f.tasks.get('t')!.columnId = 'done'; f.p.tasks.t.phase = 'accepted'; f.p.tasks.t.acceptedAt = 2;
    assert.equal((await f.engine.projectSummaries())[0].complete, false);
    await assert.rejects(f.engine.updateProjectMeta('p', { archived: true }), /accepted and integrated/);
    f.p.tasks.t.mergedAt = 3; f.p.tasks.t.integratedCommit = git(f.main, ['rev-parse', 'HEAD']);
    assert.equal((await f.engine.projectSummaries())[0].complete, true);
    await f.engine.updateProjectMeta('p', { category: '工作', pinned: true, archived: true });
    assert.equal(f.p.paused, true); assert.ok(f.store.metadata('p').archivedAt);
    await assert.rejects(f.engine.start('p', 't'), /Restore/);
    await assert.rejects(f.engine.reopen('p', 't', 'Rework'), /Restore/);
    assert.throws(() => f.engine.saveSettings('p', { paused: false }), /Restore/);
    await f.engine.updateProjectMeta('p', { archived: false });
    assert.equal(f.p.paused, true); assert.equal(f.store.metadata('p').archivedAt, undefined);
    assert.equal(f.store.metadata('p').category, '工作'); assert.equal(f.store.metadata('p').pinned, true);
    await f.engine.reopen('p', 't', 'Needs correction');
    assert.equal((await f.engine.projectSummaries())[0].complete, false);
  } finally { f.cleanup(); }
});
test('project summaries include unmanaged unfinished work and do not create activity on read', async () => {
  const f = fixture(); try {
    f.p.tasks.t.acceptedAt = 2; f.p.tasks.t.mergedAt = 3; f.p.tasks.t.integratedCommit = 'commit'; f.p.tasks.t.phase = 'integrated';
    f.tasks.set('other', { ...f.tasks.get('t')!, id: 'other', columnId: 'backlog' });
    const first = (await f.engine.projectSummaries())[0]; const second = (await f.engine.projectSummaries())[0];
    assert.equal(first.total, 2); assert.equal(first.integrated, 1); assert.equal(first.complete, false); assert.equal(first.lastActivity, second.lastActivity);
    await assert.rejects(f.engine.updateProjectMeta('p', { archived: true }), /accepted and integrated/);
    f.tasks.clear(); assert.equal((await f.engine.projectSummaries())[0].complete, false);
    await assert.rejects(f.engine.updateProjectMeta('missing', { category: 'x' }), /Project missing/);
    await assert.rejects(f.engine.updateProjectMeta('p', { archivedAt: 1 }), /Invalid project metadata/);
  } finally { f.cleanup(); }
});
test('archive is blocked by live owned calls even if task markers are complete', async () => {
  const f = fixture(); try {
    f.p.tasks.t.phase = 'integrated'; f.p.tasks.t.acceptedAt = 2; f.p.tasks.t.mergedAt = 3; f.p.tasks.t.integratedCommit = 'commit';
    f.engine.active.set('manager', { projectId: 'p', cancel: async () => {} });
    await assert.rejects(f.engine.updateProjectMeta('p', { archived: true }), /Project running/);
    assert.equal(f.store.metadata('p').archivedAt, undefined);
  } finally { f.cleanup(); }
});
test('appearance and project organization persist independently of roles and endpoint secrets', () => {
  const f = fixture(); try {
    f.store.saveEndpoint({ id: 'local', name: 'Local', protocol: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: 'test-private-key' });
    const roles = structuredClone(f.p.roles);
    const tools = path.join(f.tmp, 'shared-tools');
    f.store.saveWorkbenchSettings({ theme: 'warm', toolsDirectory: tools }); f.store.saveMetadata('p', { category: '试验', pinned: true, archivedAt: 4 });
    assert.deepEqual(f.p.roles, roles);
    assert.throws(() => f.store.saveWorkbenchSettings({ theme: 'dark' } as never), /Invalid global settings/);
    assert.throws(() => f.store.saveWorkbenchSettings({ theme: 'sage', apiKey: 'secret' } as never), /Invalid global settings/);
    const restored = new WorkflowStore(path.join(f.tmp, 'workflow.json'));
    assert.equal(restored.workbenchSettings().theme, 'warm');
    assert.equal(restored.workbenchSettings().toolsDirectory, tools); assert.equal(fs.existsSync(tools), false);
    assert.throws(() => restored.saveWorkbenchSettings({ theme: 'warm', toolsDirectory: 'relative/tools' }), /absolute directory/);
    restored.saveWorkbenchSettings({ theme: 'warm', toolsDirectory: '' });
    assert.ok(path.isAbsolute(restored.workbenchSettings().toolsDirectory!)); assert.notEqual(restored.workbenchSettings().toolsDirectory, tools); assert.deepEqual(restored.metadata('p'), f.store.metadata('p'));
    assert.equal(restored.listEndpoints()[0].apiKey, undefined); assert.equal(restored.endpoint('local').apiKey, 'test-private-key');
    assert.equal(restored.get('p').paused, true);
  } finally { f.cleanup(); }
});
test('project filters select latest ten before pin ordering and combine category and keyword search', () => {
  const projects: ProjectSummary[] = Array.from({ length: 15 }, (_, i) => ({ id: String(i), name: '项目 ' + i, repoPath: '/work/' + i, isDefault: false, total: 1, integrated: 0, attention: i === 14 ? 1 : 0, running: 0, complete: false, lastActivity: i, meta: { category: i % 2 ? '工作' : '试验', pinned: i === 0 } }));
  assert.deepEqual(filterProjects(projects, 'recent', '', '').map(p => p.id), ['14','13','12','11','10','9','8','7','6','5']);
  assert.equal(filterProjects(projects, 'all', '', '')[0].id, '0');
  assert.deepEqual(filterProjects(projects, 'active', '项目 13', '工作').map(p => p.id), ['13']);
  assert.equal(filterProjects(projects, 'attention', '', '').length, 1);
  projects[14].meta.archivedAt = 5; projects[13].complete = true;
  assert.deepEqual(filterProjects(projects, 'archived', '', '').map(p => p.id), ['14']);
  assert.deepEqual(filterProjects(projects, 'completed', '', '').map(p => p.id), ['13']);
  assert.equal(filterProjects(projects, 'recent', '', '').length, 10);
});

// Scope checks deliberately exercise real Git state, not executor claims or mocked diffs.
function seedScopeFiles(f: ReturnType<typeof fixture>, files: Record<string, string>) {
  for (const [name, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(f.main, name)), { recursive: true });
    fs.writeFileSync(path.join(f.main, name), contents);
  }
  git(f.main, ['add', '-A']); git(f.main, ['commit', '-m', 'Seed scope fixtures']);
  git(f.wt, ['merge', 'main', '--no-edit']);
}

test('write scope survives import preview, publishing, reload and omitted edits', async () => {
  const f = fixture(); try {
    delete f.p.tasks.t;
    const scoped = { ...proposal, tasks: [{ ...proposal.tasks[0], allowedWritePaths: ['README.md', 'docs/'] }] };
    const context = await f.engine.importContext('p');
    await f.engine.previewImport('p', scoped, context.revision, context.fingerprint, 'scope test');
    assert.deepEqual(f.p.proposal!.tasks[0].allowedWritePaths, ['README.md', 'docs/']);
    const [id] = await f.engine.publish('p');
    assert.deepEqual(f.p.tasks[id].allowedWritePaths, ['README.md', 'docs/']);
    await f.engine.editTask('p', id, { title: 'Revised title', description: 'Same scope', criteria });
    assert.deepEqual(f.p.tasks[id].allowedWritePaths, ['README.md', 'docs/']);
    const reloaded = new WorkflowStore(path.join(f.tmp, 'workflow.json'));
    assert.deepEqual(reloaded.get('p').tasks[id].allowedWritePaths, ['README.md', 'docs/']);
    await f.engine.editTask('p', id, { title: 'Read only', description: 'Inspect only', criteria, allowedWritePaths: [] });
    assert.deepEqual(f.p.tasks[id].allowedWritePaths, []);
  } finally { f.cleanup(); }
});

for (const invalid of [null, 'README.md', [''], ['/README.md'], ['../README.md'], ['docs/../README.md'], ['./README.md'], ['docs//file'], ['*.md'], ['docs/**'], ['a\\b'], ['a\0b']]) {
  test(`write scope rejects malformed server input ${JSON.stringify(invalid)}`, async () => {
    const f = fixture(); try {
      const malformed = { ...proposal, tasks: [{ ...proposal.tasks[0], allowedWritePaths: invalid }] };
      assert.throws(() => validateProposal(malformed as never));
      await assert.rejects(f.engine.editTask('p', 't', { title: 'Task', description: 'Update README', criteria, allowedWritePaths: invalid } as never));
      assert.equal(f.p.tasks.t.allowedWritePaths, undefined);
    } finally { f.cleanup(); }
  });
}

test('write scope allows exact README changes through review, human acceptance and local integration', async () => {
  const f = fixture(); try {
    f.p.tasks.t.allowedWritePaths = ['README.md'];
    fs.writeFileSync(path.join(f.wt, 'README.md'), 'Scoped delivery\n');
    await f.engine.review('p', 't');
    assert.equal(f.p.tasks.t.phase, 'awaiting-user'); assert.equal(f.p.tasks.t.acceptedAt, undefined);
    await f.engine.accept('p', 't'); await f.engine.merge('p', 't');
    assert.equal(fs.readFileSync(path.join(f.main, 'README.md'), 'utf8'), 'Scoped delivery\n');
  } finally { f.cleanup(); }
});

for (const state of ['committed', 'staged', 'unstaged', 'untracked'] as const) {
  test(`write scope blocks ${state} out-of-scope content before review auto-commit`, async () => {
    let calls = 0;
    const f = fixture(() => { calls++; throw new Error('Provider must not run for a scope violation'); }); try {
      seedScopeFiles(f, { 'outside.txt': 'Original\n' });
      f.p.tasks.t.allowedWritePaths = ['README.md'];
      const name = state === 'untracked' ? 'new-outside.txt' : 'outside.txt';
      fs.writeFileSync(path.join(f.wt, name), 'Forbidden\n');
      if (state === 'staged' || state === 'committed') git(f.wt, ['add', name]);
      if (state === 'committed') git(f.wt, ['commit', '-m', 'Executor changed outside scope']);
      const head = git(f.wt, ['rev-parse', 'HEAD']); const status = git(f.wt, ['status', '--porcelain']);
      await assert.rejects(f.engine.review('p', 't'), /scope|allowed|范围/i);
      assert.equal(git(f.wt, ['rev-parse', 'HEAD']), head); assert.equal(git(f.wt, ['status', '--porcelain']), status);
      assert.equal(f.p.tasks.t.acceptedAt, undefined); assert.equal(f.p.tasks.t.reviewer, undefined); assert.equal(calls, 0); assert.equal(f.p.tasks.t.phase, 'blocked');
    } finally { f.cleanup(); }
  });
}

for (const staged of [false, true]) {
  test(`write scope blocks ${staged ? 'staged' : 'unstaged'} deletion`, async () => {
    const f = fixture(); try {
      f.p.tasks.t.allowedWritePaths = ['docs/']; fs.unlinkSync(path.join(f.wt, 'README.md'));
      if (staged) git(f.wt, ['add', '-A']);
      await assert.rejects(f.engine.review('p', 't'), /scope|allowed|范围/i);
    } finally { f.cleanup(); }
  });
}

for (const allowedWritePaths of [['README.md'], ['renamed.md']]) {
  test(`write scope checks both rename endpoints when only ${allowedWritePaths[0]} is allowed`, async () => {
    const f = fixture(); try {
      f.p.tasks.t.allowedWritePaths = allowedWritePaths;
      git(f.wt, ['mv', 'README.md', 'renamed.md']);
      git(f.wt, ['commit', '-m', 'Rename README']);
      await assert.rejects(f.engine.review('p', 't'), /scope|allowed|范围/i);
    } finally { f.cleanup(); }
  });
}

test('write scope handles NUL-delimited Git output for newline filenames', async () => {
  const f = fixture(); try {
    f.p.tasks.t.allowedWritePaths = ['docs/']; fs.mkdirSync(path.join(f.wt, 'docs'));
    fs.writeFileSync(path.join(f.wt, 'docs/line\nbreak.md'), 'Allowed\n');
    await f.engine.review('p', 't');
    fs.writeFileSync(path.join(f.wt, 'outside\nREADME.md'), 'Not allowed\n');
    await assert.rejects(f.engine.review('p', 't'), /scope|allowed|范围/i);
  } finally { f.cleanup(); }
});

test('write scope directory prefixes do not match sibling names or exact-file descendants', async () => {
  for (const [scope, name] of [['docs/', 'docs-other/file.md'], ['docs', 'docs/file.md']]) {
    const f = fixture(); try {
      f.p.tasks.t.allowedWritePaths = [scope]; fs.mkdirSync(path.dirname(path.join(f.wt, name)), { recursive: true });
      fs.writeFileSync(path.join(f.wt, name), 'Not allowed\n');
      await assert.rejects(f.engine.review('p', 't'), /scope|allowed|范围/i);
    } finally { f.cleanup(); }
  }
});

test('empty write scope permits unchanged review but rejects every changed path', async () => {
  const f = fixture(); try {
    f.p.tasks.t.allowedWritePaths = []; await f.engine.review('p', 't');
    assert.equal(f.p.tasks.t.phase, 'awaiting-user');
    fs.writeFileSync(path.join(f.wt, 'README.md'), 'Read-only violation\n');
    await assert.rejects(f.engine.review('p', 't'), /scope|allowed|范围/i);
  } finally { f.cleanup(); }
});

for (const state of ['untracked', 'staged', 'committed'] as const) {
  test(`write scope blocks a newly ${state} symlink even when its path is allowed`, async () => {
    const f = fixture(); try {
      f.p.tasks.t.allowedWritePaths = ['link']; fs.symlinkSync('README.md', path.join(f.wt, 'link'));
      if (state !== 'untracked') git(f.wt, ['add', 'link']);
      if (state === 'committed') git(f.wt, ['commit', '-m', 'Add symlink']);
      await assert.rejects(f.engine.review('p', 't'), /symlink|symbolic|符号|scope/i);
    } finally { f.cleanup(); }
  });
}

test('write scope tolerates unchanged baseline symlinks but rejects a changed symlink target', async () => {
  const f = fixture(); try {
    fs.symlinkSync('README.md', path.join(f.main, 'link')); git(f.main, ['add', 'link']); git(f.main, ['commit', '-m', 'Existing symlink']); git(f.wt, ['merge', 'main', '--no-edit']);
    f.p.tasks.t.allowedWritePaths = ['README.md', 'link']; fs.writeFileSync(path.join(f.wt, 'README.md'), 'Allowed\n');
    await f.engine.review('p', 't');
    fs.unlinkSync(path.join(f.wt, 'link')); fs.symlinkSync('elsewhere', path.join(f.wt, 'link'));
    await assert.rejects(f.engine.review('p', 't'), /symlink|symbolic|符号|scope/i);
  } finally { f.cleanup(); }
});

test('write scope does not misattribute newer upstream files to the task', async () => {
  const f = fixture(); try {
    f.p.tasks.t.allowedWritePaths = ['README.md']; fs.writeFileSync(path.join(f.wt, 'README.md'), 'Task delivery\n');
    fs.writeFileSync(path.join(f.main, 'upstream.txt'), 'Other task\n'); git(f.main, ['add', '.']); git(f.main, ['commit', '-m', 'Advance base']);
    await f.engine.review('p', 't');
    assert.equal(fs.readFileSync(path.join(f.wt, 'upstream.txt'), 'utf8'), 'Other task\n');
    await f.engine.accept('p', 't'); await f.engine.merge('p', 't');
    assert.equal(fs.readFileSync(path.join(f.main, 'README.md'), 'utf8'), 'Task delivery\n');
  } finally { f.cleanup(); }
});

test('write scope review rejects a baseline advance while the reviewer is running', async () => {
  const entered = deferred<void>(); const release = deferred<void>();
  const f = fixture(() => ({ start: async () => {}, stop: async () => {}, createSession: async (config: { onEvent: (e: unknown) => void }) => ({ execute: async () => { entered.resolve(); await release.promise; config.onEvent({ type: 'output', content: JSON.stringify(pass) }); return { status: 'complete' }; }, abort: async () => {}, destroy: async () => {} }) }));
  try {
    f.p.tasks.t.allowedWritePaths = ['README.md']; const reviewing = f.engine.review('p', 't'); await entered.promise;
    fs.writeFileSync(path.join(f.main, 'upstream.txt'), 'Changed baseline\n'); git(f.main, ['add', '.']); git(f.main, ['commit', '-m', 'Advance during review']);
    release.resolve(); await assert.rejects(reviewing, /base changed during review/i); assert.equal(f.p.tasks.t.acceptedAt, undefined);
  } finally { release.resolve(); f.cleanup(); }
});

for (const operation of ['accept', 'merge'] as const) {
  for (const mutation of ['scope', 'diff'] as const) {
    test(`write scope blocks ${operation} after reviewed ${mutation} changes`, async () => {
      const f = fixture(); try {
        f.p.tasks.t.allowedWritePaths = ['README.md']; fs.writeFileSync(path.join(f.wt, 'README.md'), 'Reviewed\n');
        await f.engine.review('p', 't'); if (operation === 'merge') await f.engine.accept('p', 't');
        if (mutation === 'scope') f.p.tasks.t.allowedWritePaths = ['README.md', 'outside.txt'];
        else { fs.writeFileSync(path.join(f.wt, 'outside.txt'), 'Unreviewed\n'); git(f.wt, ['add', '.']); git(f.wt, ['commit', '-m', 'After review']); }
        await assert.rejects(f.engine[operation]('p', 't'), /stale|scope|allowed|范围/i);
        assert.equal(f.p.tasks.t.mergedAt, undefined);
      } finally { f.cleanup(); }
    });
  }
}

test('manager adjustment cannot expand write scope', () => {
  const report = { ...pass, verdict: 'revise', revision: 'Expand scope', taskAdjustment: { reason: 'Need more files', instructions: 'Modify outside.txt', allowedWritePaths: ['outside.txt'] } };
  assert.throws(() => validateAssessment(report as never, criteria), /Invalid task adjustment/);
});

test('write scope checks staged paths even when unstaged edits restore baseline contents', async () => {
  const f = fixture(); try {
    seedScopeFiles(f, { 'outside.txt': 'Original\n' }); f.p.tasks.t.allowedWritePaths = ['README.md'];
    fs.writeFileSync(path.join(f.wt, 'outside.txt'), 'Forbidden staged contents\n'); git(f.wt, ['add', 'outside.txt']);
    fs.writeFileSync(path.join(f.wt, 'outside.txt'), 'Original\n');
    assert.equal(git(f.wt, ['diff', 'HEAD', '--', 'outside.txt']), '');
    await assert.rejects(f.engine.review('p', 't'), /scope|allowed|范围/i);
  } finally { f.cleanup(); }
});

for (const state of ['untracked', 'staged', 'committed'] as const) {
  test(`write scope preserves leading filename BOM in ${state} paths`, async () => {
    const f = fixture(); try {
      f.p.tasks.t.allowedWritePaths = ['safe']; const filename = '\uFEFFsafe';
      fs.writeFileSync(path.join(f.wt, filename), 'Not the allowed filename\n');
      if (state !== 'untracked') git(f.wt, ['add', filename]);
      if (state === 'committed') git(f.wt, ['commit', '-m', 'Add BOM filename']);
      await assert.rejects(f.engine.review('p', 't'), /scope|allowed|范围/i);
      assert.equal(f.p.tasks.t.reviewer, undefined);
    } finally { f.cleanup(); }
  });
}

function seedGitlink(f: ReturnType<typeof fixture>) {
  const initial = git(f.main, ['rev-parse', 'HEAD']);
  git(f.main, ['update-index', '--add', '--cacheinfo', `160000,${initial},module`]);
  git(f.main, ['commit', '-m', 'Seed existing gitlink']);
  git(f.wt, ['merge', 'main', '--no-edit']);
  return git(f.main, ['rev-parse', 'HEAD']);
}

for (const permitted of [false, true]) {
  test(`write scope rejects changed ${permitted ? 'allowed' : 'outside'} gitlink despite diff.ignoreSubmodules=all`, async () => {
    const f = fixture(); try {
      const next = seedGitlink(f); f.p.tasks.t.allowedWritePaths = permitted ? ['module'] : ['README.md'];
      git(f.wt, ['update-index', '--cacheinfo', `160000,${next},module`]); git(f.wt, ['commit', '-m', 'Change gitlink']);
      git(f.wt, ['config', 'diff.ignoreSubmodules', 'all']);
      assert.equal(git(f.wt, ['diff', '--raw', next, 'HEAD']), '');
      await assert.rejects(f.engine.review('p', 't'), permitted ? /submodule|子模块/i : /scope|范围/i);
      assert.equal(f.p.tasks.t.acceptedAt, undefined);
    } finally { f.cleanup(); }
  });
}

test('write scope permits an untouched baseline gitlink with ordinary allowed changes', async () => {
  const f = fixture(); try {
    seedGitlink(f); f.p.tasks.t.allowedWritePaths = ['README.md'];
    fs.writeFileSync(path.join(f.wt, 'README.md'), 'Allowed file update\n');
    await f.engine.review('p', 't'); assert.equal(f.p.tasks.t.phase, 'awaiting-user');
  } finally { f.cleanup(); }
});

test('write scope acceptance detects staged allowed edits hidden by restored worktree contents', async () => {
  const f = fixture(); try {
    f.p.tasks.t.allowedWritePaths = ['README.md'];
    fs.writeFileSync(path.join(f.wt, 'README.md'), 'Reviewed contents\n'); await f.engine.review('p', 't');
    fs.writeFileSync(path.join(f.wt, 'README.md'), 'Unreviewed staged contents\n'); git(f.wt, ['add', 'README.md']);
    fs.writeFileSync(path.join(f.wt, 'README.md'), 'Reviewed contents\n');
    assert.equal(git(f.wt, ['diff', 'HEAD', '--', 'README.md']), '');
    assert.notEqual(git(f.wt, ['diff', '--cached', 'HEAD', '--', 'README.md']), '');
    await assert.rejects(f.engine.accept('p', 't'), /stale review/i);
    assert.equal(f.p.tasks.t.acceptedAt, undefined);
  } finally { f.cleanup(); }
});

for (const staged of [false, true]) {
  test(`write scope acceptance detects changed allowed binary ${staged ? 'index' : 'worktree'} content`, async () => {
    const f = fixture(); try {
      f.p.tasks.t.allowedWritePaths = ['asset.bin'];
      fs.writeFileSync(path.join(f.wt, 'asset.bin'), Buffer.from([0, 1, 2, 3])); await f.engine.review('p', 't');
      fs.writeFileSync(path.join(f.wt, 'asset.bin'), Buffer.from([0, 1, 2, 4]));
      if (staged) {
        git(f.wt, ['add', 'asset.bin']);
        fs.writeFileSync(path.join(f.wt, 'asset.bin'), Buffer.from([0, 1, 2, 3]));
      }
      await assert.rejects(f.engine.accept('p', 't'), /stale review/i);
      assert.equal(f.p.tasks.t.acceptedAt, undefined);
    } finally { f.cleanup(); }
  });
}

test('write scope digest distinguishes binary payloads with identical textual Git diff summaries', () => {
  const f = fixture(); try {
    seedScopeFiles(f, { 'asset.bin': '\0baseline' }); f.p.tasks.t.allowedWritePaths = ['asset.bin'];
    fs.writeFileSync(path.join(f.wt, 'asset.bin'), Buffer.from([0, 1, 2, 3]));
    const firstSummary = git(f.wt, ['diff', '--numstat', 'HEAD', '--', 'asset.bin']);
    const firstDigest = workspaceDigest(f.wt, f.p.tasks.t, f.p.revision);
    fs.writeFileSync(path.join(f.wt, 'asset.bin'), Buffer.from([0, 1, 2, 4]));
    assert.equal(git(f.wt, ['diff', '--numstat', 'HEAD', '--', 'asset.bin']), firstSummary);
    assert.notEqual(workspaceDigest(f.wt, f.p.tasks.t, f.p.revision), firstDigest);
  } finally { f.cleanup(); }
});


test('write scope excludes ignored files and does not claim runtime write protection', async () => {
  const f = fixture(); try {
    seedScopeFiles(f, { '.gitignore': 'ignored.tmp\n' }); f.p.tasks.t.allowedWritePaths = [];
    fs.writeFileSync(path.join(f.wt, 'ignored.tmp'), 'Ignored content is outside the delivery gate');
    await f.engine.review('p', 't'); assert.equal(f.p.tasks.t.phase, 'awaiting-user');
    assert.equal(fs.readFileSync(path.join(f.wt, 'ignored.tmp'), 'utf8'), 'Ignored content is outside the delivery gate');
  } finally { f.cleanup(); }
});
