import assert from 'node:assert/strict';
import test from 'node:test';
import { usageReport } from '../src/services/usage.js';

test('Codex retains native counters without inventing price or adding cached input twice', () => {
  const report = usageReport('codex.turn.completed', { usage: { input_tokens: 20, cached_input_tokens: 12, output_tokens: 4, reasoning_output_tokens: 2 }, cost: 100 });
  assert.deepEqual(report, { source: 'codex.turn.completed', scope: 'turn', semantics: 'snapshot', tokens: { input_tokens: 20, cached_input_tokens: 12, output_tokens: 4, reasoning_output_tokens: 2 }, cost: null, invalidFields: [] });
});
test('Claude aggregate result uses only explicitly reported USD, including zero', () => {
  const report = usageReport('claude.result', { usage: { input_tokens: 0, output_tokens: 5, cache_creation_input_tokens: 8, cache_read_input_tokens: 2 }, total_cost_usd: 0 });
  assert.deepEqual(report.cost, { amount: 0, currency: 'USD' });
  assert.equal(report.scope, 'invocation'); assert.equal(report.semantics, 'snapshot');
  assert.equal(report.tokens.cache_creation_input_tokens, 8);
});
test('OpenCode final message is not a whole invocation and its cost currency is unknown', () => {
  const report = usageReport('opencode.session.prompt.info', { tokens: { input: 5, output: 4, reasoning: 3, total: 9, cache: { read: 2, write: 1 } }, cost: 0.02, apiKey: 'never copied' });
  assert.equal(report.scope, 'last-message'); assert.deepEqual(report.cost, { amount: 0.02, currency: null });
  assert.deepEqual(report.tokens, { input: 5, output: 4, reasoning: 3, total: 9, 'cache.read': 2, 'cache.write': 1 });
  assert.equal(JSON.stringify(report).includes('never copied'), false);
});
test('missing reports and fields remain unknown, not synthetic zeros', () => {
  for (const value of [undefined, null, {}, { usage: null }, { usage: [] }]) {
    const report = usageReport('claude.result', value);
    assert.deepEqual(report.tokens, {}); assert.equal(report.cost, null);
  }
});
test('malformed, negative, fractional and nonfinite counters/costs are rejected', () => {
  for (const bad of [-1, 0.5, NaN, Infinity, -Infinity, '5', null, true, Number.MAX_SAFE_INTEGER + 1]) {
    const report = usageReport('codex.turn.completed', { usage: { input_tokens: bad, output_tokens: 2 } });
    assert.deepEqual(report.tokens, { output_tokens: 2 }); assert.deepEqual(report.invalidFields, ['input_tokens']);
  }
  for (const bad of [-1, NaN, Infinity, '1', null]) {
    const report = usageReport('claude.result', { total_cost_usd: bad });
    assert.equal(report.cost, null); assert.deepEqual(report.invalidFields, ['total_cost_usd']);
  }
});
