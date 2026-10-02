import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentProvider, AgentSession, AgentSessionConfig } from '@codewithdan/agent-sdk-core';
import type { Codex } from '@openai/codex-sdk';
import { type RoleProfile, type Endpoint, type Role } from '../../../../shared/workflow.js';

export function effortFor(profile: RoleProfile): string | undefined {
  if (profile.effort === 'default') return undefined;
  if (profile.endpointId) throw new Error('自定义接口尚未声明思考能力，请选模型默认 / Custom endpoint effort capability is unknown; select model default');
  if (profile.harness === 'codex' && profile.effort === 'max') throw new Error('Codex 支持到 xhigh，请手动选择 / Codex supports xhigh, not max');
  return profile.effort;
}
export function openCodeRequest(profile: RoleProfile, sessionID: string, directory: string, prompt: string, role: Role) {
  const split = profile.model.indexOf('/');
  if (split < 1 && !profile.endpointId) throw new Error('OpenCode 模型格式为 provider/model / Use provider/model');
  return { sessionID, directory, model: { providerID: profile.endpointId ? 'sonail-custom' : profile.model.slice(0, split), modelID: profile.endpointId ? profile.model : profile.model.slice(split + 1) }, variant: effortFor(profile), parts: [{ type: 'text' as const, text: prompt }], ...(role !== 'executor' ? { tools: { bash: false, edit: false, write: false, task: false, apply_patch: false } } : {}) };
}
export function endpointConfig(profile: RoleProfile, endpoint?: Endpoint): Record<string, unknown> {
  if (!endpoint) return {};
  return { provider: { 'sonail-custom': { name: endpoint.name, npm: endpoint.protocol === 'anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible', options: { baseURL: endpoint.baseUrl, apiKey: endpoint.apiKey || 'local-no-key' }, models: { [profile.model]: { name: profile.model } } } } };
}

