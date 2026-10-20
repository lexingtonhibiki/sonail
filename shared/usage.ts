import type { Harness, Role } from './workflow.js';

/** Provider evidence, not an invoice or a complete project ledger. Never add
 * overlapping snapshots, cached tokens, or reports with different scopes. */
export interface UsageReport {
  source: 'codex.turn.completed' | 'claude.result' | 'opencode.session.prompt.info';
  scope: 'turn' | 'invocation' | 'last-message';
  semantics: 'snapshot';
  tokens: Record<string, number>;
  cost: { amount: number; currency: 'USD' | null } | null;
  invalidFields: string[];
}
export interface UsageEvidence {
  version: 1;
  attemptId: string;
  role: Role;
  harness: Harness;
  selectedModel: string;
  effort: string;
  outcome: 'complete' | 'failed';
  reports: UsageReport[];
}
