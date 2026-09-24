import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IntroSequence } from './intro-sequence';
import type { OnboardingAudio } from './use-onboarding-audio';
import { unlockSound, setOnboardingSoundMuted } from './ui-sounds';
import { Volume2, VolumeX } from '@/ui/icons';
import { onIpcEvent } from '@/lib/electron-ipc-client';

// The onboarding ceremony: the opening title sequence, and nothing else.
//
// It used to continue past the film into welcome/connect/showcase/done acts —
// a scripted tour with a fake agent run. The flow always mounted it with
// `stopAfterIntro`, so those acts were unreachable and have been removed; the
// real setup screens own everything the film hands off to.

export function OnboardingCeremony({
  /** Starts the film only after the containing window has finished revealing. */
  playing = true,
  /** Hands over to the next phase once the title sequence has played. */
  onFinish,
  audio,
}: {
  playing?: boolean;
  onFinish: () => void;
  audio: Pick<
    OnboardingAudio,
    | 'start'
    | 'pause'
    | 'resume'
    | 'elapsedMs'
    | 'muted'
    | 'toggleMuted'
    | 'enableSound'
    | 'needsGesture'
  >;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { start: startAudio, pause: pauseAudio, resume: resumeAudio } = audio;
  const visibleRef = useRef(!document.hidden);
  const focusedRef = useRef(document.hasFocus());
  const nativeForegroundRef = useRef<boolean | null>(null);
  const foregroundRef = useRef(false);
  const [foreground, setForeground] = useState(false);

  useEffect(() => {
    setOnboardingSoundMuted(audio.muted);
  }, [audio.muted]);

  // The score comes up with the opening title, not with the onboarding, so the
  // ceremony has a beginning rather than just appearing.
  useEffect(() => {
    const sync = (): void => {
      const next =
        playing &&
        (nativeForegroundRef.current ?? (visibleRef.current && focusedRef.current));
      if (next === foregroundRef.current) return;
      foregroundRef.current = next;
      if (next) {
        startAudio();
        resumeAudio();
      } else {
        pauseAudio();
      }
      setForeground(next);
    };
    const onVisibilityChange = (): void => {
      visibleRef.current = !document.hidden;
      sync();
    };
    const onFocus = (): void => {
      focusedRef.current = true;
      sync();
    };
    const onBlur = (): void => {
      focusedRef.current = false;
      sync();
    };
    const unlock = (): void => unlockSound();
    const stopNativeForeground = onIpcEvent('app.windowForeground', (value) => {
      nativeForegroundRef.current = value;
      sync();
    });
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    visibleRef.current = !document.hidden;
    focusedRef.current = document.hasFocus();
    sync();
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      stopNativeForeground();
      pauseAudio();
    };
  }, [playing, startAudio, pauseAudio, resumeAudio]);

  return (
    <div className="fixed inset-0 z-10 overflow-hidden text-slate-950">
      <IntroSequence
        playing={foreground}
        getElapsedMs={audio.elapsedMs}
        onStart={onFinish}
        soundControl={
          <button
            type="button"
            aria-pressed={audio.muted || audio.needsGesture}
            className="app-region-no-drag molly-intro-sound"
            aria-label={t(
              audio.needsGesture || audio.muted
                ? 'onboarding.audio.enable'
                : 'onboarding.audio.mute'
            )}
            title={t(
              audio.needsGesture || audio.muted
                ? 'onboarding.audio.enable'
                : 'onboarding.audio.mute'
            )}
            onClick={() => {
              unlockSound();
              if (audio.needsGesture) audio.enableSound();
              else audio.toggleMuted();
            }}
          >
            {audio.needsGesture || audio.muted ? (
              <VolumeX aria-hidden="true" className="size-4" />
            ) : (
              <Volume2 aria-hidden="true" className="size-4" />
            )}
          </button>
        }
      />
    </div>
  );
}
