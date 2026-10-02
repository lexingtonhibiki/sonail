import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkflowStore } from '../src/services/workflow-store.js';
import { CodexQuotaAdapter, CodexResetAdapter, QuotaService, accountQuota, resetForecast, RESET_SOURCE } from '../src/services/quota.js';

test('quota RPC reads windows without starting threads or returning account secrets', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sonail-quota-'));
  const script = path.join(temporary, 'rpc.mjs'); const calls = path.join(temporary, 'calls.json');
  const response = { rateLimitsByLimitId: { codex: { primary: { usedPercent: 35, windowDurationMins: 300, resetsAt: 1790993487 }, secondary: null, credits: { balance: 'private-credit-value' } } }, email: 'private@example.test' };
  fs.writeFileSync(script, `import fs from 'node:fs';import readline from 'node:readline';const methods=[];readline.createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);methods.push(r.method);fs.writeFileSync(${JSON.stringify(calls)},JSON.stringify(methods));if(r.id)console.log(JSON.stringify({id:r.id,result:r.id===1?{}:${JSON.stringify(response)}}));});`);
  try {
    const result = await new CodexQuotaAdapter(process.execPath, [script]).read();
    assert.equal(result.status, 'available'); assert.equal(result.buckets[0].windows[0].remainingPercent, 65);
    assert.deepEqual(JSON.parse(fs.readFileSync(calls, 'utf8')), ['initialize', 'initialized', 'account/rateLimits/read']);
    assert.ok(!JSON.stringify(result).includes('private'));
    const file = path.join(temporary, 'workflow.json'); const store = new WorkflowStore(file);
    store.saveWorkbenchSettings({ theme: 'sage', quotaVisibility: 'hidden', resetForecast: true });
    store.saveWorkbenchSettings({ theme: 'indigo' });
    assert.deepEqual(new WorkflowStore(file).workbenchSettings(), { theme: 'indigo', quotaVisibility: 'hidden', resetForecast: true });
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('sonail-quota-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test('unknown windows stay unknown, free windows remain 100%, multiple buckets stay separate', () => {
  const result = accountQuota({ rateLimitsByLimitId: { codex: { primary: null, secondary: { usedPercent: 0, windowDurationMins: 10080 } }, other: { primary: { usedPercent: 105 } } } });
  assert.equal(result.buckets.length, 2); assert.equal(result.buckets[0].windows.length, 1);
  assert.equal(result.buckets[0].windows[0].remainingPercent, 100); assert.equal(result.buckets[0].windows[0].resetsAt, null);
  assert.equal(result.buckets[1].windows[0].remainingPercent, 0); assert.equal(accountQuota({}).status, 'unavailable');
});

test('forecast is opt-in, attributed and cached; concurrent cards share one read', async () => {
  let accountCalls = 0; let forecastCalls = 0;
  const account = { id: 'account-test', apiVersion: 1 as const, read: async () => { accountCalls++; return accountQuota({ rateLimits: { primary: { usedPercent: 20 } } }); } };
  const forecast = new CodexResetAdapter(async (url, options) => {
    forecastCalls++; assert.equal(url, `${RESET_SOURCE}api/forecast`);
    assert.ok(JSON.stringify(options?.headers).includes('github.com/lexingtonhibiki/sonail'));
    assert.ok(!JSON.stringify(options).includes('Authorization'));
    return new Response(JSON.stringify({ probabilities: { rounded_24h: 16, rounded_48h: 29 }, confidence: 'low', official_signal: null, updated_at: '2026-10-03T00:00:00Z' }));
  });
  const service = new QuotaService(account, forecast);
  const disabled = await service.read(false); assert.equal(disabled.forecast.status, 'disabled'); assert.equal(forecastCalls, 0);
  const results = await Promise.all([service.read(true), service.read(true)]);
  assert.equal(accountCalls, 1); assert.equal(forecastCalls, 1);
  assert.equal(results[0].forecast.source, RESET_SOURCE); assert.equal(results[0].forecast.probability24h, 16);
  assert.equal(results[0].forecast.officialSignal, false); assert.equal(resetForecast({}).status, 'unavailable');
  const throttled = await new CodexResetAdapter(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } })).read();
  assert.equal(throttled.status, 'unavailable'); assert.ok(throttled.retryAt! > Date.now() + 119_000);
});
