export interface QuotaWindow { usedPercent: number; remainingPercent: number; windowDurationMins: number | null; resetsAt: number | null; }
export interface QuotaBucket { id: string; name: string; windows: QuotaWindow[]; }
export interface AccountQuota {
  status: 'available' | 'unavailable'; observedAt: number; buckets: QuotaBucket[];
  reason?: 'not-installed' | 'read-failed' | 'no-limits';
}
export interface ResetForecast {
  status: 'available' | 'unavailable' | 'disabled'; source: string; observedAt?: number;
  updatedAt?: string; lastResetAt?: string; probability24h?: number; probability48h?: number;
  confidence?: 'low' | 'medium' | 'high' | 'unknown'; officialSignal?: boolean; retryAt?: number;
}
export interface QuotaOverview { account: AccountQuota; forecast: ResetForecast; }
