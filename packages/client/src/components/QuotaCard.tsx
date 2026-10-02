import { useEffect, useState } from 'react';
import { ChevronDown, Gauge, RefreshCw, X } from 'lucide-react';
import type { QuotaOverview, QuotaWindow } from '../../../../shared/quota';
import type { WorkbenchSettings } from '../../../../shared/workbench';

type Translate = (zh: string, en: string) => string;
interface Props {
  value: WorkbenchSettings; usesCodex: boolean; t: Translate;
  request: <T>(url: string, method?: string, body?: unknown) => Promise<T>;
  onHide: () => void;
}
export default function QuotaCard({ value, usesCodex, t, request, onHide }: Props) {
  const enabled = value.quotaVisibility === 'shown' || (value.quotaVisibility !== 'hidden' && usesCodex);
  const [data, setData] = useState<QuotaOverview | null>(null);
  const [pending, setPending] = useState(false); const [feedback, setFeedback] = useState(false); const [error, setError] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sonail.quota-collapsed') !== 'false');
  const load = async () => {
    setPending(true); setFeedback(false);
    try { setData(await request<QuotaOverview>('/quota')); setError(false); setFeedback(true); } catch { setError(true); }
    finally { setPending(false); }
  };
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const update = async () => {
      if (document.visibilityState !== 'visible') return;
      try { const result = await request<QuotaOverview>('/quota'); if (current) { setData(result); setError(false); } } catch { if (current) setError(true); }
    };
    void update(); const timer = setInterval(() => void update(), 60_000);
    document.addEventListener('visibilitychange', update);
    return () => { current = false; clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [enabled, value.resetForecast]);
  const collapse = (next: boolean) => { setCollapsed(next); localStorage.setItem('sonail.quota-collapsed', String(next)); };
  const date = (at: number) => new Date(at).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const windowName = (window: QuotaWindow) => window.windowDurationMins === 10080 ? t('每周', 'Weekly') : window.windowDurationMins === 300 ? t('五小时', 'Five hours') : window.windowDurationMins ? `${window.windowDurationMins}${t(' 分钟窗口', ' minute window')}` : t('额度窗口', 'Quota window');
  if (!enabled) return null;
  const stale = !!data && (error || Date.now() - data.account.observedAt > 5 * 60_000);
  const main = data?.account.buckets.find(bucket => bucket.id === 'codex') || data?.account.buckets[0]; const forecast = data?.forecast;
  const forecastStale = !!forecast && (!forecast.updatedAt || Date.now() - Date.parse(forecast.updatedAt) > 15 * 60_000);
  const confidence = forecast?.confidence === 'high' ? t('高', 'High') : forecast?.confidence === 'medium' ? t('中', 'Medium') : forecast?.confidence === 'low' ? t('低', 'Low') : t('未知', 'Unknown');
  return <aside className={`sb-quota-card ${collapsed ? 'is-collapsed' : ''} ${stale ? 'is-stale' : ''}`} aria-label={t('Codex 额度悬浮卡', 'Codex quota card')}>
    {collapsed ? <button className="sb-quota-handle" onClick={() => collapse(false)} title={t('展开账户额度与刷新信号', 'Open account quota and reset signals')}><Gauge size={16} /><strong>Codex</strong><span>{main ? t('剩余：', 'Remaining: ') : ''}{main?.windows.map(window => `${windowName(window)} ${Math.round(window.remainingPercent)}%`).join(' / ') || t('查看额度', 'View quota')}{stale ? t(' · 待刷新', ' · Refresh needed') : ''}</span></button> : <>
      <header><strong>{t('Codex 可用额度', 'Codex remaining quota')}</strong><div><button className="sb-icon" disabled={pending} onClick={() => void load()} aria-label={t('刷新额度', 'Refresh quota')} title={t('刷新额度（缓存一分钟）', 'Refresh quota (one-minute cache)')}><RefreshCw size={15} /></button><button className="sb-icon" onClick={() => collapse(true)} aria-label={t('收起额度卡', 'Collapse quota card')} title={t('收起', 'Collapse')}><ChevronDown size={16} /></button><button className="sb-icon" onClick={onHide} aria-label={t('隐藏额度卡', 'Hide quota card')} title={t('隐藏，可在集成设置重新打开', 'Hide; reopen in integration settings')}><X size={16} /></button></div></header>
      {feedback && <p role="status" className="sb-muted">{t('读取已完成（缓存一分钟）', 'Read completed (one-minute cache)')}</p>}
      {error && <p role="status">{t('无法连接 Sonail 服务，请恢复连接后刷新。', 'Cannot reach Sonail; reconnect and refresh.')}</p>}
      {!data ? <p>{t('正在读取本机已登录 Codex…', 'Reading local signed-in Codex…')}</p> : <>
        {data.account.status === 'available' ? data.account.buckets.map(bucket => <div className="sb-quota-bucket" key={bucket.id}>
          {data.account.buckets.length > 1 && <strong>{bucket.name}</strong>}
          {bucket.windows.map((window, i) => <div className="sb-quota-window" key={i}><div><span>{windowName(window)}</span><strong>{Math.round(window.remainingPercent)}% {t('剩余', 'remaining')}</strong></div><progress max={100} value={window.remainingPercent} aria-label={`${windowName(window)} ${t('剩余额度', 'remaining quota')}`} /><small>{window.resetsAt ? `${t('账户重置：', 'Account reset: ')}${date(window.resetsAt * 1000)}${window.resetsAt * 1000 <= Date.now() ? t(' · 时间已到，刷新确认', ' · Time reached; refresh to confirm') : ''}` : t('未提供重置时间', 'Reset time not provided')}</small></div>)}
        </div>) : <p>{data.account.reason === 'not-installed' ? t('未找到 Codex 原生程序。安装并登录 Codex，或设置 SONAIL_CODEX_COMMAND 后重启服务。', 'Codex executable not found. Install and sign in, or set SONAIL_CODEX_COMMAND and restart Sonail.') : t('暂不能读取额度。请确认本机 Codex 已使用 ChatGPT 登录，再点击刷新；API key 登录不提供订阅额度。', 'Quota unavailable. Sign in to local Codex with ChatGPT, then refresh. API-key sign-in does not provide subscription quota.')}</p>}
        <small className="sb-quota-observed">{t('本机 Codex · 读取于 ', 'Local Codex · read at ')}{date(data.account.observedAt)}{stale ? t(' · 旧数据', ' · Old data') : ''}</small>
        {value.resetForecast ? <section className="sb-quota-forecast" data-stale={forecastStale}><h3>{t('社区刷新展望', 'Community reset outlook')}</h3>
          {forecast?.status === 'available' ? <><p className="sb-quota-odds">{forecast.probability24h !== undefined && <span>24h <strong>{forecast.probability24h}%</strong></span>}{forecast.probability48h !== undefined && <span>48h <strong>{forecast.probability48h}%</strong></span>}</p><small>{t('置信度：', 'Confidence: ')}{confidence}{forecastStale ? t(' · 来源数据过期或时间未知', ' · Source is old or undated') : ''}</small><p>{forecast.officialSignal ? t('来源报告了重置信号，请到原页核对。', 'The source reports a reset signal; check the original page.') : t('来源未给出新的官方重置信号。', 'The source reports no new official reset signal.')}</p>{forecast.updatedAt && <small>{t('来源更新：', 'Source updated: ')}{date(Date.parse(forecast.updatedAt))}</small>}</> : <p>{t('来源暂不可用，请稍后刷新或打开原页。', 'Source unavailable; refresh later or open its page.')}</p>}
          {forecast?.lastResetAt && <small>{t('最近全局刷新：', 'Last global reset: ')}{date(Date.parse(forecast.lastResetAt))}</small>}<a href={forecast?.source || 'https://codex-reset.com/'} target="_blank" rel="noreferrer">{t('数据来源：', 'Data: ')}codex-reset.com</a><small>{t('社区预测，不保证刷新；与你账户的重置时间分别显示。', 'Community forecast; no guaranteed reset. Separate from your account reset time.')}</small>
        </section> : <p className="sb-muted">{t('社区预测未开启，可在集成设置中打开。', 'Community forecast is off; enable it in integration settings.')}</p>}
      </>}
    </>}
  </aside>;
}
