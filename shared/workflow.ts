export type Role = 'manager' | 'executor' | 'reviewer';
export type Harness = 'opencode' | 'codex' | 'claude' | 'dsh';
export interface ModelChoice { model: string; effort: string; endpointId?: string; }
export interface RoleProfile extends ModelChoice {
  harness: Harness; auto: boolean; candidates: ModelChoice[]; timeoutMinutes: number;
}
export interface Endpoint {
  id: string; name: string; protocol: 'openai' | 'anthropic'; baseUrl: string; apiKey?: string; hasKey?: boolean;
}
export interface Criterion { id: string; text: string; kind: 'objective' | 'human'; }
export interface ProposalTask {
  title: string; description: string; criteria: Criterion[]; dependsOn: number[]; complexity: 'small' | 'standard' | 'deep';
}
export interface Proposal { productSpec: string; technicalSpec: string; tasks: ProposalTask[]; }
export interface Finding { severity: 'blocking' | 'advisory'; text: string; }
export interface TaskAdjustment { reason: string; instructions: string; complexity?: 'small' | 'standard' | 'deep'; }
export interface Assessment {
  verdict: 'pass' | 'revise' | 'blocked'; summary: string;
  criteria: { id: string; status: 'pass' | 'fail' | 'unknown' | 'human'; evidence: string }[];
  findings: (Finding | string)[]; humanChecks: string[]; revision: string; taskAdjustment?: TaskAdjustment;
}
export interface ManagerRecord { id: string; at: number; taskId?: string; kind: 'assessment' | 'attention' | 'task-change' | 'authorization' | 'plan'; summary: string; assessment?: Assessment; before?: string; after?: string; }
export interface TaskPolicy {
  criteria: Criterion[]; dependsOn: string[]; complexity: 'small' | 'standard' | 'deep';
  override?: RoleProfile; rounds: number; phase: string;
  reviewer?: Assessment; manager?: Assessment; digest?: string; specRevision?: number; reviewBaseCommit?: string;
  acceptedAt?: number; mergedAt?: number; integratedCommit?: string;
  inputCommits?: Record<string, string>; generation?: number;
  managerInstructions?: string; attention?: { message: string; nextStep: string };
}
export interface WorkflowEvent {
  id: string; at: number; role: Role | 'system'; taskId?: string; type: string; content: string;
}
export interface ProjectWorkflow {
  idea: string; productSpec: string; technicalSpec: string; revision: number;
  roles: Record<Role, RoleProfile>; proposal?: Proposal;
  autonomous: boolean; autoAccept: boolean; autoMerge: boolean; maxConcurrency: number; maxRevisions: number;
  fullManaged: boolean; managerMayEdit: boolean; managerRecords: ManagerRecord[];
  paused: boolean; tasks: Record<string, TaskPolicy>; events: WorkflowEvent[];
}
export function defaults(): ProjectWorkflow {
  const profile = (): RoleProfile => ({ harness: 'opencode', model: 'opencode/space-bunny-free', effort: 'default', auto: false, candidates: [], timeoutMinutes: 30 });
  return { idea: '', productSpec: '', technicalSpec: '', revision: 1, roles: { manager: profile(), executor: profile(), reviewer: profile() }, autonomous: false, autoAccept: false, autoMerge: false, fullManaged: false, managerMayEdit: false, managerRecords: [], maxConcurrency: 2, maxRevisions: 2, paused: false, tasks: {}, events: [] };
}
export function selectProfile(profile: RoleProfile, complexity: TaskPolicy['complexity'] = 'standard'): RoleProfile {
  if (!profile.auto || !profile.candidates.length) return { ...profile };
  const index = complexity === 'small' ? 0 : complexity === 'deep' ? profile.candidates.length - 1 : Math.floor((profile.candidates.length - 1) / 2);
  return { ...profile, ...profile.candidates[index] };
}
export function validateProfile(p: RoleProfile): void {
  if (!p || !['opencode', 'codex', 'claude', 'dsh'].includes(p.harness) || typeof p.model !== 'string' || !p.model.trim() || p.model.length > 200) throw new Error('请选择 harness 和模型 / Select harness and model');
  if (!['default', 'low', 'medium', 'high', 'xhigh', 'max'].includes(p.effort)) throw new Error('无效思考等级 / Invalid effort');
  if (typeof p.auto !== 'boolean' || !Array.isArray(p.candidates) || p.candidates.length > 12 || !Number.isInteger(p.timeoutMinutes) || p.timeoutMinutes < 1 || p.timeoutMinutes > 180) throw new Error('无效自动选档或超时 / Invalid selection or timeout');
  for (const c of p.candidates) validateProfile({ ...p, ...c, auto: false, candidates: [] });
  if (p.endpointId && p.harness !== 'opencode') throw new Error('自定义接口通过 OpenCode 执行 / Custom endpoints require OpenCode');
}
export function parseJson<T>(text: string): T {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const source = match ? match[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(source) as T;
}
export function validateProposal(p: Proposal): void {
  if (!p || typeof p.productSpec !== 'string' || !p.productSpec.trim() || typeof p.technicalSpec !== 'string' || !Array.isArray(p.tasks) || !p.tasks.length || p.tasks.length > 30) throw new Error('方案缺少产品说明或任务 / Invalid proposal');
  for (const [i, t] of p.tasks.entries()) {
    if (typeof t.title !== 'string' || !t.title.trim() || t.title.length > 200 || typeof t.description !== 'string' || t.description.length > 5000 || !['small', 'standard', 'deep'].includes(t.complexity)) throw new Error('任务内容无效 / Invalid task');
    validateCriteria(t.criteria);
    if (!Array.isArray(t.dependsOn) || t.dependsOn.some(d => !Number.isInteger(d) || d < 0 || d >= i) || new Set(t.dependsOn).size !== t.dependsOn.length) throw new Error('依赖必须引用前面的任务 / Dependencies must reference earlier tasks');
  }
}
export function validateCriteria(criteria: Criterion[]): void {
  if (!Array.isArray(criteria) || !criteria.length || criteria.length > 30 || new Set(criteria.map(c => c.id)).size !== criteria.length || criteria.some(c => typeof c.id !== 'string' || !c.id || typeof c.text !== 'string' || !c.text.trim() || !['objective', 'human'].includes(c.kind))) throw new Error('需要明确验收条件 / Acceptance criteria required');
}
export function validateAssessment(a: Assessment, criteria: Criterion[]): void {
  if (!a || !['pass', 'revise', 'blocked'].includes(a.verdict) || typeof a.summary !== 'string' || !a.summary || typeof a.revision !== 'string' || !Array.isArray(a.criteria) || !Array.isArray(a.findings) || !Array.isArray(a.humanChecks) || a.humanChecks.some(s => typeof s !== 'string') || a.findings.some(f => typeof f !== 'string' && (!f || !['blocking', 'advisory'].includes(f.severity) || typeof f.text !== 'string' || !f.text.trim()))) throw new Error('审查结果格式无效 / Invalid review result');
  if (a.criteria.length !== criteria.length || new Set(a.criteria.map(c => c.id)).size !== criteria.length || criteria.some(c => !a.criteria.some(r => r.id === c.id)) || a.criteria.some(c => !['pass', 'fail', 'unknown', 'human'].includes(c.status) || typeof c.evidence !== 'string' || !c.evidence.trim())) throw new Error('审查缺少逐条证据 / Review requires evidence for every criterion');
  if (a.verdict === 'pass' && (a.findings.some(isBlockingFinding) || a.criteria.some(c => c.status === 'fail' || c.status === 'unknown'))) throw new Error('存在阻塞问题，不能推荐通过；可选建议须标记 advisory / Unresolved findings cannot pass');
  if (a.verdict === 'pass' && criteria.some(c => c.kind === 'human' && a.criteria.find(r => r.id === c.id)?.status !== 'human')) throw new Error('用户体验条件必须保留给用户 / Human experience must remain human');
  if (a.verdict === 'revise' && !a.revision.trim()) throw new Error('返工需要具体意见 / Revision instructions required');
  if (a.taskAdjustment && (a.verdict !== 'revise' || Object.keys(a.taskAdjustment).some(k => !['reason', 'instructions', 'complexity'].includes(k)) || typeof a.taskAdjustment.reason !== 'string' || !a.taskAdjustment.reason.trim() || a.taskAdjustment.reason.length > 2000 || typeof a.taskAdjustment.instructions !== 'string' || !a.taskAdjustment.instructions.trim() || a.taskAdjustment.instructions.length > 5000 || (a.taskAdjustment.complexity !== undefined && !['small', 'standard', 'deep'].includes(a.taskAdjustment.complexity)))) throw new Error('任务调整需要明确理由及执行说明，且不得修改验收标准 / Invalid task adjustment');
}
export function isBlockingFinding(f: Finding | string): boolean { return typeof f === 'string' || f.severity === 'blocking'; }
export function findingText(f: Finding | string): string { return typeof f === 'string' ? f : f.text; }
export function mayAutoAccept(t: TaskPolicy): boolean {
  return !!t.reviewer && !!t.manager && t.reviewer.verdict === 'pass' && t.manager.verdict === 'pass' && t.criteria.every(c => c.kind === 'objective') && [t.reviewer, t.manager].every(r => !r.findings.some(isBlockingFinding) && !r.humanChecks.length && r.criteria.every(c => c.status === 'pass'));
}
