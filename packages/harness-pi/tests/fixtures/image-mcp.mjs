// Synthetic stdio peer: no provider, key, network or generated asset.
import { createInterface } from 'node:readline';
const tool = {
  name: 'molly_generate_image',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
      model: { type: 'string', enum: ['synthetic-image'] },
    },
  },
};
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let result;
  if (request.method === 'initialize') {
    result = {
      protocolVersion: request.params.protocolVersion,
      capabilities: {
        tools: {},
        ...(process.argv.some((arg) => arg.startsWith('--resource')) ? { resources: {} } : {}),
      },
      serverInfo: { name: 'synthetic-image', version: '1' },
    };
  } else if (request.method === 'tools/list') result = { tools: [tool] };
  else if (request.method === 'tools/call') {
    if (process.argv.includes('--lose-response')) process.exit(0);
    if (
      process.argv.includes('--managed-inline') &&
      request.params._meta?.['molly/inline-image-result'] !== 1
    ) {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'managed metadata missing' } })}\n`
      );
      continue;
    }
    result = {
      content: [{ type: 'text', text: 'Synthetic image receipt' }],
      _meta: {
        mollyImageOperation: { version: 1, state: 'succeeded', dispatched: true, assetDigests: [] },
      },
    };
    if (process.argv.includes('--reject-image')) {
      result.isError = true;
      result._meta.mollyImageOperation.state = 'failed';
    }
    if (process.argv.some((arg) => arg.startsWith('--resource'))) {
      result.content = [{ type: 'resource_link', uri: 'synthetic://image/one', name: 'one' }];
    }
    if (process.argv.includes('--bad-image')) {
      result.content = [{ type: 'image', mimeType: 'image/png', data: 'NOT_BASE64' }];
    }
    if (process.argv.includes('--inline-image')) {
      result.content = [
        {
          type: 'image',
          mimeType: 'image/png',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        },
      ];
      result._meta.mollyImageOperation.assetDigests = ['f'.repeat(64)];
    }
  } else if (request.method === 'resources/read') {
    if (process.argv.includes('--resource-lost')) process.exit(0);
    result = {
      contents: [
        {
          uri: process.argv.includes('--resource-mismatch')
            ? 'synthetic://wrong-image'
            : request.params.uri,
          mimeType: 'image/png',
          blob: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        },
      ],
    };
  } else result = {};
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
}
