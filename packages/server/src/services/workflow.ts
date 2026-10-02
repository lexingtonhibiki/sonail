import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import type { Task } from '../types.js';
import type { ProjectSummary, ProjectTaskPreview, ProjectMeta } from '../../../../shared/workbench.js';
import type { TaskRepository } from '../repositories/types.js';
import type { ProjectRepository } from '../repositories/project-types.js';
import type { AgentManager } from './agent-manager.js';
import { broadcastTaskUpdate } from '../routes/helpers.js';
import { HarnessProvider } from './harness.js';
import { WorkflowStore } from './workflow-store.js';
import { mayAutoAccept, parseJson, selectProfile, validateAssessment, validateCriteria, validateProfile, validateProposal, type Assessment, type ProjectWorkflow, type Proposal, type Role, type RoleProfile, type TaskPolicy } from '@ai-agent-board/shared/workflow.js';

export function git(cwd: string, args: string[]): string { return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true }).trim(); }
export function workspaceDigest(cwd: string, policy: TaskPolicy, revision: number): string {
  const hash = createHash('sha256');
  hash.update(git(cwd, ['rev-parse', 'HEAD'])); hash.update(git(cwd, ['diff', 'HEAD', '--']));
  hash.update(JSON.stringify({ criteria: policy.criteria, revision, ...(policy.managerInstructions ? { managerInstructions: policy.managerInstructions } : {}) }));
  const paths = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean).sort();
  for (const name of paths) { const file = path.resolve(cwd, name); if (!file.startsWith(path.resolve(cwd) + path.sep) || fs.lstatSync(file).isSymbolicLink()) throw new Error('工作区路径异常 / Unsafe workspace path'); hash.update(name); hash.update(fs.readFileSync(file)); }
  return hash.digest('hex');
}
const assessmentSchema = 'Return only JSON: {"verdict":"pass|revise|blocked","summary":"clear Chinese recommendation, why, and the next user action","criteria":[{"id":"exact criterion id","status":"pass|fail|unknown|human","evidence":"actual path, verification result, or why user experience is required"}],"findings":[{"severity":"blocking|advisory","text":"issue or optional improvement"}],"humanChecks":["only actual user experience checks"],"revision":"concrete executor correction instructions"}. Findings MUST use objects with explicit severity; optional polish is advisory and must not block pass. Human checks are NOT optional implementation improvements; independently verifiable correctness should be your responsibility. Cover every criterion exactly once. Never infer tests ran from the executor claim. Unknown or blocking is not pass. Criteria marked human MUST stay human. Do not lower requirements. Do not claim lack of a tool is a user experience requirement. If verdict is revise, manager may optionally add taskAdjustment:{"reason":"why the current execution approach is infeasible","instructions":"replacement or supplemental implementation method within the original scope and unchanged acceptance criteria","complexity":"small|standard|deep"}. Omit taskAdjustment if unnecessary. Never change the original goal, acceptance criteria, dependencies, permitted write scope, selected harness or budget.';

