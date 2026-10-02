import { useEffect, useState } from 'react';
import type { AiCredentialInfo, AiPermission } from '../../../../shared/workflow.js';

interface Setup { url: string; command: string; script: string; }
interface Issued { token: string; credential: AiCredentialInfo; setup: Setup; }
interface Props {
  projectId: string; hasRepo: boolean; t: (zh: string, en: string) => string;
  request: <T>(url: string, method?: string, body?: unknown) => Promise<T>;
  onNotice: (message: string) => void;
}

export default function AiAccess({ projectId, hasRepo, t, request, onNotice }: Props) {
  const [credentials, setCredentials] = useState<AiCredentialInfo[]>([]);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [name, setName] = useState('Codex');
  const [permission, setPermission] = useState<AiPermission>('preview');
  const [format, setFormat] = useState('codex');
  const [pending, setPending] = useState(false);
  const load = async () => (await request<{ credentials: AiCredentialInfo[] }>(`/ai-access/${projectId}`)).credentials;
  useEffect(() => {
    let current = true;
    void load().then(items => { if (current) setCredentials(items); }).catch(error => { if (current) onNotice(String(error.message)); });
    return () => { current = false; };
  }, [projectId]);
  const run = async (work: () => Promise<void>) => {
    setPending(true);
    try { await work(); setCredentials(await load()); }
    catch (error) { onNotice(String((error as Error).message)); }
    finally { setPending(false); }
  };
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); onNotice(t('已复制', 'Copied')); }
    catch { onNotice(t('复制失败，请手动选择内容复制', 'Copy failed; select and copy the text manually')); }
  };
  const config = () => {
    if (!issued) return '';
    const { setup, token } = issued;
    const serverName = `sonail_${projectId.slice(0, 8)}`;
    const env = { SONAIL_URL: setup.url, SONAIL_AI_TOKEN: token };
    if (format === 'codex') return `[mcp_servers.${serverName}]\ncommand = ${JSON.stringify(setup.command)}\nargs = [${JSON.stringify(setup.script)}]\n\n[mcp_servers.${serverName}.env]\nSONAIL_URL = ${JSON.stringify(setup.url)}\nSONAIL_AI_TOKEN = ${JSON.stringify(token)}\n`;
    if (format === 'opencode') return JSON.stringify({ mcp: { [serverName]: { type: 'local', command: [setup.command, setup.script], environment: env, enabled: true } } }, null, 2);
    return JSON.stringify({ mcpServers: { [serverName]: { command: setup.command, args: [setup.script], env } } }, null, 2);
  };
  const prompt = t('请使用 Sonail MCP 的 get_project_context 读取已授权的项目，以我的原始需求为准拟定任务方案。调用 preview_task_plan 送入控制台待确认区；不发布、不启动、不验收、不合入。描述使用工作区相对路径，明确允许写入范围和上游产物只读，客观条件由 AI 取证，实际体验保留给我。不要在方案或回复中放密钥。若项目已有任务，先解释现状和建议，不尝试重复导入。', 'Use Sonail MCP get_project_context for the authorized project. Draft a task plan from my original request and submit it with preview_task_plan for confirmation. Do not publish, execute, accept or integrate. Use workspace-relative paths; state permitted writes and read-only upstream artifacts. Keep actual experience checks for me. Never put credentials in the plan or reply. If tasks already exist, explain their state and your recommendation instead of importing duplicates.');
  return <section className="sb-sheet sb-ai-access">
    <h2>{t('授权 AI 连接当前项目', 'Connect AI to this project')}</h2>
    <p className="sb-muted">{t('选择一个项目，给你信任的 AI 一把专用凭据。只读只看状态；送审可以提交方案，发布仍需你在页面确认。凭据有效 30 天，可随时撤销。', 'Give a trusted AI a dedicated credential for this project. Read-only views its state; preview permission submits drafts. You still confirm publication here. Credentials expire in 30 days and can be revoked.')}</p>
    <div className="sb-fields">
      <label>{t('凭据名称', 'Credential name')}<input value={name} onChange={event => setName(event.target.value)} /></label>
      <label>{t('允许做什么', 'Permission')}<select value={permission} onChange={event => setPermission(event.target.value as AiPermission)}><option value="read">{t('只读：查看项目与任务', 'Read-only: project and tasks')}</option><option value="preview">{t('送审：查看并提交任务方案', 'Preview: read and submit plans')}</option></select></label>
    </div>
    {!hasRepo && <p>{t('先为项目指定 Git 仓库，再签发凭据。', 'Select a Git repository before issuing a credential.')}</p>}
    <button className="sb-button" disabled={!hasRepo || pending || !name.trim()} onClick={() => void run(async () => { setIssued(await request<Issued>(`/ai-access/${projectId}`, 'POST', { name, permission })); onNotice(t('凭据已创建，请复制并保存', 'Credential created; copy and save it')); })}>{t('创建项目凭据', 'Create project credential')}</button>
    {issued && <div className="sb-credential-issued">
      <p><strong>{t('密钥只显示这一次', 'The key is shown only once')}</strong>{t(' · MCP 配置会明文保存密钥，请保存在你自己的本地配置中。', ' · MCP configuration stores the key as plaintext; keep it in your own local configuration.')}</p>
      <label>{t('项目密钥', 'Project key')}<input type="password" readOnly value={issued.token} /></label>
      <div className="sb-actions"><button className="sb-button" onClick={() => void copy(issued.token)}>{t('复制密钥', 'Copy key')}</button><label>{t('配置格式', 'Config format')}<select value={format} onChange={event => setFormat(event.target.value)}><option value="codex">Codex</option><option value="opencode">OpenCode 1.x</option><option value="generic">{t('通用 MCP JSON', 'Generic MCP JSON')}</option></select></label><button className="sb-button" onClick={() => void copy(config())}>{t('复制 MCP 配置', 'Copy MCP config')}</button><button className="sb-button" onClick={() => void copy(`Project ID: ${projectId}\n` + (issued.credential.permission === 'read' ? t('使用 Sonail MCP get_project_context 查看当前授权项目的目标和任务状态，给出建议；这是只读凭据，不提交方案、不启动或验收任务，不把密钥写入回复。', 'Use Sonail MCP get_project_context to inspect the authorized project and recommend next steps. This credential is read-only: do not submit drafts, execute or accept tasks, or put the key in a reply.') : prompt))}>{t('复制给 AI 的说明', 'Copy AI instructions')}</button><button className="sb-button" onClick={() => setIssued(null)}>{t('已保存，隐藏密钥', 'Saved; hide key')}</button></div>
      <p className="sb-muted">{t('把片段合并到工具的 MCP 设置，保留其他配置；已有同名项目连接时只更新该项。重新连接 MCP 后，在项目会话粘贴说明与原始需求。复制不会自动修改设置。', 'Merge this snippet into your MCP settings, keeping other entries; update an existing entry for this project. Reconnect MCP, then paste the instructions and original request. Copying does not change settings.')}</p>
      <details><summary>{t('手动复制配置（包含密钥）', 'Copy configuration manually (contains key)')}</summary><textarea readOnly aria-label={t('MCP 配置', 'MCP configuration')} rows={8} value={config()} /></details>
    </div>}
    <ul className="sb-credential-list">{credentials.map(item => <li key={item.id}><div><strong>{item.name}</strong><small>{item.revokedAt ? t('已撤销', 'Revoked') : item.expiresAt <= Date.now() ? t('已过期', 'Expired') : item.permission === 'read' ? t('只读', 'Read-only') : t('可送审', 'Can submit drafts')} · {t('到期：', 'Expires: ')}{new Date(item.expiresAt).toLocaleDateString()}</small></div>{!item.revokedAt && <button className="sb-button" disabled={pending} onClick={() => void run(async () => { await request(`/ai-access/${projectId}/${item.id}`, 'DELETE'); if (issued?.credential.id === item.id) setIssued(null); onNotice(t('凭据已撤销', 'Credential revoked')); })}>{t('撤销', 'Revoke')}</button>}</li>)}</ul>
    <p className="sb-muted">{t('这限制的是凭据对应的 HTTP 接口。已获本机文件或终端权限的工具仍按原有权限运行，它不提供系统沙箱。', 'These credentials scope the HTTP integration. A harness with local file or terminal access retains that access; this is not an OS sandbox.')}</p>
  </section>;
}
