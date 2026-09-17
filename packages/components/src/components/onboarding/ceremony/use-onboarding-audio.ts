import { useCallback, useEffect, useRef, useState } from 'react';
import openingScore from '@/assets/molly-opening-v1.mp3';

export type OnboardingAudio = {
  start: () => void;
  stop: () => void;
  muted: boolean;
  toggleMuted: () => void;
  needsGesture: boolean;
};

/** One bundled, non-looping opening cue. Setup and subsequent launches stay quiet. */
export function useOnboardingAudio(): OnboardingAudio {
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const mutedRef = useRef(false);
  const attemptRef = useRef(0);
  const [muted, setMuted] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);

  const start = useCallback(() => {
    let player = playerRef.current;
    if (!player) {
      player = new Audio(openingScore);
      player.volume = 0.55;
      player.muted = mutedRef.current;
      player.loop = false;
      playerRef.current = player;
    }
    if (!player.paused || player.ended) return;
    const attempt = ++attemptRef.current;
    void Promise.resolve(player.play()).then(
      () => {
        if (attempt === attemptRef.current) setNeedsGesture(false);
      },
      () => {
        // Stop/unmount invalidates a pending play rejection; it must not invite a restart.
        if (attempt === attemptRef.current) setNeedsGesture(true);
      }
    );
  }, []);

  const stop = useCallback(() => {
    ++attemptRef.current;
    const player = playerRef.current;
    if (player) {
      player.pause();
      player.currentTime = 0;
    }
    setNeedsGesture(false);
  }, []);

  const toggleMuted = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    if (playerRef.current) playerRef.current.muted = mutedRef.current;
    setMuted(mutedRef.current);
  }, []);

  useEffect(
    () => () => {
      ++attemptRef.current;
      const player = playerRef.current;
      if (player) {
        player.pause();
        player.removeAttribute('src');
        player.load();
        playerRef.current = null;
      }
    },
    []
  );

  return { start, stop, muted, toggleMuted, needsGesture };
}
