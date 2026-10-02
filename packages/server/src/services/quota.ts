import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AccountQuota, QuotaBucket, QuotaOverview, ResetForecast } from '@ai-agent-board/shared/quota.js';
import type { IntegrationAdapter } from '@ai-agent-board/shared/workbench.js';

const percent = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : undefined;
export function accountQuota(result: any, observedAt = Date.now()): AccountQuota {
  const limits = result?.rateLimitsByLimitId || (result?.rateLimits ? { [result.rateLimits.limitId || 'codex']: result.rateLimits } : {});
  const buckets: QuotaBucket[] = Object.entries(limits).map(([id, item]) => {
    const limit = item as any;
    return { id, name: limit.limitName || id, windows: [limit.primary, limit.secondary].flatMap(window => {
      const used = percent(window?.usedPercent);
      return used === undefined ? [] : [{ usedPercent: used, remainingPercent: 100 - used, windowDurationMins: window.windowDurationMins || null, resetsAt: window.resetsAt || null }];
    }) };
  }).filter(bucket => bucket.windows.length);
  return { status: buckets.length ? 'available' : 'unavailable', observedAt, buckets, ...(!buckets.length ? { reason: 'no-limits' as const } : {}) };
}

/** Uses only initialize and the documented account/rateLimits/read. No threads or turns. */
export class CodexQuotaAdapter implements IntegrationAdapter<AccountQuota> {
  readonly id = 'codex-account'; readonly apiVersion = 1 as const;
  constructor(private command = process.env.SONAIL_CODEX_COMMAND || (process.platform === 'win32' ? 'codex.exe' : 'codex'), private prefix: string[] = []) {}
  read(): Promise<AccountQuota> {
    return new Promise(resolve => {
      const child = spawn(this.command, [...this.prefix, 'app-server', '--listen', 'stdio://'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      const lines = createInterface({ input: child.stdout }); let finished = false;
      const finish = (value: AccountQuota) => { if (finished) return; finished = true; clearTimeout(timer); lines.close(); child.stdin.end(); child.kill(); resolve(value); };
      const failed = (reason: AccountQuota['reason'] = 'read-failed') => finish({ status: 'unavailable', observedAt: Date.now(), buckets: [], reason });
      const timer = setTimeout(() => failed(), 20_000);
      const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
      child.on('error', error => failed((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-installed' : 'read-failed'));
      child.on('exit', () => { if (!finished) failed(); }); child.stdin.on('error', () => failed());
      lines.on('line', line => {
        let response; try { response = JSON.parse(line); } catch { return; }
        if (response.id === 1) {
          if (response.error) { failed(); return; }
          send({ method: 'initialized', params: {} }); send({ method: 'account/rateLimits/read', id: 2 });
        } else if (response.id === 2) { if (response.error) failed(); else finish(accountQuota(response.result)); }
      });
      send({ method: 'initialize', id: 1, params: { clientInfo: { name: 'sonail_quota', title: 'Sonail quota card', version: '0.1.0' } } });
    });
  }
}

export const RESET_SOURCE = 'https://codex-reset.com/';
export function resetForecast(data: any, observedAt = Date.now()): ResetForecast {
  const p24 = percent(data?.probabilities?.rounded_24h); const p48 = percent(data?.probabilities?.rounded_48h);
  const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;
  return { status: p24 === undefined && p48 === undefined ? 'unavailable' : 'available', source: RESET_SOURCE, observedAt,
    probability24h: p24, probability48h: p48, updatedAt: timestamp(data?.updated_at), lastResetAt: timestamp(data?.last_reset_at),
    confidence: ['low', 'medium', 'high'].includes(data?.confidence) ? data.confidence : 'unknown', officialSignal: data?.official_signal != null };
}
export class CodexResetAdapter implements IntegrationAdapter<ResetForecast> {
  readonly id = 'reset-signals'; readonly apiVersion = 1 as const;
  constructor(private fetcher = fetch) {}
  async read(): Promise<ResetForecast> {
    const empty: ResetForecast = { status: 'unavailable', source: RESET_SOURCE, observedAt: Date.now() };
    try {
      const response = await this.fetcher(`${RESET_SOURCE}api/forecast`, { headers: { 'User-Agent': 'Sonail/0.1 (+https://github.com/lexingtonhibiki/sonail)' }, signal: AbortSignal.timeout(10_000) });
      if (response.status === 429) {
        const retry = response.headers.get('retry-after'); const seconds = Number(retry);
        const retryAt = retry ? (Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retry)) : NaN;
        empty.retryAt = Number.isFinite(retryAt) ? retryAt : Date.now() + 300_000;
      }
      return response.ok ? resetForecast(await response.json()) : empty;
    } catch { return empty; }
  }
}
class CachedReader<T> {
  private value?: T; private until = 0; private pending?: Promise<T>;
  constructor(private adapter: IntegrationAdapter<T>, private retryAt = (_value: T) => 0) {}
  read(): Promise<T> {
    if (this.value && this.until > Date.now()) return Promise.resolve(this.value);
    return this.pending ||= this.adapter.read().then(value => { this.value = value; this.until = Math.max(Date.now() + 60_000, this.retryAt(value)); return value; }).finally(() => { this.pending = undefined; });
  }
}
export class QuotaService {
  private account: CachedReader<AccountQuota>;
  private forecast: CachedReader<ResetForecast>;
  constructor(account: IntegrationAdapter<AccountQuota> = new CodexQuotaAdapter(), forecast: IntegrationAdapter<ResetForecast> = new CodexResetAdapter()) {
    this.account = new CachedReader(account); this.forecast = new CachedReader(forecast, value => value.retryAt || 0);
  }
  async read(withForecast: boolean): Promise<QuotaOverview> {
    const [account, forecast] = await Promise.all([this.account.read(), withForecast ? this.forecast.read() : { status: 'disabled' as const, source: RESET_SOURCE }]);
    return { account, forecast };
  }
}
