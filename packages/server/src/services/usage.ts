import type { UsageReport } from '../../../../shared/usage.js';

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
/** Allowlisted native field names retain provenance; never copy arbitrary
 * provider metadata (which can contain prompts, credentials or personal data). */
export function usageReport(source: UsageReport['source'], value: unknown): UsageReport {
  const data = object(value);
  const report: UsageReport = { source, scope: source === 'codex.turn.completed' ? 'turn' : source === 'claude.result' ? 'invocation' : 'last-message', semantics: 'snapshot', tokens: {}, cost: null, invalidFields: [] };
  const usage = object(source === 'opencode.session.prompt.info' ? data.tokens : data.usage);
  const keys = source === 'codex.turn.completed' ? ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens'] : source === 'claude.result' ? ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'] : ['input', 'output', 'reasoning', 'total'];
  const counter = (key: string, v: unknown) => {
    if (v === undefined) return;
    if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) report.tokens[key] = v;
    else report.invalidFields.push(key);
  };
  for (const key of keys) counter(key, usage[key]);
  if (source === 'opencode.session.prompt.info') for (const key of ['read', 'write']) counter(`cache.${key}`, object(usage.cache)[key]);
  const costKey = source === 'claude.result' ? 'total_cost_usd' : source === 'opencode.session.prompt.info' ? 'cost' : undefined;
  if (costKey && data[costKey] !== undefined) {
    const amount = data[costKey];
    if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) report.cost = { amount, currency: source === 'claude.result' ? 'USD' : null };
    else report.invalidFields.push(costKey);
  }
  return report;
}

/** Metadata is extensible in SDK events but not in its public TypeScript type.
 * Recognize only our versioned envelope, never generic provider `usage` fields. */
export function getUsageEvidence(metadata: unknown): import('../../../../shared/usage.js').UsageEvidence | undefined {
  const value = object(object(metadata).sonailUsage);
  if (value.version !== 1 || typeof value.attemptId !== 'string' || !value.attemptId ||
      !['manager', 'executor', 'reviewer'].includes(String(value.role)) ||
      !['codex', 'claude', 'opencode', 'dsh'].includes(String(value.harness)) ||
      typeof value.selectedModel !== 'string' || typeof value.effort !== 'string' ||
      !['complete', 'failed'].includes(String(value.outcome)) || !Array.isArray(value.reports)) return undefined;
  for (const raw of value.reports) {
    const r = object(raw);
    if (!['codex.turn.completed', 'claude.result', 'opencode.session.prompt.info'].includes(String(r.source)) ||
        !['turn', 'invocation', 'last-message'].includes(String(r.scope)) || r.semantics !== 'snapshot' ||
        !r.tokens || typeof r.tokens !== 'object' || Array.isArray(r.tokens) ||
        Object.values(r.tokens).some(n => typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) ||
        !Array.isArray(r.invalidFields) || r.invalidFields.some(k => typeof k !== 'string')) return undefined;
    if (r.cost !== null) {
      const cost = object(r.cost);
      if (typeof cost.amount !== 'number' || !Number.isFinite(cost.amount) || cost.amount < 0 || (cost.currency !== 'USD' && cost.currency !== null)) return undefined;
    }
  }
  return value as unknown as import('../../../../shared/usage.js').UsageEvidence;
}
