import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaults, type Endpoint, type ProjectWorkflow, type WorkflowEvent, type ManagerRecord } from '@ai-agent-board/shared/workflow.js';
import type { WorkbenchSettings, ProjectMeta } from '../../../../shared/workbench.js';

export class WorkflowStore {
  private projects: Record<string, ProjectWorkflow> = {};
  private endpoints: Endpoint[] = [];
  private settings: WorkbenchSettings = { theme: 'sage' };
  private projectMeta: Record<string, ProjectMeta> = {};
  constructor(private file = process.env.SONAIL_WORKFLOW_FILE || path.resolve('data/sonail-workflow.json')) {
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.projects = saved.projects || {}; this.endpoints = saved.endpoints || [];
      this.settings = { theme: 'sage', ...saved.settings }; this.projectMeta = saved.projectMeta || {};
      for (const p of Object.values(this.projects)) {
        p.paused = true; // Restart never silently re-dispatches uncertain model calls.
        for (const t of Object.values(p.tasks)) if (['executing', 'reviewing', 'manager-check'].includes(t.phase)) t.phase = 'interrupted';
      }
    }
  }
  get(id: string): ProjectWorkflow {
    const p = this.projects[id] ||= defaults();
    p.managerRecords ||= []; p.fullManaged ??= false; p.managerMayEdit ??= false;
    return p;
  }
  record(id: string, data: Omit<ManagerRecord, 'id' | 'at'>): void {
    const p = this.get(id);
    p.managerRecords.push(JSON.parse(this.redact(JSON.stringify({ ...data, id: randomUUID(), at: Date.now() }))));
    p.managerRecords = p.managerRecords.slice(-150); this.save();
  }
  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ projects: this.projects, endpoints: this.endpoints, settings: this.settings, projectMeta: this.projectMeta }), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  event(id: string, data: Omit<WorkflowEvent, 'id' | 'at'>): void {
    const p = this.get(id);
    p.events.push({ ...data, content: this.redact(data.content).slice(-16000), id: randomUUID(), at: Date.now() });
    p.events = p.events.slice(-250); this.save();
  }
  listEndpoints(): Endpoint[] { return this.endpoints.map(({ apiKey, ...e }) => ({ ...e, hasKey: !!apiKey })); }
  workbenchSettings(): WorkbenchSettings { return { ...this.settings }; }
  saveWorkbenchSettings(input: WorkbenchSettings): WorkbenchSettings {
    if (!input || Object.keys(input).some(k => k !== 'theme') || !['sage', 'warm', 'indigo'].includes(input.theme)) throw new Error('外观设置无效 / Invalid appearance settings');
    this.settings = { theme: input.theme }; this.save(); return this.workbenchSettings();
  }
  metadata(id: string): ProjectMeta { return this.projectMeta[id] ? { ...this.projectMeta[id] } : { category: '', pinned: false }; }
  saveMetadata(id: string, input: Partial<ProjectMeta>): ProjectMeta {
    this.projectMeta[id] = { ...this.metadata(id), ...input }; this.save(); return this.metadata(id);
  }
  endpoint(id: string): Endpoint { const e = this.endpoints.find(e => e.id === id); if (!e) throw new Error('接口不存在 / Endpoint missing'); return e; }
  saveEndpoint(input: Endpoint): void {
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(input.id) || !input.name || !['openai', 'anthropic'].includes(input.protocol)) throw new Error('接口配置无效 / Invalid endpoint');
    const url = new URL(input.baseUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('接口地址无效 / Invalid endpoint URL');
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('远程接口需要 HTTPS / Remote endpoint requires HTTPS');
    const old = this.endpoints.find(e => e.id === input.id);
    const e = { id: input.id, name: input.name, protocol: input.protocol, baseUrl: input.baseUrl.replace(/\/$/, ''), apiKey: input.apiKey === undefined ? old?.apiKey : input.apiKey };
    this.endpoints = [...this.endpoints.filter(x => x.id !== e.id), e]; this.save();
  }
  redact(text: string): string { for (const e of this.endpoints) if (e.apiKey) text = text.split(e.apiKey).join('[REDACTED]'); return text; }
}
