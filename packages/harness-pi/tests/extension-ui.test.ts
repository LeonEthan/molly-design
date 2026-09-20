import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExtensionUI, type ExtensionDialogHost } from '../src/extension-ui';

afterEach(() => vi.useRealTimers());

function fixture() {
  const run = new AbortController();
  const opened: Array<{
    question: Parameters<ExtensionDialogHost['open']>[0];
    signal: AbortSignal;
  }> = [];
  const dismissed: string[] = [];
  const notices: string[] = [];
  let answer: (value: string | undefined) => void = () => {};
  const bridge = createExtensionUI({
    currentSignal: () => run.signal,
    open: (question, signal) => {
      opened.push({ question, signal });
      return new Promise((resolve) => {
        answer = resolve;
      });
    },
    dismiss: (id) => {
      dismissed.push(id);
    },
    notify: (message) => notices.push(message),
  });
  return {
    ...bridge,
    run,
    opened,
    dismissed,
    notices,
    answer: (value: string | undefined) => answer(value),
  };
}

describe('extension UI over Core question forms', () => {
  it.each(['answer', 'stop', 'failure'] as const)(
    'waits for asynchronous dismissal before settling %s',
    async (outcome) => {
      const run = new AbortController();
      const events: string[] = [];
      let close: () => void = () => {};
      let failClose: (error: Error) => void = () => {};
      let dismissStarted: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        dismissStarted = resolve;
      });
      const bridge = createExtensionUI({
        currentSignal: () => run.signal,
        open: async () => 'Confirm',
        dismiss: () => {
          events.push('dismiss');
          dismissStarted();
          return new Promise<void>((resolve, reject) => {
            close = resolve;
            failClose = reject;
          });
        },
        notify: () => {},
      });
      const pending = bridge.ui.confirm('Proceed?', '').then(
        (value) => {
          events.push('settled');
          return value;
        },
        (error: unknown) => {
          events.push('failed');
          throw error;
        }
      );
      await started;
      expect(events).toEqual(['dismiss']);
      if (outcome === 'failure') {
        const rejected = expect(pending).rejects.toThrow('harness_extension_ui_dismiss_failed');
        failClose(new Error('PRIVATE_HOST_DIAGNOSTIC'));
        await rejected;
        expect(events).toEqual(['dismiss', 'failed']);
      } else {
        if (outcome === 'stop') run.abort();
        close();
        expect(await pending).toBe(outcome === 'answer');
        expect(events).toEqual(['dismiss', 'settled']);
      }
    }
  );
  it('does not release an affirmative answer when the host cannot retire the request', async () => {
    const bridge = createExtensionUI({
      currentSignal: () => new AbortController().signal,
      open: async () => 'Confirm',
      dismiss: () => {
        throw new Error('PRIVATE_HOST_DIAGNOSTIC');
      },
      notify: () => {},
    });
    await expect(bridge.ui.confirm('Proceed?', '')).rejects.toThrow(
      'harness_extension_ui_dismiss_failed'
    );
  });
  it('uses exact choices and retires the request after a user answer', async () => {
    const f = fixture();
    const pending = f.ui.select('Choose layout', ['Wide', 'Tall']);
    expect(f.opened[0]?.question).toMatchObject({
      question: 'Choose layout',
      options: [{ label: 'Wide' }, { label: 'Tall' }],
      multiSelect: false,
      allowCustomAnswer: false,
    });
    f.answer('Tall');
    expect(await pending).toBe('Tall');
    expect(f.dismissed).toEqual([f.opened[0]?.question.id]);
  });

  it('maps free text without manufacturing a default answer', async () => {
    const f = fixture();
    const pending = f.ui.input('Title?', 'Type a title');
    expect(f.opened[0]?.question).toMatchObject({
      options: [],
      allowCustomAnswer: true,
      header: 'Type a title',
    });
    f.answer('Summer');
    expect(await pending).toBe('Summer');
  });

  it.each(['run', 'dialog', 'dispose', 'timeout', 'closed'] as const)(
    'never confirms on %s',
    async (cause) => {
      vi.useFakeTimers();
      const f = fixture();
      const dialog = new AbortController();
      const pending = f.ui.confirm('Proceed?', 'Publish the selected design?', {
        signal: dialog.signal,
        timeout: 100,
      });
      if (cause === 'run') f.run.abort();
      if (cause === 'dialog') dialog.abort();
      if (cause === 'dispose') f.dispose();
      if (cause === 'timeout') await vi.advanceTimersByTimeAsync(100);
      if (cause === 'closed') f.answer(undefined);
      expect(await pending).toBe(false);
      expect(f.dismissed).toEqual([f.opened[0]?.question.id]);
      f.answer('Confirm');
      expect(await pending).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('refuses a choice that was not offered', async () => {
    const f = fixture();
    const pending = f.ui.select('Layout?', ['Wide']);
    f.answer('Injected approval');
    await expect(pending).rejects.toThrow('harness_extension_ui_invalid_response');
    expect(f.dismissed).toEqual([f.opened[0]?.question.id]);
  });

  it('rejects oversized or expired requests before opening a form', async () => {
    const f = fixture();
    await expect(f.ui.input('x'.repeat(8193))).rejects.toThrow(
      'harness_extension_ui_invalid_request'
    );
    await expect(f.ui.select('Choose', Array(34).fill('Choice'))).rejects.toThrow(
      'harness_extension_ui_invalid_request'
    );
    expect(await f.ui.confirm('Proceed?', '', { timeout: 0 })).toBe(false);
    f.run.abort();
    expect(await f.ui.input('Title?')).toBeUndefined();
    expect(f.opened).toEqual([]);
  });

  it('fails closed outside a run and for unsupported terminal operations', async () => {
    const f = fixture();
    expect(() => f.ui.getEditorText()).toThrow('harness_extension_ui_unsupported');
    expect(() => f.ui.theme.fg('accent', 'text')).toThrow('harness_extension_ui_unsupported');
    f.ui.notify('Question ready', 'info');
    expect(f.notices).toEqual(['Question ready']);
    f.dispose();
    expect(() => f.ui.notify('Late notice')).toThrow('harness_extension_ui_outside_run');
    const idle = createExtensionUI({
      currentSignal: () => undefined,
      open: async () => 'Confirm',
      dismiss: () => {},
      notify: () => {},
    });
    await expect(idle.ui.confirm('Proceed?', '')).rejects.toThrow(
      'harness_extension_ui_outside_run'
    );
  });

  it.each(['sync', 'async'] as const)(
    'redacts %s host errors and closes the pending form',
    async (kind) => {
      const dismissed: string[] = [];
      const ui = createExtensionUI({
        currentSignal: () => new AbortController().signal,
        open: () => {
          if (kind === 'sync') throw new Error('PRIVATE_HOST_DIAGNOSTIC');
          return Promise.reject(new Error('PRIVATE_HOST_DIAGNOSTIC'));
        },
        dismiss: (id) => {
          dismissed.push(id);
        },
        notify: () => {},
      }).ui;
      await expect(ui.input('Title?')).rejects.toThrow('harness_extension_ui_failed');
      expect(dismissed[0]).toMatch(/^[a-f0-9-]{36}$/);
    }
  );
});
