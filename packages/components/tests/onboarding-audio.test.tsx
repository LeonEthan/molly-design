// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { initI18n } from '../src/i18n';
import { OnboardingCeremony } from '../src/components/onboarding/ceremony/ceremony';
import {
  useOnboardingAudio,
  type OnboardingAudio,
} from '../src/components/onboarding/ceremony/use-onboarding-audio';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('plays the local cue once, supports mute and gesture recovery, and stops pending playback on exit', async () => {
  const players: FakeAudio[] = [];
  let rejection: Error | undefined = new Error('Autoplay blocked');
  let pending: Promise<void> | undefined;
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
      if (pending) return pending;
      if (rejection) return Promise.reject(rejection);
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
  let audio: OnboardingAudio;
  function Probe() {
    audio = useOnboardingAudio();
    return null;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      audio.start();
    });
    expect(audio!.needsGesture).toBe(true);
    rejection = undefined;
    await act(async () => {
      audio.start();
    });
    const player = players[0];
    expect(audio!.needsGesture).toBe(false);
    expect(player.src).toContain('molly-opening-v1.mp3');
    expect(player.loop).toBe(false);
    expect(player.paused).toBe(false);
    act(() => {
      audio.toggleMuted();
    });
    expect(player.muted).toBe(true);
    player.ended = true;
    player.paused = true;
    await act(async () => {
      audio.start();
    });
    expect(player.paused).toBe(true);
    player.ended = false;
    let rejectPending: (error: Error) => void = () => {};
    pending = new Promise<void>((_resolve, reject) => {
      rejectPending = reject;
    });
    await act(async () => {
      audio.start();
      audio.stop();
    });
    await act(async () => {
      rejectPending(new Error('Stopped'));
    });
    expect(audio!.needsGesture).toBe(false);
    expect(player.paused).toBe(true);
    expect(player.currentTime).toBe(0);
  } finally {
    act(() => root.unmount());
  }
  expect(players[0].src).toBe('');
  expect(players[0].paused).toBe(true);
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
    player.currentTime = 20;
    player.ended = true;
    player.paused = true;
    await act(async () =>
      container.querySelectorAll<HTMLButtonElement>('.molly-intro-segments button')[0].click()
    );
    expect(player.currentTime).toBe(20);
    expect(player.paused).toBe(true);
  } finally {
    act(() => root.unmount());
  }
});
