import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { writeScopePatch, writeScopeText } from '../src/lib/write-scope.ts';

const en = (_zh, english) => english;
const zh = (chinese) => chinese;

test('legacy edits omit write scope; explicit empty configuration is read-only', () => {
  assert.deepEqual(writeScopePatch(undefined), {});
  assert.equal(Object.hasOwn(writeScopePatch(undefined), 'allowedWritePaths'), false);
  assert.deepEqual(writeScopePatch(''), { allowedWritePaths: [] });
  assert.deepEqual(writeScopePatch('\r\n\n'), { allowedWritePaths: [] });
});

test('one path per line retains exact file and directory distinction', () => {
  assert.deepEqual(writeScopePatch('README.md\r\n\nsrc/components/\n'), { allowedWritePaths: ['README.md', 'src/components/'] });
  // Invalid syntax is not silently expanded or rewritten; server validation rejects it.
  assert.deepEqual(writeScopePatch('src/**'), { allowedWritePaths: ['src/**'] });
});

test('editing existing scope preserves canonical path spelling, including spaces', () => {
  const allowedWritePaths = [' leading.txt', 'trailing.txt ', 'both / inner /'];
  assert.deepEqual(writeScopePatch(allowedWritePaths.join('\n')), { allowedWritePaths });
  assert.deepEqual(writeScopePatch(' '), { allowedWritePaths: [' '] });
});

test('display and handoff distinguish legacy, read-only and allowlisted scope', () => {
  assert.match(writeScopeText(undefined, en), /Unconfigured \(legacy\)/);
  assert.match(writeScopeText([], en), /Read-only delivery: no Git file changes may be delivered/);
  assert.match(writeScopeText([], en), /not a runtime write sandbox/);
  assert.match(writeScopeText(['README.md', 'src/'], en), /exact files; trailing \/ includes directory descendants; no globs/);
  assert.ok(writeScopeText(['README.md', 'src/'], en).endsWith('README.md\nsrc/'));
  assert.match(writeScopeText(undefined, zh), /未配置/);
  assert.match(writeScopeText([], zh), /只读交付/);
});

test('plan, task details, edit payload and copied handoff wire scope into the UI', () => {
  const plan = readFileSync(new URL('../src/components/PlanPreview.tsx', import.meta.url), 'utf8');
  const workbench = readFileSync(new URL('../src/components/Workbench.tsx', import.meta.url), 'utf8');
  assert.match(plan, /<WriteScope paths=\{task.allowedWritePaths\}/);
  assert.match(workbench, /<WriteScope paths=\{policy.allowedWritePaths\}/);
  assert.match(workbench, /writeScopeText\(policy.allowedWritePaths, t\)/);
  assert.match(workbench, /\.\.\.writeScopePatch\(edit.allowedWritePathsText\)/);
  assert.doesNotMatch(workbench, /setEdit\([^\n]*allowedWritePathsText: undefined/);
});
