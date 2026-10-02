import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import { HarnessProvider } from '../src/services/harness.js';
import { AgentManager } from '../src/services/agent-manager.js';
import { defaults } from '../../../shared/workflow.js';
import type { Task } from '../src/types.js';

async function codexRun(sequence: unknown[]) {
  const events: { type: string; content: string }[] = [];
  let options: unknown;
  const provider = new HarnessProvider({ ...defaults().roles.manager, harness: 'codex', model: 'gpt-6-luna', effort: 'xhigh' }, 'manager', undefined, async () => ({
    startThread(input: unknown) {
      options = input;
      return { runStreamed: async () => ({ events: (async function* () { for (const event of sequence) yield event; })() }) } as never;
    },
  }));
  const session = await provider.createSession({ contextId: 'retry-test', workingDirectory: os.tmpdir(), systemPrompt: 'Read only', onEvent: e => events.push(e) });
  try { return { result: await session.execute('Return a plan'), events, options }; }
  finally { await session.destroy(); }
}

test('Codex reconnect notices do not abort a later successful turn', async () => {
  const run = await codexRun([
    { type: 'thread.started', thread_id: 'native-test' },
    { type: 'error', message: 'Reconnecting... 2/5 (request timed out)' },
    { type: 'error', message: 'Reconnecting... 3/5 (request timed out)' },
    { type: 'item.completed', item: { type: 'agent_message', text: '{"productSpec":"Plan"}' } },
    { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0 } },
  ]);
  assert.equal(run.result.status, 'complete');
  assert.ok(run.events.some(e => e.type === 'output' && e.content.includes('productSpec')));
  assert.ok(run.events.some(e => e.type === 'tool_call' && e.content.includes('Reconnecting')));
  assert.equal(run.events.some(e => e.type === 'error'), false);
  assert.deepEqual(run.options, { model: 'gpt-6-luna', workingDirectory: os.tmpdir(), modelReasoningEffort: 'xhigh', sandboxMode: 'read-only', approvalPolicy: 'never', skipGitRepoCheck: true });
});

test('Codex terminal failure reports the actual cause and does not pass', async () => {
  const run = await codexRun([{ type: 'error', message: 'Reconnecting... 2/5' }, { type: 'turn.failed', error: { message: 'Model unavailable for this account' } }]);
  assert.equal(run.result.status, 'failed'); assert.match(run.result.error || '', /Model unavailable/);
});

test('Codex stream ending after a reconnect without a terminal result is failure', async () => {
  const run = await codexRun([{ type: 'error', message: 'Reconnecting... 2/5 (request timed out)' }]);
  assert.equal(run.result.status, 'failed'); assert.match(run.result.error || '', /terminal state missing.*request timed out/);
});

test('executor rejects unsupported effort before launching a native session', { timeout: 5000 }, async () => {
  const manager = new AgentManager();
  const task: Task = { id: 'unsupported-effort', projectId: 'p', title: 'Task', description: '', priority: 'medium', columnId: 'backlog', agentStatus: 'idle', createdAt: 1, runProfile: { ...defaults().roles.executor, harness: 'codex', model: 'gpt-6-luna', effort: 'max' } };
  await new Promise<void>(resolve => manager.startAgent(task, status => { if (status === 'failed') resolve(); }));
  assert.equal(manager.isRunning(task.id), false);
  assert.ok((await manager.getEvents(task.id)).some(e => /Codex supports xhigh/.test(e.content)));
});
