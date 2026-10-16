import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJson, validateAssessment, validateProposal, type Assessment, type Proposal } from '../../../shared/workflow.js';

const example = 'Keep this command example:\n```sh\nnpm test\n```';
const criteria = [{ id: 'A1', text: 'README contains the command example', kind: 'objective' as const }];
const proposal: Proposal = {
  productSpec: 'Show installation instructions in the README',
  technicalSpec: example,
  tasks: [{ title: '01 update README', description: 'Update README.md only', criteria, dependsOn: [], complexity: 'small' }],
};

for (const [name, wrap] of [
  ['raw', (text: string) => text],
  ['JSON fence', (text: string) => `\`\`\`json\n${text}\n\`\`\``],
  ['unlabeled fence', (text: string) => `\`\`\`\n${text}\n\`\`\``],
  ['compact fence', (text: string) => `\`\`\`json ${text}\`\`\``],
  ['surrounding prose', (text: string) => `Here is the plan:\n${text}\nPlease confirm it.`],
  ['prose and fence', (text: string) => `Here is the plan:\n\`\`\`json\n${text}\n\`\`\`\nPlease confirm it.`],
  ['brace in prose and fence', (text: string) => `Plan {draft}:\n\`\`\`json\n${text}\n\`\`\`\nPlease confirm it.`],
] as const) {
  test(`parses ${name} proposals without treating code examples as response fences`, () => {
    const result = parseJson<Proposal>(wrap(JSON.stringify(proposal)));
    assert.deepEqual(result, proposal);
    assert.doesNotThrow(() => validateProposal(result));
  });
}

test('preserves quotes, backslashes, newlines, braces and multiple fences inside JSON strings', () => {
  const input = { text: 'Path C:\\tools\\test: "quoted"\n```json\n{"literal":"value"}\n```\nThen ```sh\nnpm test\n```', escaped: '\\"' };
  for (const text of [JSON.stringify(input), `\`\`\`json\r\n${JSON.stringify(input, null, 2)}\r\n\`\`\``]) {
    assert.deepEqual(parseJson(text), input);
  }
});

test('parses reviewer evidence containing a fenced example without changing the assessment', () => {
  const assessment: Assessment = { verdict: 'pass', summary: 'README verified', criteria: [{ id: 'A1', status: 'pass', evidence: example }], findings: [], humanChecks: [], revision: '' };
  for (const text of [JSON.stringify(assessment), `\`\`\`json\n${JSON.stringify(assessment)}\n\`\`\``]) {
    const result = parseJson<Assessment>(text);
    assert.deepEqual(result, assessment);
    assert.doesNotThrow(() => validateAssessment(result, criteria));
  }
});

test('retains existing unfenced, prose-wrapped, compact-fenced and fenced-array responses', () => {
  const value = { text: 'ordinary JSON', count: 1 };
  for (const text of [JSON.stringify(value), `Before ${JSON.stringify(value)} after`, `\`\`\`json${JSON.stringify(value)}\`\`\` trailing prose`]) {
    assert.deepEqual(parseJson(text), value);
  }
  assert.deepEqual(parseJson('```json [{"id":1},{"id":2}]``` trailing prose'), [{ id: 1 }, { id: 2 }]);
});

for (const text of ['{"value":}', '{"value":1,}', '{"value":1', '{"value":1}{"value":2}', 'not JSON', '```json\n{"value":1,}\n```', '```json\n[{"value":1},]\n```']) {
  test(`rejects malformed JSON: ${JSON.stringify(text)}`, () => {
    assert.throws(() => parseJson(text), SyntaxError);
  });
}

test('parsing preserves fields and leaves invalid proposal and assessment rejection to existing validators', () => {
  const invalidProposal = { ...proposal, productSpec: { invalid: 'object' }, extra: 'unchanged' };
  const parsedProposal = parseJson<Proposal>(JSON.stringify(invalidProposal));
  assert.deepEqual(parsedProposal, invalidProposal);
  assert.throws(() => validateProposal(parsedProposal), /Invalid proposal/);
  const invalidAssessment = { verdict: 'pass', summary: 'Not verified', criteria: [{ id: 'A1', status: 'fail', evidence: example }], findings: [], humanChecks: [], revision: '' };
  assert.throws(() => validateAssessment(parseJson<Assessment>(JSON.stringify(invalidAssessment)), criteria), /cannot pass/);
});

test('handles many literal fences without parsing every incomplete prefix', t => {
  const parse = t.mock.method(JSON, 'parse');
  const value = { text: '```'.repeat(30000) };
  assert.deepEqual(parseJson(`\`\`\`json\n${JSON.stringify(value)}\n\`\`\``), value);
  assert.equal(parse.mock.callCount(), 2);
  assert.throws(() => parseJson('```json\n{"text":"' + value.text + '\n```'), SyntaxError);
  assert.equal(parse.mock.callCount(), 4);
});

test('does not extract a valid object from a malformed outer fenced response', () => {
  for (const text of ['```json\ninvalid " prefix {"value":1}\n```', '```json\n{"text":"unterminated ```}\n```', '```json\n[{"value":1},]\n```']) {
    assert.throws(() => parseJson(text), SyntaxError);
  }
});
