import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const eventLogPath = process.argv[2];
const HELD_TEXT = 'Synthetic response started.';
const REPLY_TEXT = 'Synthetic response complete.';

function record(event, details = {}) {
  if (!eventLogPath) return;
  appendFileSync(
    eventLogPath,
    `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, ...details })}\n`,
    'utf8'
  );
}

function lastUserText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((block) => block?.type === 'text')
        .map((block) => block.text)
        .join('\n');
    }
  }
  return '';
}

function chunk(model, delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

function completion(model, text) {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    req.on('data', (part) => parts.push(part));
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/browser-fixture') {
    record('browser-page-served');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      '<!doctype html><title>Synthetic local browser page</title><h1>Local navigation reached the native browser.</h1>'
    );
    return;
  }
  if (req.method === 'GET' && url.pathname.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [] }));
    return;
  }
  if (req.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'unknown scripted endpoint' } }));
    return;
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'invalid json' } }));
    return;
  }

  const text = lastUserText(body);
  const extractsPreferences = body?.messages?.some(
    (message) =>
      (message?.role === 'system' || message?.role === 'developer') &&
      typeof message.content === 'string' &&
      message.content.startsWith(
        'Extract only explicitly stated durable personal preferences from the current user text.'
      )
  );
  const mode = extractsPreferences
    ? 'memory'
    : text.includes('You generate titles for')
      ? 'title'
      : text.includes('[E2E:BROWSER:LOCAL]')
        ? 'browser-local'
        : text.includes('[SCOUT:HOLD]')
          ? 'hold'
          : 'reply';
  const replyText =
    mode === 'memory'
      ? '{"changes":[]}'
      : mode === 'title'
        ? 'Synthetic session title'
        : mode === 'hold'
          ? HELD_TEXT
          : REPLY_TEXT;
  const toolResult = Array.isArray(body?.messages)
    ? body.messages.findLast((message) => message?.role === 'tool')
    : undefined;
  const requestId = randomUUID();
  record('request-start', {
    requestId,
    mode,
    model: body?.model,
    streaming: body?.stream === true,
  });

  if (body?.stream !== true) {
    record('request-complete', { requestId, mode, transport: 'json' });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(completion(body?.model, replyText)));
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write(chunk(body?.model, { role: 'assistant' }));

  if (mode === 'browser-local' && !toolResult) {
    const tools = Array.isArray(body?.tools) ? body.tools : [];
    const codemode = tools.find((tool) => tool?.function?.name === 'codemode');
    if (!codemode) {
      record('browser-tool-missing', { requestId, mode });
      res.write(chunk(body?.model, { content: 'Synthetic browser tool was unavailable.' }));
      res.write(chunk(body?.model, {}, 'stop'));
    } else {
      const pageUrl = `http://127.0.0.1:${server.address().port}/browser-fixture`;
      record('browser-tool-dispatched', { requestId, mode, pageUrl });
      res.write(
        chunk(
          body?.model,
          {
            tool_calls: [
              {
                index: 0,
                id: 'synthetic-browser-local',
                type: 'function',
                function: {
                  name: codemode.function.name,
                  arguments: JSON.stringify({
                    code: `const navigation = await tools.mcp__molly_browser__navigate({ url: ${JSON.stringify(pageUrl)} }); const snapshot = await tools.mcp__molly_browser__snapshot({}); text('BROWSER_PROBE_RESULT=' + JSON.stringify({ navigation, snapshot }));`,
                  }),
                },
              },
            ],
          },
          'tool_calls'
        )
      );
    }
    res.write('data: [DONE]\n\n');
    res.end(() => record('request-complete', { requestId, mode }));
    return;
  }

  if (mode === 'browser-local') {
    const resultText = String(toolResult.content ?? '');
    record('browser-tool-result', {
      requestId,
      mode,
      resultText,
    });
    res.write(chunk(body?.model, { content: 'Synthetic browser probe complete.' }));
    res.write(chunk(body?.model, {}, 'stop'));
    res.write('data: [DONE]\n\n');
    res.end(() => record('request-complete', { requestId, mode }));
    return;
  }

  if (mode === 'hold') {
    res.write(chunk(body?.model, { content: HELD_TEXT }));
    res.flushHeaders?.();
    // Hold the turn open; the harness Stop button aborts the engine's fetch,
    // which surfaces here as the response stream closing before we end it.
    // (ServerResponse 'close' is the SSE disconnect signal; the keep-alive
    // request side does not fire reliably.)
    res.on('close', () => {
      if (!res.writableEnded) record('request-cancelled', { requestId, mode });
    });
    return;
  }

  res.write(chunk(body?.model, { content: replyText }));
  res.write(chunk(body?.model, {}, 'stop'));
  res.write('data: [DONE]\n\n');
  res.end(() => record('request-complete', { requestId, mode }));
}

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  record('server-start', { port: address?.port });
});

process.on('SIGTERM', () => {
  record('sigterm');
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  record('sigint');
  server.close(() => process.exit(0));
});
