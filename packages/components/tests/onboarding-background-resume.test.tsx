// @vitest-environment jsdom

import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { initI18n } from '../src/i18n';
import { OnboardingCeremony } from '../src/components/onboarding/ceremony/ceremony';
import { useOnboardingAudio } from '../src/components/onboarding/ceremony/use-onboarding-audio';

type PlayMode = 'allow' | 'block' | 'pending';

function installMedia(initialMode: PlayMode) {
  let mode = initialMode;
  const players: TimedAudio[] = [];
  const pendingResolutions: Array<() => void> = [];

  class TimedAudio {
    paused = true;
    ended = false;
    muted = false;
    loop = true;
    volume = 1;
    private position = 0;
    private playingSince: number | null = null;

    constructor(public src: string) {
      players.push(this);
    }

    get currentTime() {
      return this.playingSince === null
        ? this.position
        : this.position + (performance.now() - this.playingSince) / 1000;
    }

    set currentTime(value: number) {
      this.position = value;
      if (!this.paused) this.playingSince = performance.now();
    }

    play(): Promise<void> {
      if (mode === 'block') return Promise.reject(new Error('Autoplay blocked'));
      if (mode === 'pending') {
        return new Promise((resolve) => {
          pendingResolutions.push(() => {
            this.paused = false;
            this.playingSince = performance.now();
            resolve();
          });
        });
      }
      this.paused = false;
      this.playingSince = performance.now();
      return Promise.resolve();
    }

    pause() {
      if (!this.paused) this.position = this.currentTime;
      this.paused = true;
      this.playingSince = null;
    }

    removeAttribute(name: string) {
      if (name === 'src') this.src = '';
    }

    load() {}
  }

  vi.stubGlobal('Audio', TimedAudio);
  return {
    players,
    setMode(next: PlayMode) {
      mode = next;
    },
    resolvePending() {
      for (const resolve of pendingResolutions.splice(0)) resolve();
    },
  };
}

