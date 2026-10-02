import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const url = process.env.SONAIL_URL || 'http://127.0.0.1:19100';
const token = process.env.SONAIL_AI_TOKEN;
if (!token) { console.error('Set SONAIL_AI_TOKEN from Sonail Roles & settings → AI access.'); process.exit(1); }
const base = new URL(url);
if (base.username || base.password) { console.error('Keep credentials in SONAIL_AI_TOKEN, not the URL.'); process.exit(1); }
const criterion = { type: 'object', required: ['id', 'text', 'kind'], properties: { id: { type: 'string' }, text: { type: 'string' }, kind: { enum: ['objective', 'human'] } } };
const proposal = { type: 'object', required: ['productSpec', 'technicalSpec', 'tasks'], properties: {
  originalIdea: { type: 'string', description: 'Preserve the user original request as supplied, without replacing it with technical specifications' },
  productSpec: { type: 'string', description: 'Plain-language intended result and user experience' },
  technicalSpec: { type: 'string', description: 'Implementation boundaries and verification' },
  tasks: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', required: ['title', 'description', 'criteria', 'dependsOn', 'complexity'], properties: {
    title: { type: 'string' }, description: { type: 'string', description: 'Execution instructions, relative write paths and read-only upstream artifacts' },
    criteria: { type: 'array', minItems: 1, items: criterion }, dependsOn: { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'Zero-based indices of earlier tasks' }, complexity: { enum: ['small', 'standard', 'deep'] },
  } } },
} };
const tools = [
  { name: 'get_project_context', description: 'Read only the credential-bound project: original need, specification, task states, repository fingerprint and revision. No raw execution log or secrets.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false } },
  { name: 'preview_task_plan', description: 'Validate and stage a task plan for user confirmation; creates no cards and starts no agents. Copy fingerprint and revision from a fresh get_project_context. Requires preview permission. Existing tasks are not replaced.', inputSchema: { type: 'object', required: ['proposal', 'fingerprint', 'expectedRevision'], properties: { proposal, fingerprint: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 1 } }, additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
];
const server = new Server({ name: 'sonail-project', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const name = request.params.name;
    if (!tools.some(tool => tool.name === name)) throw new Error('Unknown tool');
    const response = await fetch(new URL(`/api/ai/${name === 'get_project_context' ? 'context' : 'preview'}`, base), {
      method: name === 'get_project_context' ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(name === 'preview_task_plan' ? { body: JSON.stringify(request.params.arguments) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    const message = String(error.message).split(token).join('[REDACTED]');
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
});
await server.connect(new StdioServerTransport());
