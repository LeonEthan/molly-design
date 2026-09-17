import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { IntroSequence } from './intro-sequence';
import type { OnboardingAudio } from './use-onboarding-audio';
import { unlockSound, setOnboardingSoundMuted } from './ui-sounds';

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
  audio: Pick<OnboardingAudio, 'start' | 'muted' | 'toggleMuted' | 'needsGesture'>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { start: startAudio } = audio;

  useEffect(() => {
    setOnboardingSoundMuted(audio.muted);
  }, [audio.muted]);

  // The score comes up with the opening title, not with the onboarding, so the
  // ceremony has a beginning rather than just appearing.
  useEffect(() => {
    if (!playing) return undefined;
    startAudio();
    // Web Audio stays suspended until a real user gesture, and the overlay
    // opens without one — so the first touch of anything unlocks it. Without
    // this the foley is silent until whichever control happens to be pressed
    // first, which reads as "the sounds are broken".
    const unlock = (): void => {
      unlockSound();
      startAudio();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [playing, startAudio]);

  return (
    <div className="fixed inset-0 z-10 overflow-hidden text-slate-950">
      <IntroSequence playing={playing} onStart={onFinish} />
      <button
        type="button"
        aria-pressed={audio.muted}
        className="app-region-no-drag absolute right-8 top-10 z-20 border-b border-[#aaa998] px-2 py-2 text-sm text-[#555b4c]"
        onClick={() => {
          if (audio.needsGesture && !audio.muted) startAudio();
          else audio.toggleMuted();
        }}
      >
        {t(audio.needsGesture || audio.muted ? 'onboarding.audio.enable' : 'onboarding.audio.mute')}
      </button>
    </div>
  );
}
