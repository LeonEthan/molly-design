import { randomUUID } from 'node:crypto';
import type { ExtensionUIContext, ExtensionUIDialogOptions } from '@earendil-works/pi-coding-agent';
import type { LodyElicitationQuestion } from 'acp-extension-core';

export type ExtensionDialogHost = {
  currentSignal(): AbortSignal | undefined;
  open(question: LodyElicitationQuestion, signal: AbortSignal): Promise<string | undefined>;
  /** Retire the matching request, including its visible pending state. Idempotent. */
  dismiss(id: string): void | Promise<void>;
  notify(message: string, type: 'info' | 'warning' | 'error'): void;
};

const MAX_DIALOG_MS = 300_000;
const unsupported = (): never => {
  throw new Error('harness_extension_ui_unsupported');
};

/** Native UI adapter over the existing Core question shape, not a new wire protocol. */
export function createExtensionUI(host: ExtensionDialogHost) {
  const lifetime = new AbortController();
  async function ask(
    title: string,
    options: string[] | undefined,
    placeholder: string | undefined,
    opts?: ExtensionUIDialogOptions
  ): Promise<string | undefined> {
    const run = host.currentSignal();
    if (!run) throw new Error('harness_extension_ui_outside_run');
    if (
      !title.trim() ||
      title.length > 8192 ||
      (placeholder?.length ?? 0) > 8192 ||
      (options &&
        (options.length < 1 ||
          options.length > 33 ||
          options.some((option) => !option.trim() || option.length > 1024))) ||
      (opts?.timeout !== undefined && (!Number.isFinite(opts.timeout) || opts.timeout < 0))
    ) {
      throw new Error('harness_extension_ui_invalid_request');
    }
    if (opts?.timeout === 0) return undefined;
    const deadline = new AbortController();
    const signal = AbortSignal.any([
      run,
      lifetime.signal,
      deadline.signal,
      ...(opts?.signal ? [opts.signal] : []),
    ]);
    if (signal.aborted) return undefined;
    const id = randomUUID();
    const timer = setTimeout(
      () => deadline.abort(),
      Math.min(opts?.timeout ?? MAX_DIALOG_MS, MAX_DIALOG_MS)
    );
    let onAbort = () => {};
    let value: string | undefined;
    let failure: unknown;
    try {
      value = await new Promise<string | undefined>((resolve, reject) => {
        onAbort = () => resolve(undefined);
        signal.addEventListener('abort', onAbort, { once: true });
        let pending: Promise<string | undefined>;
        try {
          pending = host.open(
            {
              id,
              question: title,
              header: placeholder ?? '',
              options: (options ?? []).map((label) => ({ label })),
              multiSelect: false,
              allowCustomAnswer: options === undefined,
            },
            signal
          );
        } catch {
          reject(new Error('harness_extension_ui_failed'));
          return;
        }
        pending.then(resolve, () => reject(new Error('harness_extension_ui_failed')));
      });
      if (signal.aborted) value = undefined;
      else if (
        value !== undefined &&
        (typeof value !== 'string' ||
          value.length > 8192 ||
          (options !== undefined && !options.includes(value)))
      ) {
        throw new Error('harness_extension_ui_invalid_response');
      }
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
    // A failed retirement must not release a successful answer to the extension.
    try {
      await host.dismiss(id);
    } catch {
      throw new Error('harness_extension_ui_dismiss_failed');
    }
    if (failure !== undefined) throw failure;
    return signal.aborted ? undefined : value;
  }
  const ui: ExtensionUIContext = {
    select: (title, options, opts) => ask(title, options, undefined, opts),
    input: (title, placeholder, opts) => ask(title, undefined, placeholder, opts),
    confirm: async (title, message, opts) =>
      (await ask(`${title}\n\n${message}`, ['Confirm', 'Cancel'], undefined, opts)) === 'Confirm',
    notify: (message, type = 'info') => {
      if (lifetime.signal.aborted || host.currentSignal()?.aborted !== false)
        throw new Error('harness_extension_ui_outside_run');
      if (message.length > 8192) throw new Error('harness_extension_ui_invalid_request');
      host.notify(message, type);
    },
    onTerminalInput: unsupported,
    setStatus: unsupported,
    setWorkingMessage: unsupported,
    setWorkingVisible: unsupported,
    setWorkingIndicator: unsupported,
    setHiddenThinkingLabel: unsupported,
    setWidget: unsupported,
    setFooter: unsupported,
    setHeader: unsupported,
    setTitle: unsupported,
    custom: unsupported,
    pasteToEditor: unsupported,
    setEditorText: unsupported,
    getEditorText: unsupported,
    editor: unsupported,
    addAutocompleteProvider: unsupported,
    setEditorComponent: unsupported,
    getEditorComponent: unsupported,
    // The SDK shallow-copies UI bindings. Defer rejection until terminal theme use.
    theme: new Proxy({} as ExtensionUIContext['theme'], { get: unsupported }),
    getAllThemes: unsupported,
    getTheme: unsupported,
    setTheme: unsupported,
    getToolsExpanded: unsupported,
    setToolsExpanded: unsupported,
  };
  return { ui, dispose: () => lifetime.abort() };
}
