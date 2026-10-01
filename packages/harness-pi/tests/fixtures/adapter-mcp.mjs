import { createInterface } from 'node:readline';
import { renameSync, writeFileSync } from 'node:fs';
import { appendFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.argv[2];
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const pending = new Map();
const forms = new Map();
let recorded = Promise.resolve();

process.on('exit', (code) => {
  const target = join(directory, 'exited.json');
  writeFileSync(`${target}.tmp`, JSON.stringify({ code }));
  renameSync(`${target}.tmp`, target);
});

async function signal(name, value) {
  const target = join(directory, `${name}.json`);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, target);
}

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

async function dispatch(request) {
  if (request.method === undefined) {
    const toolId = forms.get(request.id);
    if (toolId !== undefined) {
      forms.delete(request.id);
      const response = request.error ? { error: request.error } : { result: request.result };
      await signal('form-response', response);
      reply(toolId, {
        isError: request.error !== undefined,
        content: [
          {
            type: 'text',
            text: `SYNTHETIC_FORM_RESULT:${JSON.stringify(response)}`,
          },
        ],
      });
    }
    return;
  }
  if (request.method === 'notifications/cancelled') {
    const id = request.params.requestId;
    if (pending.delete(id)) {
      await signal('cancelled', request.params);
      reply(id, { isError: true, content: [{ type: 'text', text: 'SYNTHETIC_CANCELLED' }] });
    }
    return;
  }
  if (request.id === undefined) return;
  if (request.method === 'initialize') {
    await signal('spawned', {
      initialized: true,
      environment: {
        dollar: process.env.SYNTHETIC_LITERAL_DOLLAR,
        bang: process.env.SYNTHETIC_LITERAL_BANG,
      },
      arguments: process.argv.slice(3),
    });
    reply(request.id, {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} },
      serverInfo: { name: 'synthetic-owned-acp', version: '1' },
    });
  } else if (request.method === 'tools/list') {
    reply(request.id, {
      tools: ['image', 'fail', 'hold', 'form'].map((name) => ({
        name,
        description: `Synthetic ${name} tool`,
        inputSchema: { type: 'object', properties: {} },
      })),
    });
  } else if (request.method === 'tools/call') {
    if (request.params.name === 'hold') {
      pending.set(request.id, request);
      await signal('hold-started', { id: request.id });
    } else if (request.params.name === 'form') {
      const id = `form-${request.id}`;
      forms.set(id, request.id);
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'elicitation/create',
          params: {
            mode: 'form',
            message: 'SYNTHETIC_SERVER_FORM',
            requestedSchema: {
              type: 'object',
              properties: {
                choice: { type: 'string', title: 'Synthetic choice', enum: ['alpha', 'beta'] },
              },
              required: ['choice'],
            },
          },
        })}\n`
      );
    } else if (request.params.name === 'fail') {
      reply(request.id, {
        isError: true,
        content: [
          { type: 'text', text: 'SYNTHETIC_SERVICE_ERROR' },
          { type: 'image', data: png, mimeType: 'image/png' },
        ],
      });
    } else {
      reply(request.id, {
        content: [
          { type: 'text', text: 'SYNTHETIC_IMAGE_RESULT' },
          { type: 'image', data: png, mimeType: 'image/png' },
        ],
        structuredContent: { image: 'synthetic' },
      });
    }
  } else if (request.method === 'resources/list') {
    reply(request.id, {
      resources: [
        { uri: 'synthetic://resource', name: 'Synthetic resource', mimeType: 'text/plain' },
      ],
    });
  } else if (request.method === 'resources/templates/list') {
    reply(request.id, { resourceTemplates: [] });
  } else if (request.method === 'resources/read') {
    await signal('resource-read', request.params);
    reply(request.id, {
      contents: [
        { uri: request.params.uri, text: 'SYNTHETIC_RESOURCE_CONTENT', mimeType: 'text/plain' },
      ],
    });
  } else if (request.method === 'prompts/list') {
    reply(request.id, {
      prompts: [{ name: 'compose', description: 'Synthetic prompt', arguments: [] }],
    });
  } else if (request.method === 'prompts/get') {
    reply(request.id, {
      messages: [{ role: 'user', content: { type: 'text', text: 'SYNTHETIC_PROMPT_CONTENT' } }],
    });
  } else {
    reply(request.id, {});
  }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method !== undefined)
    recorded = recorded.then(() =>
      appendFile(join(directory, 'protocol.jsonl'), `${JSON.stringify(request)}\n`)
    );
  void recorded
    .then(() => dispatch(request))
    .catch(() => {
      process.exitCode = 1;
      lines.close();
    });
});
