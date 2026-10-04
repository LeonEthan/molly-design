import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// Deterministic OpenAI-completions wire for desktop E2E. The bundled engine
// speaks `openai-completions` SSE to `{baseUrl}/chat/completions`; this server
// is the only simulated external allowed by the e2e runtime boundary. Behavior
// is keyed on the last user message:
//   contains 'You generate titles for'  -> short canned title
//   contains '[SCOUT:HOLD]'             -> stream HELD start, never finish
//   contains '[E2E:BROWSER:PRIVATE]'     -> request one embedded-browser tool call
//   otherwise                           -> short canned reply, stop
// Every request and its terminal outcome land in the JSONL event log so the
// harness can assert observable signals instead of timing.
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
      : text.includes('[E2E:BROWSER:PRIVATE]')
        ? 'browser-private'
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

  if (mode === 'browser-private' && !toolResult) {
    const tools = Array.isArray(body?.tools) ? body.tools : [];
    // Pi's native MCP exposes servers to the model through its codemode script tool.
    const codemode = tools.find((tool) => tool?.function?.name === 'codemode');
    if (!codemode) {
      record('browser-tool-missing', { requestId, mode });
      res.write(chunk(body?.model, { content: 'Synthetic browser tool was unavailable.' }));
      res.write(chunk(body?.model, {}, 'stop'));
    } else {
      record('browser-tool-dispatched', { requestId, mode });
      res.write(
        chunk(
          body?.model,
          {
            tool_calls: [
              {
                index: 0,
                id: 'synthetic-browser-private',
                type: 'function',
                function: {
                  name: codemode.function.name,
                  arguments: JSON.stringify({
                    code: "text(JSON.stringify(await tools.mcp__molly_browser__navigate({ url: 'http://127.0.0.1:8333/' })));",
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

  if (mode === 'browser-private') {
    const resultText = String(toolResult.content ?? '');
    record('browser-tool-result', {
      requestId,
      mode,
      resultText,
      blockedPrivateHost: resultText.includes('Agent browser requires a public website.'),
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
