// Diagnostic preload for an owned synthetic worker only; never a production entry.
// IPC reports numeric memory buckets, not heap objects, paths, prompts or credentials.
const { queryObjects } = require('node:v8');
const { dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');
if (typeof global.gc !== 'function' || typeof process.send !== 'function') {
  throw new Error('synthetic_gc_observer_requires_exposed_gc_and_ipc');
}
process.on('message', async (message) => {
  if (message?.type !== 'synthetic-memory-observation' || typeof message.id !== 'string') return;
  try {
    // Resolve the already-loaded sealed SDK public entry only after worker isolation.
    // Do not import SDK code during preload or inspect/return object summaries.
    const { AgentSession, ModelRuntime } = await import(
      pathToFileURL(
        join(
          dirname(process.argv[1]),
          'harness/node_modules/@earendil-works/pi-coding-agent/dist/index.js'
        )
      ).href
    );
    const before = process.memoryUsage();
    global.gc();
    const counts =
      message.includeCounts === true
        ? {
            agentSessions: queryObjects(AgentSession, { format: 'count' }),
            modelRuntimes: queryObjects(ModelRuntime, { format: 'count' }),
          }
        : undefined;
    const after = process.memoryUsage();
    process.send({ type: 'synthetic-memory-observation', id: message.id, before, after, counts });
  } catch {
    process.send({
      type: 'synthetic-memory-observation',
      id: message.id,
      error: 'synthetic_object_count_unavailable',
    });
  }
});
process.channel.unref();
