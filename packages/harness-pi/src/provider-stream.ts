import {
  createAssistantMessageEventStream,
  type AssistantMessageEventStream,
  type AssistantMessage,
  type Model,
  type Api,
} from '@earendil-works/pi-ai';

/** Sanitize provider diagnostics before native persistence, without changing successful model content. */
export function guardedProviderStream(
  model: Model<Api>,
  start: () => AssistantMessageEventStream,
  settle?: (message?: AssistantMessage) => Promise<void>
): AssistantMessageEventStream {
  const output = createAssistantMessageEventStream();
  const failure = (reason: 'error' | 'aborted'): AssistantMessage => ({
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason: reason,
    errorMessage: reason === 'aborted' ? 'harness_cancelled' : 'harness_provider_failed',
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  void (async () => {
    let settled = false;
    let reported = false;
    try {
      for await (const event of start()) {
        if (event.type === 'error') {
          reported = true;
          await settle?.(event.error);
          output.push({ type: 'error', reason: event.reason, error: failure(event.reason) });
          settled = true;
          break;
        }
        if (event.type === 'done') {
          reported = true;
          await settle?.(event.message);
          output.push(event);
          settled = true;
          break;
        }
        output.push(event);
      }
    } catch {
      // Neither provider exception text nor partial diagnostics may enter native history.
    } finally {
      if (!reported) await settle?.().catch(() => undefined);
      if (!settled) output.push({ type: 'error', reason: 'error', error: failure('error') });
      output.end();
    }
  })();
  return output;
}
