import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import mollyMark from '@/assets/molly-mark.svg';
import editorial from '@/assets/molly-editorial-v3.png';
import poster from '@/assets/molly-poster-v3.png';
import brand from '@/assets/molly-brand-v3.png';
import commerce from '@/assets/molly-commerce-v3.png';
import { Button } from '@/ui/button';

export const INTRO_SHOT_COUNT = 4;
const BEATS = [
  { scene: 'poster', image: poster, title: 'Make an impression.' },
  { scene: 'editorial', image: editorial, title: 'Give every page a rhythm.' },
  { scene: 'brand', image: brand, title: 'Create a visual language.' },
  { scene: 'commerce', image: commerce, title: 'Show what makes it special.' },
] as const;

const MOTION = `
@keyframes molly-paper-arrive { from { opacity: 0; transform: translateY(24px) rotate(-4deg); } to { opacity: 1; transform: translateY(0) rotate(0); } }
@keyframes molly-type-arrive { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
.molly-paper-arrive { animation: molly-paper-arrive 900ms cubic-bezier(.2,.7,.2,1) both; }
.molly-type-arrive { animation: molly-type-arrive 700ms ease both; }
@media (prefers-reduced-motion: reduce) { .molly-paper-arrive, .molly-type-arrive { animation: none; } }
`;

/** The same paper composition anchors the intro and the local setup background. */
export function MollyPaperComposition({ beat = 1 }: { beat?: number }) {
  return (
    <div aria-hidden className="relative aspect-[4/5] w-full max-w-[390px]">
      <img
        key={beat}
        src={(BEATS[beat] ?? BEATS[0]).image}
        alt=""
        className="molly-paper-arrive h-full w-full object-cover shadow-[0_24px_64px_-24px_#25292355]"
      />
    </div>
  );
}

export function IntroSequence({
  playing = true,
  onStart,
}: {
  playing?: boolean;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!playing || beat === INTRO_SHOT_COUNT - 1) return undefined;
    const timer = window.setTimeout(() => setBeat((value) => value + 1), 5000);
    return () => window.clearTimeout(timer);
  }, [beat, playing]);
  const current = BEATS[beat] ?? BEATS[0];
  return (
    <div className="absolute inset-0 overflow-auto bg-[#f2efe6] text-[#262923]">
      <style>{MOTION}</style>
      <div className="mx-auto flex min-h-full max-w-[1180px] flex-col px-[6%] py-10">
        <header className="flex items-center gap-3">
          <img src={mollyMark} alt="" className="h-9 w-9" />
          <span className="font-serif text-2xl tracking-tight">Molly</span>
        </header>
        <main className="grid flex-1 items-center gap-12 py-10 md:grid-cols-2 md:gap-20">
          <div>
            <div className="mb-8 flex gap-2" aria-hidden>
              {BEATS.map((_, index) => (
                <span
                  key={index}
                  className={`h-[3px] w-9 ${index === beat ? 'bg-[#c36a46]' : 'bg-[#d5d2c7]'}`}
                />
              ))}
            </div>
            <div key={beat} className="molly-type-arrive min-h-[200px]" aria-live="polite">
              <p className="mb-4 text-xs tracking-[0.12em] text-[#9c583d]">
                {t(`onboarding.intro.${current.scene}.label`)}
              </p>
              <h1 className="max-w-[440px] font-serif text-[clamp(34px,4.4vw,60px)] leading-[1.1] tracking-[-0.035em]">
                {t(`onboarding.intro.${current.scene}.title`, current.title)}
              </h1>
              <p className="mt-6 max-w-[340px] text-base leading-relaxed text-[#717565]">
                {t(`onboarding.intro.${current.scene}.description`)}
              </p>
            </div>
            <Button
              onClick={onStart}
              className="mt-8 rounded-none bg-[#262923] px-7 text-[#fffef9] hover:bg-[#43483d]"
            >
              {t(beat === INTRO_SHOT_COUNT - 1 ? 'onboarding.intro.cta' : 'onboarding.intro.skip')}
            </Button>
          </div>
          <div className="mx-auto w-[min(68vw,330px)] md:w-full">
            <MollyPaperComposition beat={beat} />
          </div>
        </main>
      </div>
    </div>
  );
}
