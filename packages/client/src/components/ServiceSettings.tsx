import { useEffect, useState } from 'react';
import { Copy, Download, Monitor, RefreshCw } from 'lucide-react';
import type { ServiceStatus } from '../../../../shared/workbench';
type Translate = (zh: string, en: string) => string;
export default function ServiceSettings({ t, onNotice }: { t: Translate; onNotice: (message: string) => void }) {
  const [status, setStatus] = useState<ServiceStatus>(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const headers = () => ({ 'Content-Type': 'application/json', ...(import.meta.env.VITE_API_KEY ? { Authorization: `Bearer ${import.meta.env.VITE_API_KEY}` } : {}) });
  const request = async (url: string, method = 'GET', body?: unknown) => {
    const response = await fetch('/api/workflow/service' + url, { method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`); return value as ServiceStatus;
  };
  useEffect(() => { let cancelled = false; void request('').then(value => { if (!cancelled) setStatus(value); }).catch(e => { if (!cancelled) setError(e.message); }); return () => { cancelled = true; }; }, []);
  const change = async (operation: () => Promise<void>, message: string) => {
    setBusy(true); setError(''); try { await operation(); onNotice(message); } catch (e) { setError((e as Error).message); onNotice((e as Error).message); } finally { setBusy(false); }
  };
  const download = async () => {
    const response = await fetch('/api/workflow/service/launcher', { headers: headers() });
    if (!response.ok) { const value = await response.json(); throw new Error(value.error || `HTTP ${response.status}`); }
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = 'Start-Sonail.cmd'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  return <><h2>{t('服务与启动', 'Service & startup')}</h2><p className="sb-muted">{t('项目、任务和设置保存在本机。网页需要本地服务运行；桌面入口会启动服务后打开控制台。', 'Projects, tasks and settings are saved locally. The desktop launcher starts the service and then opens the console.')}</p>
    {!status && !error && <p role="status">{t('正在检查服务与启动项…', 'Checking service and startup…')}</p>}
    {busy && <p role="status">{t('正在处理，请稍候…', 'Working, please wait…')}</p>}
    {(error || status?.error) && <p className="sb-recovery" role="alert">{error || status?.error}</p>}
    {status && <><div className="sb-service-status"><span className="sb-phase">{status.apiRunning ? t('后台服务已连接', 'Backend connected') : t('后台服务未连接', 'Backend offline')}</span><span className={status.uiRunning ? 'sb-phase' : 'sb-phase sb-warning'}>{status.uiRunning ? t('网页服务已运行', 'Web service running') : t('网页服务未连接，请使用启动入口', 'Web service offline; use the launcher')}</span></div><label className="sb-check"><input type="checkbox" aria-label={t('登录 Windows 后自动启动 Sonail', 'Start Sonail when signing into Windows')} checked={status.shortcuts?.enabled || false} disabled={busy || !status.supported || !status.shortcuts || status.shortcuts.conflict} onChange={e => void change(async () => { setStatus(await request('/autostart', 'PUT', { enabled: e.target.checked })); }, e.target.checked ? t('已开启登录自动启动，下次登录 Windows 生效', 'Startup enabled for the next Windows sign-in') : t('已关闭登录自动启动，当前服务继续运行', 'Startup disabled; the current service keeps running'))} />{t('登录 Windows 后自动启动 Sonail', 'Start Sonail when signing into Windows')}</label><p className="sb-muted">{t('仅当前 Windows 用户，无需管理员权限。开机启动服务，不自动弹出浏览器；重启后的 AI 任务保持暂停，避免重复执行。', 'Current Windows user only; no administrator rights required. Starts the service without opening a browser. AI tasks remain paused after restart to avoid duplicate execution.')}</p>
      {status.shortcuts?.conflict && <p className="sb-recovery">{t('启动项与当前项目不匹配，已保留原文件。请检查下方启动项位置。', 'Startup shortcut does not match this instance. The original file is preserved; check its location below.')}</p>}
      {!status.supported && <p>{t('此机器暂不支持 Windows 自启动设置。', 'Windows startup settings are unavailable on this machine.')}</p>}
      <div className="sb-actions"><button className="sb-button sb-primary" disabled={busy || !status.supported} onClick={() => void change(async () => { setStatus(await request('/desktop', 'POST')); }, t('桌面启动入口已创建，双击即可启动并打开 Sonail', 'Desktop launcher created. Double-click to start and open Sonail'))}><Monitor size={15} />{status.shortcuts?.desktopExists ? t('桌面入口已创建 · 重新检查', 'Desktop launcher ready · verify') : t('创建桌面启动入口', 'Create desktop launcher')}</button><button className="sb-button" disabled={busy || !status.supported} onClick={() => void change(download, t('启动文件已下载。服务停止时，双击 Start-Sonail.cmd 即可恢复。', 'Launcher downloaded. Double-click Start-Sonail.cmd when the service is stopped.'))}><Download size={15} />{t('下载一键启动文件', 'Download launcher')}</button><button className="sb-button" disabled={busy} onClick={() => void change(async () => { await navigator.clipboard.writeText(status.launcherPath); }, t('启动入口路径已复制', 'Launcher path copied'))}><Copy size={15} />{t('复制启动入口路径', 'Copy launcher path')}</button></div>
      <details><summary>{t('服务地址与本地文件位置', 'Service address and local files')}</summary><p><a href={status.url} target="_blank" rel="noreferrer">{status.url}</a></p><p>{t('手动入口：', 'Manual launcher: ')}<code>{status.launcherPath}</code></p><p>{t('数据目录：', 'Data folder: ')}<code>{status.dataPath}</code></p>{status.shortcuts && <><p>{t('桌面入口：', 'Desktop shortcut: ')}<code>{status.shortcuts.desktopPath}</code></p><p>{t('启动项：', 'Startup shortcut: ')}<code>{status.shortcuts.startupPath}</code></p></>}</details>
    </>}
    <button className="sb-button sb-small" disabled={busy} onClick={() => void change(async () => { setStatus(await request('')); }, t('服务和启动项状态已刷新', 'Service and startup status refreshed'))}><RefreshCw size={14} />{t('刷新服务状态', 'Refresh service status')}</button>
  </>;
}
