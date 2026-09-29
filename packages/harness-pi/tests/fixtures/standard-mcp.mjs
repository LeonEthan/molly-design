import { createInterface } from 'node:readline';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const directory = process.argv[2];
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  await appendFile(join(directory, 'protocol.jsonl'), `${JSON.stringify(request)}\n`);
  if (request.id === undefined) continue;
  let result;
  if (request.method === 'initialize')
    result = {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: 'synthetic', version: '1' },
    };
  else if (request.method === 'tools/list')
    result = {
      tools: [
        {
          name: 'generate',
          description: 'Write a synthetic image file',
          inputSchema: {
            type: 'object',
            properties: { prompt: { type: 'string' } },
            required: ['prompt'],
          },
        },
        { name: 'fail', description: 'Return an ordinary error', inputSchema: { type: 'object' } },
      ],
    };
  else if (request.method === 'tools/call') {
    if (request.params.name === 'fail')
      result = {
        isError: true,
        content: [{ type: 'text', text: 'synthetic service rejected request' }],
      };
    else {
      const path = join(directory, 'image.png');
      await writeFile(
        path,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
          'base64'
        )
      );
      result = { content: [{ type: 'text', text: JSON.stringify({ path }) }] };
    }
  } else result = {};
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
}