function installWindowState() {
  let visible = true;
  let focused = true;
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
    visible ? 'visible' : 'hidden'
  );
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => !visible);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  return {
    blur() {
      focused = false;
      window.dispatchEvent(new Event('blur'));
    },
    focus() {
      focused = true;
      window.dispatchEvent(new Event('focus'));
    },
    hide() {
      visible = false;
      document.dispatchEvent(new Event('visibilitychange'));
    },
    show() {
      visible = true;
      document.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

async function mountOpening() {
  const container = document.createElement('div');
  const root = createRoot(container);
  function Opening() {
    const audio = useOnboardingAudio();
    const [setup, setSetup] = useState(false);
    return setup ? (
      <p>Setup reached</p>
    ) : (
      <OnboardingCeremony
        audio={audio}
        onFinish={() => {
          audio.stop();
          setSetup(true);
        }}
      />
    );
  }
  await act(async () => root.render(<Opening />));
  return { container, root };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.ipc;
});

it('uses the native foreground signal when Chromium leaves document focus stale', async () => {
  await initI18n('en');
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installWindowState();
  const media = installMedia('allow');
  let nativeListener: ((payload: unknown) => void) | null = null;
  window.ipc = {
    invoke: async () => undefined,
    on: (channel, listener) => {
      if (channel === 'app.windowForeground') nativeListener = listener;
      return () => {
        nativeListener = null;
      };
    },
    send: () => {},
  };
  const { container, root } = await mountOpening();
  const player = media.players[0];
  try {
    await act(async () => vi.advanceTimersByTime(2400));
    await act(async () => nativeListener?.(false));
    expect(document.hasFocus()).toBe(true);
    expect(document.hidden).toBe(false);
    expect(player.paused).toBe(true);
    await act(async () => vi.advanceTimersByTime(20000));
    expect(container.querySelector('.molly-intro-count')?.textContent).toBe('01 / 03');
    await act(async () => nativeListener?.(true));
    expect(player.paused).toBe(false);
    expect(player.currentTime).toBeCloseTo(2.4, 2);
    await act(async () => vi.advanceTimersByTime(600));
    expect(container.querySelector('.molly-intro-count')?.textContent).toBe('02 / 03');
  } finally {
    await act(async () => root.unmount());
  }
});

it('preserves a partial scene and cue through overlapping blur and visibility signals', async () => {
  await initI18n('en');
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const windowState = installWindowState();
  const media = installMedia('allow');
  const { container, root } = await mountOpening();
  const player = media.players[0];
  try {
    expect(container.querySelector('h1')?.textContent).toBe('Unexpected connections.');
    expect(player.paused).toBe(false);
    await act(async () => vi.advanceTimersByTime(2400));
    await act(async () => {
      windowState.blur();
      windowState.hide();
      windowState.blur();
    });
    expect(player.paused).toBe(true);
    expect(player.currentTime).toBeCloseTo(2.4, 2);

    await act(async () => vi.advanceTimersByTime(20000));
    expect(container.querySelector('h1')?.textContent).toBe('Unexpected connections.');
    await act(async () => {
      windowState.show();
      windowState.show();
      vi.advanceTimersByTime(5000);
    });
    expect(player.paused).toBe(true);
    expect(container.querySelector('h1')?.textContent).toBe('Unexpected connections.');

    await act(async () => {
      windowState.focus();
      windowState.focus();
    });
    expect(player.paused).toBe(false);
    expect(player.currentTime).toBeCloseTo(2.4, 2);
    await act(async () => vi.advanceTimersByTime(599));
    expect(container.querySelector('h1')?.textContent).toBe('Unexpected connections.');
    await act(async () => vi.advanceTimersByTime(1));
    expect(container.querySelector('h1')?.textContent).toBe('Your vision. Your finishing touch.');
    await act(async () => vi.advanceTimersByTime(3000));
    expect(container.querySelector('h1')?.textContent).toBe('Make your mark.');
    await act(async () => vi.advanceTimersByTime(3000));
    expect(player.paused).toBe(true);
    expect(container.querySelector('.molly-intro-footer > button')?.textContent).toContain(
      'Start setup'
    );
  } finally {
    await act(async () => root.unmount());
  }
});

it('keeps blocked sound blocked on return and seeks only on explicit enable or unmute', async () => {
  await initI18n('en');
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const windowState = installWindowState();
  const media = installMedia('block');
  const { container, root } = await mountOpening();
  const player = media.players[0];
  const sound = container.querySelector<HTMLButtonElement>('.molly-intro-sound')!;
  try {
    expect(sound.getAttribute('aria-label')).toBe('Enable sound');
    await act(async () => vi.advanceTimersByTime(1500));
    await act(async () => {
      windowState.blur();
      windowState.hide();
      vi.advanceTimersByTime(12000);
      windowState.show();
      windowState.focus();
    });
    expect(player.paused).toBe(true);
    expect(sound.getAttribute('aria-label')).toBe('Enable sound');
    await act(async () => vi.advanceTimersByTime(1500));
    expect(container.querySelector('.molly-intro-count')?.textContent).toBe('02 / 03');

    media.setMode('allow');
    await act(async () => sound.click());
    expect(player.paused).toBe(false);
    expect(player.currentTime).toBeCloseTo(3, 2);
    await act(async () => sound.click());
    expect(player.muted).toBe(true);
    await act(async () => vi.advanceTimersByTime(1000));
    await act(async () => {
      windowState.blur();
      windowState.hide();
      vi.advanceTimersByTime(12000);
      windowState.show();
      windowState.focus();
    });
    expect(player.muted).toBe(true);
    await act(async () => vi.advanceTimersByTime(2000));
    await act(async () => sound.click());
    expect(player.muted).toBe(false);
    expect(player.paused).toBe(false);
    expect(player.currentTime).toBeCloseTo(6, 2);

    player.ended = true;
    player.pause();
    await act(async () => {
      windowState.blur();
      windowState.focus();
    });
    expect(player.paused).toBe(true);
  } finally {
    await act(async () => root.unmount());
  }
});

it.each(['manual', 'reduced-motion'] as const)(
  'preserves %s reading on return and cannot revive a pending cue after setup',
  async (readingMode) => {
    await initI18n('en');
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const windowState = installWindowState();
    if (readingMode === 'reduced-motion') {
      const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
      Object.defineProperty(motionPreference, 'matches', { value: true });
      vi.spyOn(window, 'matchMedia').mockReturnValue(motionPreference);
    }
    const media = installMedia('pending');
    const { container, root } = await mountOpening();
    const player = media.players[0];
    try {
      if (readingMode === 'manual') {
        await act(async () =>
          container.querySelectorAll<HTMLButtonElement>('.molly-intro-segments button')[1].click()
        );
      }
      const expectedPage = readingMode === 'manual' ? '02 / 03' : '01 / 03';
      await act(async () => vi.advanceTimersByTime(1000));
      await act(async () => {
        windowState.blur();
        windowState.hide();
        vi.advanceTimersByTime(12000);
        windowState.show();
        windowState.focus();
      });
      await act(async () => vi.advanceTimersByTime(6000));
      expect(container.querySelector('.molly-intro-count')?.textContent).toBe(expectedPage);
      await act(async () =>
        container.querySelector<HTMLButtonElement>('.molly-intro-footer > button')!.click()
      );
      expect(container.textContent).toContain('Setup reached');
      await act(async () => media.resolvePending());
      expect(player.paused).toBe(true);
      expect(player.src).toBe('');
    } finally {
      await act(async () => root.unmount());
    }
  }
);