/** One configured session per run: role models never mutate process-global settings. */
export class HarnessProvider implements AgentProvider {
  readonly name = 'opencode' as const;
  readonly displayName: string;
  readonly model: string;
  constructor(private profile: RoleProfile, private role: Role, private endpoint?: Endpoint, private codexClient = async (): Promise<Pick<Codex, 'startThread'>> => { const { Codex } = await import('@openai/codex-sdk'); return new Codex(); }) { this.model = profile.model; this.displayName = profile.harness; }
  async start(): Promise<void> { effortFor(this.profile); }
  async stop(): Promise<void> { /* session owns the transport */ }
  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    const controller = new AbortController();
    let sessionId: string | null = null;
    let cleanup: (() => Promise<void> | void) | undefined;
    const emit = (type: 'output' | 'tool_call' | 'command_output' | 'error', content: string, metadata?: Record<string, unknown>) => config.onEvent({ id: randomUUID(), contextId: config.contextId, type, content, timestamp: Date.now(), metadata });
    const execute = async (userPrompt: string) => {
      const timer = setTimeout(() => controller.abort(), this.profile.timeoutMinutes * 60000);
      const prompt = `${config.systemPrompt}\n\n${this.role === 'executor' ? 'Only modify the assigned workspace. Do not merge or change acceptance criteria.' : 'Read-only independent analysis. Never modify files, launch other agents, change criteria or merge code.'}\n\n${userPrompt}`;
      try {
        if (this.profile.harness === 'opencode') {
          const { createOpencode } = await import('@opencode-ai/sdk/v2');
          const owned = await createOpencode({ hostname: '127.0.0.1', port: 0, timeout: 30000, signal: controller.signal, config: { ...endpointConfig(this.profile, this.endpoint), permission: { '*': 'allow', external_directory: 'deny' } } as never });
          cleanup = () => owned.server.close();
          const made = await owned.client.session.create({ directory: config.workingDirectory, title: `Sonail ${this.role}: ${config.contextId}` }, { throwOnError: true });
          sessionId = made.data!.id;
          emit('tool_call', `OpenCode session ${sessionId}`, { sessionId, harness: 'opencode', model: this.model, effort: this.profile.effort });
          const request = openCodeRequest(this.profile, sessionId, config.workingDirectory, prompt, this.role);
          if (request.variant && !this.endpoint) {
            const providers = await owned.client.provider.list({ directory: config.workingDirectory }, { throwOnError: true });
            const model = providers.data?.all.find(p => p.id === request.model.providerID)?.models[request.model.modelID];
            if (!model?.variants?.[request.variant]) throw new Error('模型不支持所选思考等级 / Model does not advertise selected variant');
          }
          const stream = await owned.client.event.subscribe({ directory: config.workingDirectory }, { signal: controller.signal });
          const pump = (async () => {
            for await (const event of stream.stream) {
              if (controller.signal.aborted) break;
              const e = event as unknown as { type: string; properties?: { part?: { sessionID?: string; type?: string; text?: string; tool?: string; state?: { status?: string; output?: string } } } };
              const part = e.properties?.part;
              if (part?.sessionID === sessionId && part.type === 'tool') emit(part.state?.status === 'completed' ? 'command_output' : 'tool_call', `${part.tool}: ${part.state?.output || part.state?.status || ''}`);
            }
          })().catch(() => {});
          void pump;
          const result = await owned.client.session.prompt(request, { throwOnError: true, signal: controller.signal });
          if (result.data?.info.error) throw new Error('OpenCode 执行失败 / OpenCode run failed');
          const text = result.data?.parts.filter(p => p.type === 'text').map(p => 'text' in p ? p.text : '').join('\n') || '';
          if (!text.trim()) throw new Error('模型未返回最终结果 / No final model result');
          emit('output', text);
        } else if (this.profile.harness === 'codex') {
          const thread = (await this.codexClient()).startThread({ model: this.model, workingDirectory: config.workingDirectory, modelReasoningEffort: effortFor(this.profile) as 'xhigh' | undefined, sandboxMode: this.role === 'executor' ? 'workspace-write' : 'read-only', approvalPolicy: 'never', skipGitRepoCheck: true });
          const { events } = await thread.runStreamed(prompt, { signal: controller.signal });
          let completed = false;
          let lastError = '';
          for await (const event of events) {
            if (event.type === 'turn.completed') completed = true;
            if (event.type === 'thread.started') { sessionId = event.thread_id; emit('tool_call', `Codex thread ${sessionId}`, { sessionId }); }
            if (event.type === 'turn.failed') throw new Error(`Codex: ${event.error.message}`);
            // CLI error events include retry notices. turn.failed or an absent
            // terminal result is authoritative; do not abort reconnects early.
            if (event.type === 'error') { lastError = event.message; emit('tool_call', `Codex status: ${event.message}`); }
            if (event.type === 'item.completed') {
              const item = event.item;
              if (item.type === 'agent_message') emit('output', item.text);
              else if (item.type === 'command_execution') emit('command_output', `${item.command}\n${item.aggregated_output}`);
              else emit('tool_call', item.type);
            }
          }
          if (!completed) throw new Error(`Codex 没有完成终态 / Codex terminal state missing${lastError ? `: ${lastError}` : ''}`);
        } else if (this.profile.harness === 'claude') {
          const { query } = await import('@anthropic-ai/claude-agent-sdk');
          const stream = query({ prompt, options: { model: this.model, cwd: config.workingDirectory, effort: effortFor(this.profile) as 'max' | undefined, abortController: controller, permissionMode: this.role === 'executor' ? 'acceptEdits' : 'plan', ...(this.role !== 'executor' ? { disallowedTools: ['Edit', 'Write', 'Bash', 'Agent'] } : {}) } });
          cleanup = () => stream.close();
          let completed = false;
          for await (const m of stream) {
            if (m.type === 'system' && m.subtype === 'init') { sessionId = m.session_id; emit('tool_call', `Claude session ${sessionId}`, { sessionId }); }
            if (m.type === 'assistant') for (const b of m.message.content) { if (b.type === 'text') emit('output', b.text); else if (b.type === 'tool_use') emit('tool_call', b.name); }
            if (m.type === 'result') { if (m.subtype !== 'success') throw new Error('Claude 执行未完成 / Claude run incomplete'); completed = true; }
          }
          if (!completed) throw new Error('Claude 没有完成终态 / Claude terminal state missing');
        } else {
          await this.runDsh(config.workingDirectory, prompt, controller.signal, emit, id => { sessionId = id; });
        }
        if (controller.signal.aborted) throw new Error('已停止或超时 / Stopped or timed out');
        return { status: 'complete' as const };
      } catch (error) {
        const detail = (error instanceof Error ? error.message : 'Unknown harness error').slice(0, 1600);
        const safeDetail = this.endpoint?.apiKey ? detail.split(this.endpoint.apiKey).join('[REDACTED]') : detail;
        emit('error', `运行失败、被停止或能力不支持；未自动换模型 / Model unchanged: ${safeDetail}`);
        return { status: 'failed' as const, error: `运行未完成 / Run incomplete: ${safeDetail}` };
      } finally { clearTimeout(timer); controller.abort(); await cleanup?.(); }
    };
    return { execute, get sessionId() { return sessionId; }, async send() { throw new Error('请使用项目经理操作或原生会话 / Use project actions or native session'); }, async abort() { controller.abort(); await cleanup?.(); }, async destroy() { controller.abort(); await cleanup?.(); } };
  }
  private async runDsh(cwd: string, prompt: string, signal: AbortSignal, emit: (type: 'output' | 'tool_call' | 'command_output' | 'error', text: string) => void, setId: (id: string) => void): Promise<void> {
    const entry = process.env.SONAIL_DSH_COMMAND || path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    const nodeEntry = /\.[cm]?js$/.test(entry) && fs.existsSync(entry);
    const child = spawn(nodeEntry ? process.execPath : (process.env.SONAIL_DSH_COMMAND || 'dsh'), nodeEntry ? [entry, '--profile', 'sdk'] : ['--profile', 'sdk'], { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let sequence = 0;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    const sessionId = `session-${randomUUID()}`; setId(sessionId);
    let output = '';
    let finish!: () => void; let fail!: (e: Error) => void;
    const terminal = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    void terminal.catch(() => {});
    const stop = () => { child.kill(); fail(new Error('DSH stopped')); for (const p of pending.values()) p.reject(new Error('DSH stopped')); };
    signal.addEventListener('abort', stop, { once: true });
    child.on('error', () => stop()); child.on('exit', () => { fail(new Error('DSH exited before completed turn')); for (const p of pending.values()) p.reject(new Error('DSH exited')); });
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => {
      try {
        const m = JSON.parse(line);
        if (m.id !== undefined && !m.method) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p?.reject(new Error('DSH RPC rejected')); else p?.resolve(m.result); return; }
        if (m.id !== undefined && m.method) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Interactive approvals require native harness' } }) + '\n'); fail(new Error('DSH requires decision')); return; }
        if (m.method !== 'session.event' || m.params?.sessionId !== sessionId) return;
        const event = m.params.event;
        if (event?.type === 'assistant/message') output = (event.data?.message?.content || event.data?.content || []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('\n');
        else if (event?.type === 'turn/end') { if (event.data?.reason?.kind === 'completed') finish(); else fail(new Error('DSH incomplete turn')); }
        else emit('tool_call', String(event?.type || 'session.event'));
      } catch { fail(new Error('DSH invalid protocol')); }
    });
    const rpc = (method: string, params: unknown) => new Promise<unknown>((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
    try {
      await rpc('initialize', { cwd, provider: process.env.SONAIL_DSH_PROVIDER || 'deepseek-official', model: this.model, ...(effortFor(this.profile) ? { reasoningEffort: effortFor(this.profile) } : {}) });
      await rpc('session/prompt', { sessionId, contentBlocks: [{ type: 'text', text: prompt }] });
      await terminal;
      if (!output) throw new Error('DSH no output'); emit('output', output);
    } finally { signal.removeEventListener('abort', stop); lines.close(); child.kill(); }
  }
}