export class Workflow {
  readonly active = new Map<string, { projectId: string; cancel: () => Promise<unknown> }>();
  private projectLocks = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  constructor(readonly store: WorkflowStore, private repo: TaskRepository, private projects: ProjectRepository, private agents: AgentManager, private providerFactory = (p: RoleProfile, role: Role) => new HarnessProvider(p, role, p.endpointId ? store.endpoint(p.endpointId) : undefined)) {
    agents.setRedactor(text => store.redact(text));
  }
  private invalidate(t: TaskPolicy) {
    delete t.acceptedAt; delete t.mergedAt; delete t.integratedCommit;
    delete t.reviewer; delete t.manager; delete t.digest; delete t.reviewBaseCommit;
    delete t.attention;
  }
  private assertCapacity(p: ProjectWorkflow) {
    if (Object.values(p.tasks).filter(t => ['executing', 'reviewing', 'manager-check'].includes(t.phase)).length >= p.maxConcurrency) throw new Error('已达到项目并发上限 / Concurrency limit reached');
  }
  private registered(task: Task) {
    if (!task.repoPath || !task.worktreePath || !task.branchName || !git(task.repoPath, ['worktree', 'list', '--porcelain']).split(/\r?\n\r?\n/).some(block => block.split(/\r?\n/).includes(`worktree ${task.worktreePath!.replace(/\\/g, '/')}`) && block.split(/\r?\n/).includes(`branch refs/heads/${task.branchName}`))) throw new Error('任务工作区身份不匹配 / Worktree identity mismatch');
  }
  private ancestor(cwd: string, commit: string, ref: string): boolean {
    try { git(cwd, ['merge-base', '--is-ancestor', commit, ref]); return true; } catch { return false; }
  }
  private assertDependencies(task: Task, policy: TaskPolicy, p: ProjectWorkflow, inputs = true) {
    if (this.blockers(p, policy).length) throw new Error('依赖尚未通过并合入 / Dependencies require acceptance and integration');
    for (const id of policy.dependsOn) {
      const commit = p.tasks[id].integratedCommit!;
      if (!task.repoPath || !this.ancestor(task.repoPath, commit, task.baseBranch || 'main') || (inputs && (policy.inputCommits?.[id] !== commit || !task.worktreePath || !this.ancestor(task.worktreePath, commit, 'HEAD')))) throw new Error('上游版本已变化，请重新执行任务 / Dependency version changed; rerun task');
    }
  }
  async project(id: string) { const p = await this.projects.getById(id); if (!p) throw new Error('项目不存在 / Project missing'); return p; }
  async projectSummaries(): Promise<ProjectSummary[]> {
    const projects = await this.projects.getAllWithCounts();
    return Promise.all(projects.map(async project => {
      const tasks = await this.repo.getAll(true, project.id); const p = this.store.get(project.id);
      const integrated = tasks.filter(task => p.tasks[task.id]?.acceptedAt && p.tasks[task.id]?.mergedAt && p.tasks[task.id]?.integratedCommit).length;
      const running = tasks.filter(task => ['executing', 'reviewing', 'manager-check'].includes(p.tasks[task.id]?.phase || '') || task.agentStatus === 'executing' || task.agentStatus === 'planning').length;
      const attention = tasks.filter(task => ['awaiting-user', 'blocked', 'failed', 'needs-changes', 'interrupted', 'integration-blocked', 'accepted'].includes(p.tasks[task.id]?.phase || '')).length;
      const lastActivity = Math.max(project.updatedAt || project.createdAt || 0, ...tasks.map(task => task.completedAt || task.startedAt || task.createdAt), ...p.events.map(event => event.at));
      return { id: project.id, name: project.name, repoPath: project.repoPath, isDefault: project.isDefault, total: tasks.length, integrated, attention, running, complete: tasks.length > 0 && integrated === tasks.length && running === 0, lastActivity, meta: this.store.metadata(project.id) };
    }));
  }
  async projectTaskPreviews(id: string): Promise<ProjectTaskPreview[]> {
    await this.project(id); const p = this.store.get(id);
    return (await this.repo.getAll(true, id)).map(task => ({ id: task.id, title: task.title, phase: p.tasks[task.id]?.phase || task.columnId, integrated: !!(p.tasks[task.id]?.acceptedAt && p.tasks[task.id]?.mergedAt && p.tasks[task.id]?.integratedCommit) }));
  }
  async updateProjectMeta(id: string, input: Partial<ProjectMeta> & { archived?: boolean }): Promise<ProjectMeta> {
    await this.project(id);
    if (!input || Object.keys(input).some(key => !['category', 'pinned', 'archived'].includes(key)) || (input.category !== undefined && (typeof input.category !== 'string' || input.category.length > 60)) || (input.pinned !== undefined && typeof input.pinned !== 'boolean') || (input.archived !== undefined && typeof input.archived !== 'boolean')) throw new Error('项目分类配置无效 / Invalid project metadata');
    return this.exclusive(id, async () => {
      const patch: Partial<ProjectMeta> = {};
      if (input.category !== undefined) patch.category = input.category.trim();
      if (input.pinned !== undefined) patch.pinned = input.pinned;
      if (input.archived === true) {
        if ([...this.active.values()].some(run => run.projectId === id)) throw new Error('项目正在运行，请先暂停 / Project running');
        const summary = (await this.projectSummaries()).find(p => p.id === id)!;
        if (!summary.complete) throw new Error('全部任务验收并合入后才可归档 / All tasks must be accepted and integrated before archive');
        this.store.get(id).paused = true; patch.archivedAt = Date.now();
      } else if (input.archived === false) patch.archivedAt = undefined;
      const result = this.store.saveMetadata(id, patch);
      this.event(id, 'system', input.archived === true ? '项目已归档，保留全部记录和代码 / Project archived' : input.archived === false ? '项目已恢复，保持暂停；在项目设置中恢复推进 / Project restored and paused' : '项目分类或置顶已更新 / Project organization updated');
      return result;
    });
  }
  assertNotArchived(id: string) { if (this.store.metadata(id).archivedAt) throw new Error('项目已归档，请先在项目总览恢复 / Restore the archived project first'); }
  private async exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (this.projectLocks.has(id)) throw new Error('项目操作进行中，请稍候 / Project action in progress');
    this.projectLocks.add(id); try { return await fn(); } finally { this.projectLocks.delete(id); }
  }
  busy(id: string) { return [...this.active.values()].some(a => a.projectId === id) || this.projectLocks.has(id) || Object.values(this.store.get(id).tasks).some(t => ['executing', 'reviewing', 'manager-check'].includes(t.phase)); }
  private event(id: string, role: Role | 'system', content: string, taskId?: string, type = 'status') { this.store.event(id, { role, content, taskId, type }); }
  saveSettings(id: string, input: Partial<ProjectWorkflow>): ProjectWorkflow {
    this.assertNotArchived(id);
    if (this.busy(id)) throw new Error('运行中不能更改项目规格或角色 / Stop running work before changing settings');
    const p = this.store.get(id);
    if (input.roles) for (const role of ['manager', 'executor', 'reviewer'] as Role[]) validateProfile(input.roles[role]);
    for (const name of ['idea', 'productSpec', 'technicalSpec'] as const) if (input[name] !== undefined && (typeof input[name] !== 'string' || input[name]!.length > 100000)) throw new Error('规格内容无效 / Invalid specification');
    for (const name of ['autonomous', 'autoAccept', 'autoMerge', 'paused', 'fullManaged', 'managerMayEdit'] as const) if (input[name] !== undefined && typeof input[name] !== 'boolean') throw new Error('授权配置必须为布尔值 / Invalid authorization');
    if (input.maxConcurrency !== undefined && (!Number.isInteger(input.maxConcurrency) || input.maxConcurrency < 1 || input.maxConcurrency > 4)) throw new Error('并发范围为 1–4 / Concurrency range 1–4');
    if (input.maxRevisions !== undefined && (!Number.isInteger(input.maxRevisions) || input.maxRevisions < 0 || input.maxRevisions > 5)) throw new Error('返工上限为 0–5 / Revision cap 0–5');
    const changed = ['idea', 'productSpec', 'technicalSpec'].some(k => input[k as 'idea'] !== undefined && input[k as 'idea'] !== p[k as 'idea']);
    if (changed) {
      p.revision++; delete p.proposal; p.paused = true;
      for (const t of Object.values(p.tasks)) { this.invalidate(t); t.generation = (t.generation || 0) + 1; t.phase = 'spec-changed'; }
    }
    const oldManaged = p.fullManaged;
    for (const key of ['idea', 'productSpec', 'technicalSpec', 'roles', 'autonomous', 'autoAccept', 'autoMerge', 'managerMayEdit', 'maxConcurrency', 'maxRevisions', 'paused'] as const) if (input[key] !== undefined) Object.assign(p, { [key]: input[key] });
    if (input.fullManaged !== undefined) { p.autonomous = p.autoAccept = p.autoMerge = p.managerMayEdit = input.fullManaged; }
    p.fullManaged = p.autonomous && p.autoAccept && p.autoMerge && p.managerMayEdit;
    if (p.fullManaged !== oldManaged) this.store.record(id, { kind: 'authorization', summary: p.fullManaged ? '已开启完全托管：自动推进、客观验收、合入、限次返工及补充执行说明；仍等待你的真实体验，不修改原始目标和验收标准。' : '完全托管已关闭或改为自定义授权；运行中的会话如需立即停止，请暂停项目。' });
    this.event(id, 'system', changed ? '需求已修订；旧验收失效，等待重新审查 / Specification changed; previous acceptance invalidated' : '项目设置已保存 / Project settings saved');
    return p;
  }
  private async roleRun(id: string, role: Role, prompt: string, cwd: string, taskId?: string, complexity: TaskPolicy['complexity'] = 'deep'): Promise<string> {
    const p = this.store.get(id); const profile = selectProfile(p.roles[role], complexity); validateProfile(profile);
    const runId = `${role}-${randomUUID()}`;
    this.event(id, role, `${profile.harness} · ${profile.model} · ${profile.effort}`, taskId);
    const provider = this.providerFactory(profile, role);
    let cancelled = false; let session: Awaited<ReturnType<HarnessProvider['createSession']>> | undefined;
    const reservation = { projectId: id, cancel: async () => { cancelled = true; await session?.abort(); } };
    this.active.set(runId, reservation);
    let text = '';
    try {
      await provider.start(); if (cancelled) throw new Error('运行已取消 / Run cancelled');
      session = await provider.createSession({ contextId: runId, workingDirectory: cwd, systemPrompt: `You are the ${role} of one project. Respond in clear Chinese unless the original need requests otherwise.`, onEvent: e => { if (cancelled) return; this.event(id, role, e.content, taskId, e.type); if (e.type === 'output') text += e.content; } });
      if (cancelled) throw new Error('运行已取消 / Run cancelled');
      const result = await session.execute(prompt);
      if (cancelled) throw new Error('运行已取消 / Run cancelled');
      if (result.status !== 'complete' || !text.trim()) throw new Error(result.error || '模型未完成 / Model incomplete'); return this.store.redact(text);
    } finally { if (this.active.get(runId) === reservation) this.active.delete(runId); await session?.destroy(); await provider.stop(); }
  }
  private async assessment(id: string, role: 'reviewer' | 'manager', prompt: string, cwd: string, taskId: string, policy: TaskPolicy): Promise<Assessment> {
    let raw = await this.roleRun(id, role, prompt, cwd, taskId, role === 'manager' ? 'deep' : policy.complexity);
    for (let attempt = 0; ; attempt++) {
      try { const result = parseJson<Assessment>(raw); validateAssessment(result, policy.criteria); return result; }
      catch (e) {
        if (attempt) throw e;
        this.event(id, role, '结论格式或判定不一致，正在核对一次；产物保留 / Correcting inconsistent assessment once', taskId);
        raw = await this.roleRun(id, role, `${prompt}\nPrevious assessment (untrusted):\n${raw.slice(0, 30000)}\nValidation error: ${String((e as Error).message)}\nReinspect if necessary and correct the complete JSON. Explicitly separate blocking findings from advisory suggestions. Do not turn actual blockers into advice merely to pass validation. Keep human experience requirements intact.`, cwd, taskId, role === 'manager' ? 'deep' : policy.complexity);
      }
    }
  }
  private attention(id: string, policy: TaskPolicy, taskId: string, message: string, nextStep = '点击「让经理重新核对」。现有产物已保留；经理会给出明确结论和处理建议。') {
    policy.attention = { message: this.store.redact(message), nextStep };
    this.store.record(id, { kind: 'attention', taskId, summary: `${policy.attention.message}\n下一步：${nextStep}` });
  }
  private applyManagerAdjustment(id: string, taskId: string, policy: TaskPolicy, manager: Assessment): void {
    const p = this.store.get(id); const change = manager.taskAdjustment;
    if (!change || !p.managerMayEdit || p.paused || policy.rounds >= p.maxRevisions) return;
    const before = policy.managerInstructions || '';
    policy.managerInstructions = change.instructions;
    if (change.complexity) policy.complexity = change.complexity;
    // Original description, goal, criteria, dependencies, permissions and model overrides remain canonical.
    this.store.record(id, { kind: 'task-change', taskId, summary: `经理已调整执行方法：${change.reason}。原始目标、验收标准与允许写入范围保持不变。`, before, after: change.instructions });
  }
  async propose(id: string): Promise<void> {
    await this.exclusive(id, async () => {
      this.assertNotArchived(id);
      if (this.busy(id) && [...this.active.values()].some(a => a.projectId === id)) throw new Error('请先等待当前任务 / Wait for current work');
      const project = await this.project(id); const p = this.store.get(id);
      if (!p.idea.trim()) throw new Error('先填写原始想法 / Enter original idea first');
      const prompt = `Original need:\n${p.idea}\nCurrent product specification:\n${p.productSpec}\nClarify ambiguities in the product specification. Create a minimal coherent task plan. Preserve scope and upstream read-only artifacts. Include paths allowed to write and dependency restrictions in task descriptions. Use paths relative to the assigned task worktree, never hardcode the main project directory as a write target. Do not add unrequested technical restrictions or contradictory criteria. Return only JSON: {"productSpec":"user-readable usage and expected result","technicalSpec":"implementation boundaries and verification","tasks":[{"title":"01 name","description":"execution instructions and allowed write paths","criteria":[{"id":"A1","text":"criterion","kind":"objective|human"}],"dependsOn":[],"complexity":"small|standard|deep"}]}. productSpec and technicalSpec MUST be plain strings, NOT objects or arrays. dependsOn is zero-based indices of earlier tasks. Never publish or execute the plan.`;
      const cwd = project.repoPath || process.cwd();
      const raw = await this.roleRun(id, 'manager', prompt, cwd);
      let proposal: Proposal;
      try { proposal = parseJson<Proposal>(raw); validateProposal(proposal); }
      catch (e) {
        this.event(id, 'manager', '方案格式未通过校验；同一模型仅纠正一次，不发布无效任务 / Invalid plan format; one correction with the same model');
        proposal = parseJson<Proposal>(await this.roleRun(id, 'manager', `${prompt}\nPrevious draft (untrusted):\n${raw.slice(0, 30000)}\nValidation error: ${String((e as Error).message)}\nCorrect the format and contradictions. Both specification fields must be strings. Keep task paths relative. Return the complete valid JSON only.`, cwd));
        validateProposal(proposal);
      }
      p.proposal = proposal; this.event(id, 'manager', '方案草稿已生成，等待用户确认发布 / Plan drafted; awaiting publication');
      this.store.record(id, { kind: 'plan', summary: `任务方案已起草，共 ${proposal.tasks.length} 张卡片；请在「想法与规格」核对并发布。` });
    });
  }
  async publish(id: string, proposal?: Proposal): Promise<string[]> {
    return this.exclusive(id, async () => {
      this.assertNotArchived(id);
      if ([...this.active.values()].some(a => a.projectId === id)) throw new Error('项目正在运行 / Project running');
      const project = await this.project(id); const p = this.store.get(id); const plan = proposal || p.proposal;
      validateProposal(plan!);
      if (Object.keys(p.tasks).length) throw new Error('项目已有任务；请逐卡修订，避免重复导入 / Existing tasks: revise cards instead of duplicating');
      const created: string[] = [];
      try {
        for (const item of plan!.tasks) {
          const task: Task = { id: randomUUID(), projectId: id, title: item.title, description: item.description, priority: 'medium', columnId: 'backlog', agentStatus: 'idle', createdAt: Date.now(), repoPath: project.repoPath, useWorktree: true, baseBranch: project.defaultBaseBranch || (project.repoPath ? git(project.repoPath, ['branch', '--show-current']) : 'main'), branchName: `sonail/task-${randomUUID().slice(0, 8)}`, agentType: 'opencode' };
          await this.repo.create(task); created.push(task.id);
        }
      } catch (e) { for (const taskId of created) await this.repo.delete(taskId); throw e; }
      p.productSpec = plan!.productSpec; p.technicalSpec = plan!.technicalSpec; p.revision++;
      plan!.tasks.forEach((item, i) => { p.tasks[created[i]] = { criteria: item.criteria, dependsOn: item.dependsOn.map(n => created[n]), complexity: item.complexity, rounds: 0, phase: 'ready' }; });
      delete p.proposal; this.event(id, 'system', `已发布 ${created.length} 张任务卡 / Published ${created.length} tasks`);
      for (const taskId of created) broadcastTaskUpdate((await this.repo.getById(taskId))!);
      return created;
    });
  }
  async task(id: string, taskId: string): Promise<{ task: Task; policy: TaskPolicy; project: ProjectWorkflow }> {
    const task = await this.repo.getById(taskId); const project = this.store.get(id); const policy = project.tasks[taskId];
    if (!task || task.projectId !== id || !policy) throw new Error('任务不属于此项目 / Task does not belong to project');
    return { task, policy, project };
  }
  async editTask(id: string, taskId: string, input: { title: string; description: string; criteria: TaskPolicy['criteria']; override?: RoleProfile }): Promise<void> {
    this.assertNotArchived(id);
    const { policy } = await this.task(id, taskId);
    if (this.busy(id)) throw new Error('运行中不能修订 / Stop work before revision');
    if (!input.title?.trim() || input.title.length > 200 || typeof input.description !== 'string' || input.description.length > 5000) throw new Error('任务内容无效 / Invalid task');
    validateCriteria(input.criteria); if (input.override) validateProfile(input.override);
    await this.reopen(id, taskId, '任务规格已修订 / Task revised');
    policy.criteria = input.criteria; policy.override = input.override; policy.rounds = 0;
    const updated = await this.repo.update(taskId, { title: input.title, description: input.description }); if (updated) broadcastTaskUpdate(updated); this.store.save();
  }
  blockers(p: ProjectWorkflow, policy: TaskPolicy): string[] { return policy.dependsOn.filter(id => !p.tasks[id]?.acceptedAt || !p.tasks[id]?.mergedAt || !p.tasks[id]?.integratedCommit || p.tasks[id]?.specRevision !== p.revision); }
  async start(id: string, taskId: string, correction = ''): Promise<void> {
    await this.exclusive(id, async () => {
      this.assertNotArchived(id);
      const { task, policy, project: p } = await this.task(id, taskId);
      if (this.active.has(taskId) || this.agents.isRunning(taskId) || ['reviewing', 'manager-check'].includes(policy.phase)) throw new Error('任务正在运行 / Task already running');
      if (policy.acceptedAt) throw new Error('先重新打开已完成任务 / Reopen accepted task first');
      this.assertDependencies(task, policy, p, false); this.assertCapacity(p);
      if (!task.repoPath) throw new Error('先为项目配置本地 Git 路径 / Configure a local Git project');
      git(task.repoPath, ['rev-parse', '--verify', 'HEAD']);
      if (task.worktreePath) {
        this.registered(task);
        const base = git(task.repoPath, ['rev-parse', task.baseBranch || 'main']);
        if (!this.ancestor(task.worktreePath, base, 'HEAD')) {
          if (git(task.worktreePath, ['status', '--porcelain'])) throw new Error('旧任务工作区有未提交修改；请先处理后再更新上游 / Dirty task workspace; preserve edits before updating dependencies');
          try { git(task.worktreePath, ['-c', 'user.name=Sonail Task', '-c', 'user.email=sonail-task@localhost', 'merge', base, '--no-edit']); }
          catch { try { git(task.worktreePath, ['merge', '--abort']); } catch {} throw new Error('更新上游发生冲突；任务产物保留，请处理后重试 / Dependency update conflict; task work preserved'); }
        }
      }
      const profile = selectProfile(policy.override || p.roles.executor, policy.complexity); validateProfile(profile);
      const snapshot: Task = { ...task, runProfile: profile, runEndpoint: profile.endpointId ? this.store.endpoint(profile.endpointId) : undefined, description: `${task.description}\n\nProduct specification:\n${p.productSpec}\nTechnical boundaries:\n${p.technicalSpec}\nAcceptance:\n${JSON.stringify(policy.criteria)}\nDependencies are read-only. Do not modify upstream deliverables. Manager guidance may adjust implementation method ONLY, never override original goal, write scope, acceptance criteria or technical boundaries.\n${policy.managerInstructions ? `Manager execution guidance:\n${policy.managerInstructions}\n` : ''}${correction ? `Revision instructions:\n${correction}` : ''}`, agentType: profile.harness === 'dsh' ? 'opencode' : profile.harness, useWorktree: true };
      const generation = policy.generation = (policy.generation || 0) + 1;
      const current = () => policy.generation === generation;
      this.invalidate(policy); policy.inputCommits = Object.fromEntries(policy.dependsOn.map(d => [d, p.tasks[d].integratedCommit!])); policy.phase = 'executing';
      const reservation = { projectId: id, cancel: () => this.agents.stopAgent(taskId) };
      this.active.set(taskId, reservation); this.store.save();
      const updated = await this.repo.update(taskId, { columnId: 'in-progress', agentStatus: 'planning', startedAt: Date.now(), completedAt: undefined }); if (updated) broadcastTaskUpdate(updated);
      if (!current()) return;
      this.event(id, 'executor', `${profile.harness} · ${profile.model} · ${profile.effort}`, taskId);
      this.agents.startAgent(snapshot, async status => {
        if (!current()) return;
        const next = await this.repo.update(taskId, { agentStatus: status, ...(status === 'complete' ? { columnId: 'review', completedAt: Date.now() } : {}) }); if (next) broadcastTaskUpdate(next);
        if (!current()) return;
        if (status === 'complete' || status === 'failed') {
          if (this.active.get(taskId) === reservation) this.active.delete(taskId); policy.phase = status === 'complete' ? 'review-ready' : 'failed'; this.store.save();
          if (status === 'failed') this.attention(id, policy, taskId, '执行未完成，请检查下方执行记录。', '可填写反馈后让经理重新核对，或修正模型/连接配置后重新启动。');
          if (status === 'complete') void this.review(id, taskId).catch(() => {});
        }
      }, async worktreePath => { if (!current()) return; const next = await this.repo.update(taskId, { worktreePath }); if (next) broadcastTaskUpdate(next); });
    });
  }
  async review(id: string, taskId: string): Promise<void> {
    this.assertNotArchived(id);
    const { task, policy, project: p } = await this.task(id, taskId);
    if (this.projectLocks.has(id)) throw new Error('项目操作进行中，请稍候 / Project action in progress');
    if (this.active.has(taskId) || ['executing', 'reviewing', 'manager-check'].includes(policy.phase)) throw new Error('任务仍在运行 / Task is running');
    if (!task.worktreePath) throw new Error('没有任务 worktree，不能审查 / Task worktree required');
    this.assertDependencies(task, policy, p); this.assertCapacity(p);
    const generation = policy.generation = (policy.generation || 0) + 1;
    const current = () => policy.generation === generation;
    const reservation = { projectId: id, cancel: async () => {} };
    const release = () => { if (this.active.get(taskId) === reservation) this.active.delete(taskId); };
    this.active.set(taskId, reservation);
    policy.phase = 'reviewing'; this.invalidate(policy); this.store.save();
    try {
      // Only commit this task's registered worktree, never the user's main tree.
      this.registered(task);
      if (git(task.worktreePath, ['status', '--porcelain'])) {
        git(task.worktreePath, ['add', '-A']);
        git(task.worktreePath, ['-c', 'user.name=Sonail Task', '-c', 'user.email=sonail-task@localhost', 'commit', '-m', `Sonail task ${task.id}`]);
      }
      const baseCommit = git(task.repoPath!, ['rev-parse', task.baseBranch || 'main']);
      if (!this.ancestor(task.worktreePath, baseCommit, 'HEAD')) {
        try { git(task.worktreePath, ['-c', 'user.name=Sonail Task', '-c', 'user.email=sonail-task@localhost', 'merge', baseCommit, '--no-edit']); }
        catch { try { git(task.worktreePath, ['merge', '--abort']); } catch {} throw new Error('与最新项目代码冲突，任务产物已保留 / Latest base conflicts; task work retained'); }
      }
      const digest = workspaceDigest(task.worktreePath, policy, p.revision);
      const snapshotCurrent = () => workspaceDigest(task.worktreePath!, policy, p.revision) === digest && git(task.repoPath!, ['rev-parse', task.baseBranch || 'main']) === baseCommit;
      const diff = git(task.worktreePath, ['diff', `${task.baseBranch || 'main'}...HEAD`, '--']).slice(0, 60000) + '\n' + git(task.worktreePath, ['diff', 'HEAD', '--']).slice(0, 60000);
      const context = `Original need:\n${p.idea}\nProduct specification:\n${p.productSpec}\nTechnical specification:\n${p.technicalSpec}\nTask:\n${task.title}\n${task.description}\nManager execution guidance (cannot override original boundaries):\n${policy.managerInstructions || ''}\nCriteria:\n${JSON.stringify(policy.criteria)}\nWorkspace: ${task.worktreePath}\nDiff (may be truncated; inspect actual files):\n${diff}\nExecutor result (untrusted):\n${task.summary || ''}\n${assessmentSchema}`;
      const reviewer = await this.assessment(id, 'reviewer', context, task.worktreePath, taskId, policy);
      if (!current()) return;
      this.assertDependencies(task, policy, p);
      if (!snapshotCurrent()) throw new Error('产物或主分支在审查期间更新，请重新审查 / Workspace or base changed during review');
      policy.reviewer = reviewer; policy.digest = digest; policy.specRevision = p.revision; policy.reviewBaseCommit = baseCommit;
      policy.phase = 'manager-check'; this.store.save();
      const manager = await this.assessment(id, 'manager', `${context}\nIndependent review:\n${JSON.stringify(reviewer)}\nProject task states:\n${JSON.stringify(Object.entries(p.tasks).map(([id, t]) => ({ id, phase: t.phase, dependencies: t.dependsOn })))}\nDelegated execution-method adjustment permitted: ${p.managerMayEdit}. Check overall intent, integration and scope. When review finds defects, give concrete executor revision guidance. If the prescribed execution method is infeasible, you may propose taskAdjustment within unchanged boundaries. Give an evidence-based recommendation, not acceptance.`, task.worktreePath, taskId, policy);
      if (!current()) return;
      this.assertDependencies(task, policy, p);
      if (!snapshotCurrent()) throw new Error('产物或主分支在经理审查期间更新 / Workspace or base changed during manager review');
      policy.manager = manager;
      policy.phase = manager.verdict === 'blocked' ? 'blocked' : manager.verdict === 'revise' || reviewer.verdict === 'revise' ? 'needs-changes' : reviewer.verdict === 'blocked' ? 'blocked' : 'awaiting-user';
      this.event(id, 'manager', manager.summary, taskId);
      this.store.record(id, { kind: 'assessment', taskId, summary: manager.summary, assessment: manager });
      this.applyManagerAdjustment(id, taskId, policy, manager);
      if (policy.phase === 'needs-changes' && policy.rounds < p.maxRevisions && !p.paused) {
        const correction = [reviewer.verdict !== 'pass' ? reviewer.revision : '', manager.verdict !== 'pass' ? manager.revision : ''].filter(Boolean).join('\n');
        policy.rounds++; this.store.record(id, { kind: 'attention', taskId, summary: `经理已安排第 ${policy.rounds} 轮返工（上限 ${p.maxRevisions}）：${correction}` });
        release(); this.store.save(); await this.start(id, taskId, correction);
      }
      else if (policy.phase !== 'awaiting-user') this.attention(id, policy, taskId, manager.summary, p.paused ? '项目已暂停。查看经理修改意见后，可恢复项目或手动启动返工。' : policy.rounds >= p.maxRevisions ? `自动返工已达 ${p.maxRevisions} 轮上限。查看经理意见，可手动返工或调整返工上限。` : '经理暂不能放行。查看阻塞项，填写反馈后点击「让经理重新核对」。');
      else if (!p.paused && p.autoAccept && mayAutoAccept(policy)) { await this.accept(id, taskId, true); if (p.autoMerge) await this.merge(id, taskId); }
    } catch (e) { if (current()) { policy.phase = 'blocked'; this.attention(id, policy, taskId, String((e as Error).message)); this.event(id, 'system', String((e as Error).message), taskId, 'error'); throw e; } }
    finally { release(); this.store.save(); }
  }
  private assertFresh(task: Task, policy: TaskPolicy, p: ProjectWorkflow) {
    this.assertDependencies(task, policy, p); this.registered(task);
    if (!task.worktreePath || !policy.digest || policy.specRevision !== p.revision || workspaceDigest(task.worktreePath, policy, p.revision) !== policy.digest || !task.repoPath || policy.reviewBaseCommit !== git(task.repoPath, ['rev-parse', task.baseBranch || 'main'])) throw new Error('产物、规格或项目主分支已经变化，必须重新审查 / Stale review; re-review required');
  }
  async accept(id: string, taskId: string, automatic = false): Promise<void> {
    this.assertNotArchived(id);
    const { task, policy, project: p } = await this.task(id, taskId);
    if (policy.phase !== 'awaiting-user' || policy.reviewer?.verdict !== 'pass' || policy.manager?.verdict !== 'pass' || (automatic && !mayAutoAccept(policy))) throw new Error('审查尚未通过 / Review not passed');
    this.assertFresh(task, policy, p); const generation = policy.generation;
    const next = await this.repo.update(taskId, { columnId: 'done' }); if (next) broadcastTaskUpdate(next);
    if (policy.generation !== generation || policy.phase !== 'awaiting-user' || (automatic && p.paused)) throw new Error('验收期间状态变化，请重新确认 / State changed during acceptance');
    this.assertFresh(task, policy, p); policy.acceptedAt = Date.now(); policy.phase = 'accepted';
    this.event(id, 'system', automatic ? '按已授权客观规则自动验收 / Authorized objective acceptance' : '用户已确认验收 / User accepted', taskId);
  }
  async merge(id: string, taskId: string): Promise<void> {
    await this.exclusive(id, async () => {
      this.assertNotArchived(id);
      const { task, policy, project: p } = await this.task(id, taskId);
      if (!policy.acceptedAt || policy.mergedAt) throw new Error('尚未验收或已经合入 / Not accepted or already integrated');
      this.assertFresh(task, policy, p);
      if (!task.repoPath || git(task.repoPath, ['status', '--porcelain'])) throw new Error('主项目有未提交修改，请先自行处理 / Main workspace must be clean');
      const commit = git(task.worktreePath!, ['rev-parse', 'HEAD']);
      await this.agents.mergeLocal(task, { baseCommit: policy.reviewBaseCommit!, taskCommit: commit });
      if (!this.ancestor(task.repoPath, commit, task.baseBranch || 'main')) throw new Error('合入版本未核实 / Integration not verified');
      policy.integratedCommit = commit; policy.mergedAt = Date.now(); policy.phase = 'integrated';
      this.event(id, 'system', '任务分支已合入；worktree 保留供查看 / Task branch integrated; worktree retained', taskId);
      for (const t of Object.values(p.tasks)) if (t.phase === 'dependency-invalidated' && !this.blockers(p, t).length) t.phase = 'ready';
      this.store.save();
    });
  }
  async reopen(id: string, taskId: string, reason: string): Promise<void> {
    this.assertNotArchived(id);
    if (typeof reason !== 'string' || !reason.trim()) throw new Error('请输入重新打开原因 / Reopen reason required');
    if (this.projectLocks.has(id)) throw new Error('项目操作进行中，请稍候再撤回 / Wait for project action before reopening');
    const { project: p } = await this.task(id, taskId); await this.pause(id);
    const affected = new Set([taskId]); let changed = true;
    while (changed) { changed = false; for (const [key, t] of Object.entries(p.tasks)) if (!affected.has(key) && t.dependsOn.some(d => affected.has(d))) { affected.add(key); changed = true; } }
    for (const key of affected) {
      await this.agents.stopAgent(key);
      for (const [runId, active] of this.active) if (active.projectId === id) { await active.cancel(); this.active.delete(runId); }
      const t = p.tasks[key]; this.invalidate(t); t.generation = (t.generation || 0) + 1;
      t.phase = key === taskId ? 'ready' : 'dependency-invalidated'; t.rounds = 0;
      const next = await this.repo.update(key, { columnId: key === taskId ? 'backlog' : 'review', agentStatus: 'idle' }); if (next) broadcastTaskUpdate(next);
    }
    this.event(id, 'system', `重新打开：${reason}；相关任务已暂停，未回退代码 / Reopened; dependent work paused; code not reverted`, taskId);
  }
  async pause(id: string) {
    const p = this.store.get(id); p.paused = true;
    // Invalidate callbacks before awaiting any provider cleanup.
    for (const t of Object.values(p.tasks)) if (['executing', 'reviewing', 'manager-check'].includes(t.phase)) { t.generation = (t.generation || 0) + 1; t.phase = 'interrupted'; }
    this.store.save();
    for (const [runId, active] of [...this.active]) if (active.projectId === id) {
      await active.cancel(); this.active.delete(runId);
      if (p.tasks[runId]) {
        p.tasks[runId].phase = 'interrupted';
        const task = await this.repo.update(runId, { agentStatus: 'failed' }); if (task) broadcastTaskUpdate(task);
      }
    }
    this.event(id, 'system', '项目已暂停 / Project paused');
  }
  async artifacts(id: string, taskId: string): Promise<{ path: string; content?: string; note?: string }[]> {
    const { task, policy } = await this.task(id, taskId); this.registered(task);
    const root = fs.realpathSync(task.worktreePath!);
    const files = [...new Set(git(root, ['diff', '--name-only', `${policy.reviewBaseCommit || task.baseBranch || 'main'}...HEAD`, '--']).split(/\r?\n/).filter(Boolean))].slice(0, 12);
    let bytes = 0;
    return files.map(name => {
      const file = path.resolve(root, name);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return { path: name, note: '已删除或不在工作区 / Deleted or outside workspace' };
      const real = fs.realpathSync(file);
      if (!real.startsWith(root + path.sep) || !fs.statSync(real).isFile()) return { path: name, note: '不预览工作区外链接 / External links are not previewed' };
      const size = fs.statSync(real).size;
      if (size > 50000 || bytes + size > 200000) return { path: name, note: '文件较大，请在原生工具查看 / View large file in native tool' };
      if (!/\.(md|txt|json|ya?ml|csv|ts|tsx|js|jsx|py|html|css|toml|xml|svg|sh|ps1)$/i.test(name)) return { path: name, note: '此类型请在原生工具查看 / View this file type in native tool' };
      const content = fs.readFileSync(real, 'utf8'); bytes += size;
      if (content.includes('\0')) return { path: name, note: '二进制文件 / Binary file' };
      return { path: name, content: this.store.redact(content) };
    });
  }
  startScheduler() { this.timer = setInterval(() => { void this.pump().catch(() => {}); }, 3000); this.timer.unref(); }
  private async pump() {
    for (const project of await this.projects.getAllWithCounts()) {
      const p = this.store.get(project.id); if (this.store.metadata(project.id).archivedAt || !p.autonomous || p.paused || this.projectLocks.has(project.id)) continue;
      for (const [id, policy] of Object.entries(p.tasks)) {
        if (policy.phase === 'accepted' && p.autoMerge) {
          try { await this.merge(project.id, id); }
          catch (e) { policy.phase = 'integration-blocked'; this.attention(project.id, policy, id, String((e as Error).message), '产物已保留。先处理合入阻塞项，再点击「合入项目并解锁下游」。'); }
        }
        else if (policy.phase === 'ready' && !this.blockers(p, policy).length) { try { await this.start(project.id, id); } catch (e) { if (!String((e as Error).message).includes('Concurrency')) { policy.phase = 'blocked'; this.attention(project.id, policy, id, String((e as Error).message), '查看经理记录中的原因，处理后可重新启动任务。'); } break; } }
      }
    }
  }
  async shutdown() { if (this.timer) clearInterval(this.timer); for (const active of this.active.values()) await active.cancel(); }
}
