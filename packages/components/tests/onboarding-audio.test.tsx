// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initI18n } from '../src/i18n';
import { OnboardingCeremony } from '../src/components/onboarding/ceremony/ceremony';
import {
  useOnboardingAudio,
  type OnboardingAudio,
} from '../src/components/onboarding/ceremony/use-onboarding-audio';

beforeEach(() => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('recovers only through the sound control at elapsed opening time, then stays silent after nine seconds', async () => {
  vi.useFakeTimers();
  await initI18n('en');
  const players: FakeAudio[] = [];
  let blocked = true;
  class FakeAudio {
    paused = true;
    ended = false;
    muted = false;
    loop = true;
    volume = 1;
    currentTime = 0;
    constructor(public src: string) {
      players.push(this);
    }
    play() {
      if (blocked) return Promise.reject(new Error('Autoplay blocked'));
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
    removeAttribute() {
      this.src = '';
    }
    load() {}
  }
  vi.stubGlobal('Audio', FakeAudio);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  function Opening() {
    const audio = useOnboardingAudio();
    return <OnboardingCeremony audio={audio} onFinish={() => {}} />;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<Opening />);
    });
    const player = players[0];
    const sound = container.querySelector<HTMLButtonElement>('.molly-intro-sound')!;
    expect(player.src).toContain('molly-opening-v2.mp3');
    expect(player.loop).toBe(false);
    expect(player.paused).toBe(true);
    expect(sound.getAttribute('aria-label')).toBe('Enable sound');
    expect(sound.getAttribute('aria-pressed')).toBe('true');

    blocked = false;
    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      vi.advanceTimersByTime(4250);
    });
    expect(player.paused).toBe(true);
    expect(player.currentTime).toBe(0);
    expect(sound.getAttribute('aria-label')).toBe('Enable sound');

    await act(async () => sound.click());
    expect(player.paused).toBe(false);
    expect(player.currentTime).toBeCloseTo(4.25, 2);
    expect(sound.getAttribute('aria-label')).toBe('Mute');
    expect(sound.getAttribute('aria-pressed')).toBe('false');

    await act(async () => sound.click());
    expect(player.muted).toBe(true);
    player.currentTime = 6.25;
    await act(async () => {
      vi.advanceTimersByTime(2000);
      sound.click();
    });
    expect(player.muted).toBe(false);
    expect(player.currentTime).toBe(6.25);
    expect(player.paused).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(2750);
    });
    expect(player.paused).toBe(true);
    await act(async () => sound.click());
    expect(player.muted).toBe(true);
    await act(async () => {
      sound.click();
    });
    expect(player.muted).toBe(false);
    expect(player.paused).toBe(true);
    expect(player.currentTime).toBe(6.25);
  } finally {
    act(() => root.unmount());
  }
  expect(players[0].src).toBe('');
  expect(players[0].paused).toBe(true);
});

it('does not revive a pending play after leaving the opening', async () => {
  let resolvePlay: () => void = () => {};
  class FakeAudio {
    paused = true;
    ended = false;
    muted = false;
    loop = false;
    volume = 1;
    currentTime = 0;
    src = '';
    play() {
      return new Promise<void>((resolve) => {
        resolvePlay = () => {
          this.paused = false;
          resolve();
        };
      });
    }
    pause() {
      this.paused = true;
    }
    removeAttribute() {
      this.src = '';
    }
    load() {}
  }
  const player = new FakeAudio();
  vi.stubGlobal(
    'Audio',
    class {
      constructor() {
        return player;
      }
    }
  );
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let audio: OnboardingAudio;
  function Probe() {
    audio = useOnboardingAudio();
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe />));
  await act(async () => {
    audio.start();
    audio.stop();
  });
  await act(async () => resolvePlay());
  expect(player.paused).toBe(true);
  expect(player.src).toBe('');
  expect(audio!.needsGesture).toBe(false);
  act(() => root.unmount());
});

it('does not play a blocked cue when sound is enabled after its nine-second window', async () => {
  vi.useFakeTimers();
  class FakeAudio {
    paused = true;
    ended = false;
    muted = false;
    loop = false;
    volume = 1;
    currentTime = 0;
    play() {
      return Promise.reject(new Error('Autoplay blocked'));
    }
    pause() {
      this.paused = true;
    }
    removeAttribute() {}
    load() {}
  }
  const player = new FakeAudio();
  vi.stubGlobal(
    'Audio',
    class {
      constructor() {
        return player;
      }
    }
  );
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let audio: OnboardingAudio;
  function Probe() {
    audio = useOnboardingAudio();
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Probe />));
    await act(async () => audio.start());
    expect(audio!.needsGesture).toBe(true);
    await act(async () => vi.advanceTimersByTime(9000));
    expect(audio!.needsGesture).toBe(false);
    await act(async () => audio.enableSound());
    expect(player.paused).toBe(true);
    expect(player.currentTime).toBe(0);
    expect(audio!.needsGesture).toBe(false);
  } finally {
    act(() => root.unmount());
  }
});

it('keeps the playing score unmuted and at its current position during reduced-motion manual reading', async () => {
  await initI18n('en');
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  Object.defineProperty(motionPreference, 'matches', { value: true });
  vi.spyOn(window, 'matchMedia').mockReturnValue(motionPreference);
  class FakeAudio {
    paused = true;
    ended = false;
    muted = false;
    loop = false;
    volume = 1;
    currentTime = 0;
    play() {
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
    removeAttribute() {}
    load() {}
  }
  const player = new FakeAudio();
  vi.stubGlobal(
    'Audio',
    class {
      constructor() {
        return player;
      }
    }
  );
  function Opening() {
    const audio = useOnboardingAudio();
    return <OnboardingCeremony audio={audio} onFinish={() => {}} />;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Opening />));
    expect(player.paused).toBe(false);
    expect(player.muted).toBe(false);
    player.currentTime = 4.25;
    for (const index of [2, 0, 1]) {
      await act(async () =>
        container.querySelectorAll<HTMLButtonElement>('.molly-intro-segments button')[index].click()
      );
      expect(container.querySelector('.molly-intro-count')?.textContent).toBe(`0${index + 1} / 03`);
      expect(player.currentTime).toBe(4.25);
      expect(player.paused).toBe(false);
      expect(player.muted).toBe(false);
    }
    player.currentTime = 9;
    player.ended = true;
    player.paused = true;
    await act(async () =>
      container.querySelectorAll<HTMLButtonElement>('.molly-intro-segments button')[0].click()
    );
    expect(player.currentTime).toBe(9);
    expect(player.paused).toBe(true);
  } finally {
    act(() => root.unmount());
  }
});
