// Synthetic local peer. It reports only credential isolation, never credential values.
import { createInterface } from 'node:readline';
const expected = process.argv[2] === 'first' ? 'SYNTHETIC_FIRST' : 'SYNTHETIC_SECOND';
const isolated =
  process.env.TEST_MCP_TOKEN === expected &&
  !process.env.OPENAI_API_KEY &&
  !process.env.TEST_OTHER_TOKEN;
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  if (!isolated) {
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'synthetic_auth_failed' } })}\n`
    );
    continue;
  }
  let result;
  if (request.method === 'initialize')
    result = {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'synthetic-protected', version: '1' },
    };
  else if (request.method === 'tools/list')
    result = { tools: [{ name: 'inspect', inputSchema: { type: 'object', properties: {} } }] };
  else if (request.method === 'tools/call')
    result = { content: [{ type: 'text', text: 'credential-isolation-ok' }] };
  else result = {};
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
}
