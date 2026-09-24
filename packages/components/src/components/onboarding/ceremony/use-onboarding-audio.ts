import { useCallback, useEffect, useRef, useState } from 'react';
import openingScore from '@/assets/molly-opening-v2.mp3';

const CUE_DURATION_MS = 9000;

export type OnboardingAudio = {
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  elapsedMs: () => number;
  muted: boolean;
  toggleMuted: () => void;
  enableSound: () => void;
  needsGesture: boolean;
};

export function useOnboardingAudio(): OnboardingAudio {
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const openedAtRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number | null>(null);
  const pausedDurationRef = useRef(0);
  const expiryTimerRef = useRef<number | null>(null);
  const mutedRef = useRef(false);
  const blockedRef = useRef(false);
  const attemptRef = useRef(0);
  const [muted, setMuted] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);

  const elapsedMs = useCallback(() => {
    const openedAt = openedAtRef.current;
    if (openedAt === null) return 0;
    return Math.max(
      0,
      (pausedAtRef.current ?? performance.now()) - openedAt - pausedDurationRef.current
    );
  }, []);

  const scheduleExpiry = useCallback(() => {
    if (expiryTimerRef.current !== null) window.clearTimeout(expiryTimerRef.current);
    const remaining = CUE_DURATION_MS - elapsedMs();
    if (remaining <= 0) return;
    expiryTimerRef.current = window.setTimeout(() => {
      ++attemptRef.current;
      playerRef.current?.pause();
      blockedRef.current = false;
      setNeedsGesture(false);
      expiryTimerRef.current = null;
    }, remaining);
  }, [elapsedMs]);

  const attemptPlay = useCallback(
    (player: HTMLAudioElement, position: number) => {
      if (position >= CUE_DURATION_MS / 1000 || player.ended || pausedAtRef.current !== null) {
        blockedRef.current = false;
        setNeedsGesture(false);
        return;
      }
      player.currentTime = position;
      const attempt = ++attemptRef.current;
      try {
        void Promise.resolve(player.play()).then(
          () => {
            if (
              playerRef.current !== player ||
              pausedAtRef.current !== null ||
              elapsedMs() >= CUE_DURATION_MS
            ) {
              player.pause();
              return;
            }
            if (attempt === attemptRef.current) {
              blockedRef.current = false;
              setNeedsGesture(false);
            }
          },
          () => {
            if (attempt === attemptRef.current && playerRef.current === player) {
              blockedRef.current = true;
              setNeedsGesture(true);
            }
          }
        );
      } catch {
        if (attempt === attemptRef.current && playerRef.current === player) {
          blockedRef.current = true;
          setNeedsGesture(true);
        }
      }
    },
    [elapsedMs]
  );

  const start = useCallback(() => {
    if (openedAtRef.current !== null) return;
    openedAtRef.current = performance.now();
    pausedAtRef.current = null;
    pausedDurationRef.current = 0;
    mutedRef.current = false;
    blockedRef.current = false;
    setMuted(false);
    setNeedsGesture(false);
    const player = new Audio(openingScore);
    player.volume = 0.55;
    player.muted = false;
    player.loop = false;
    playerRef.current = player;
    scheduleExpiry();
    attemptPlay(player, 0);
  }, [attemptPlay, scheduleExpiry]);

  const pause = useCallback(() => {
    if (openedAtRef.current === null || pausedAtRef.current !== null) return;
    pausedAtRef.current = performance.now();
    ++attemptRef.current;
    if (expiryTimerRef.current !== null) window.clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = null;
    playerRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    const pausedAt = pausedAtRef.current;
    if (pausedAt === null || openedAtRef.current === null) return;
    pausedDurationRef.current += performance.now() - pausedAt;
    pausedAtRef.current = null;
    const player = playerRef.current;
    if (!player) return;
    if (elapsedMs() >= CUE_DURATION_MS) {
      blockedRef.current = false;
      setNeedsGesture(false);
      return;
    }
    scheduleExpiry();
    if (!blockedRef.current && !player.ended) attemptPlay(player, elapsedMs() / 1000);
  }, [attemptPlay, elapsedMs, scheduleExpiry]);

  const stop = useCallback(() => {
    ++attemptRef.current;
    openedAtRef.current = null;
    pausedAtRef.current = null;
    pausedDurationRef.current = 0;
    blockedRef.current = false;
    if (expiryTimerRef.current !== null) window.clearTimeout(expiryTimerRef.current);
    expiryTimerRef.current = null;
    const player = playerRef.current;
    playerRef.current = null;
    if (player) {
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    setNeedsGesture(false);
  }, []);

  const enableSound = useCallback(() => {
    const player = playerRef.current;
    if (!player || openedAtRef.current === null) return;
    mutedRef.current = false;
    setMuted(false);
    player.muted = false;
    if (pausedAtRef.current !== null) return;
    if (player.paused) attemptPlay(player, elapsedMs() / 1000);
  }, [attemptPlay, elapsedMs]);

  const toggleMuted = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    const player = playerRef.current;
    if (!player) return;
    player.muted = mutedRef.current;
    if (pausedAtRef.current !== null) return;
    if (!mutedRef.current && player.paused && !blockedRef.current) {
      attemptPlay(player, elapsedMs() / 1000);
    }
  }, [attemptPlay, elapsedMs]);

  useEffect(
    () => () => {
      ++attemptRef.current;
      openedAtRef.current = null;
      pausedAtRef.current = null;
      if (expiryTimerRef.current !== null) window.clearTimeout(expiryTimerRef.current);
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

  return { start, pause, resume, stop, elapsedMs, muted, toggleMuted, enableSound, needsGesture };
}
