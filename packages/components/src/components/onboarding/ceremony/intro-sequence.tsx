import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import mollyMark from '@/assets/molly-mark.svg';
import inspiration from '@/assets/molly-intro-inspiration.png';
import creation from '@/assets/molly-intro-creation.png';
import expression from '@/assets/molly-intro-expression.png';
import { ArrowRight } from '@/ui/icons';
import { Button } from '@/ui/button';
import './intro-sequence.css';

const SCENES = [
  { id: 'inspiration', image: inspiration },
  { id: 'creation', image: creation },
  { id: 'expression', image: expression },
] as const;

export type IntroScene = (typeof SCENES)[number]['id'];
export const INTRO_SHOT_COUNT = SCENES.length;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const currentTimeMs = () => performance.now();

function subscribeToMotionPreference(onChange: () => void) {
  const preference = window.matchMedia(REDUCED_MOTION_QUERY);
  preference.addEventListener('change', onChange);
  return () => preference.removeEventListener('change', onChange);
}

function prefersReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function CreationConnector() {
  const ref = useRef<SVGSVGElement>(null);
  const [line, setLine] = useState<{ path: string; x: number; y: number }>();
  useLayoutEffect(() => {
    const scene = ref.current?.parentElement;
    const artwork = scene?.querySelector<HTMLImageElement>('.molly-intro-artwork');
    const callout = scene?.querySelector<HTMLElement>('.molly-intro-callout');
    if (!scene || !artwork || !callout || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => {
      if (!artwork.naturalWidth || !artwork.naturalHeight) return;
      const origin = scene.getBoundingClientRect();
      const image = artwork.getBoundingClientRect();
      const label = callout.getBoundingClientRect();
      const scale = Math.min(
        image.width / artwork.naturalWidth,
        image.height / artwork.naturalHeight
      );
      const left = image.left - origin.left + (image.width - artwork.naturalWidth * scale) / 2;
      const top = image.top - origin.top + (image.height - artwork.naturalHeight * scale) / 2;
      const selectionLeft = left + 75 * scale;
      const selectionBottom = top + 417 * scale;
      const x = label.left - origin.left;
      const y = label.top - origin.top + label.height / 2;
      setLine({
        path: `M ${selectionLeft} ${selectionBottom} L ${x - 12} ${y - 12} Q ${x - 16} ${y} ${x} ${y}`,
        x,
        y,
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(scene);
    Array.from(scene.children).forEach((child) => observer.observe(child));
    observer.observe(callout);
    artwork.addEventListener('load', update);
    update();
    return () => {
      observer.disconnect();
      artwork.removeEventListener('load', update);
    };
  }, []);
  return (
    <svg ref={ref} className="molly-intro-connector" aria-hidden="true" focusable="false">
      {line ? (
        <>
          <path d={line.path} fill="none" stroke="currentColor" strokeWidth={1} />
          <circle cx={line.x} cy={line.y} r={2} fill="currentColor" />
        </>
      ) : null}
    </svg>
  );
}

export function IntroPage({
  scene,
  onStart,
  onSelect,
  soundControl,
}: {
  scene: IntroScene;
  onStart: () => void;
  onSelect: (scene: IntroScene) => void;
  soundControl?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const index = SCENES.findIndex((item) => item.id === scene);
  const current = SCENES[index];
  const isChinese = i18n.resolvedLanguage === 'zh_CN';
  const isFinal = scene === 'expression';
  return (
    <div className="molly-intro" lang={isChinese ? 'zh-CN' : 'en'} data-native-tab-surface="">
      {SCENES.map((item) => (
        <link key={item.id} rel="preload" as="image" href={item.image} />
      ))}
      <div className="molly-intro-frame">
        <header className="molly-intro-header">
          <div className="molly-intro-brand">
            <img src={mollyMark} alt="" width={30} height={30} />
            <span>Molly</span>
          </div>
          {soundControl}
        </header>
        <main
          key={scene}
          className={`molly-intro-scene molly-intro-${scene}`}
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="molly-intro-copy">
            {scene === 'inspiration' && isChinese ? (
              <p className="molly-intro-art-phrase" lang="en">
                {t('onboarding.intro.inspiration.artPhrase')}
              </p>
            ) : null}
            <h1 className={isFinal ? 'sr-only' : 'molly-intro-title'}>
              {t(`onboarding.intro.${scene}.title`)}
            </h1>
            <p className="molly-intro-description">{t(`onboarding.intro.${scene}.description`)}</p>
          </div>
          <img
            src={current.image}
            alt=""
            aria-hidden="true"
            className="molly-intro-artwork"
            draggable={false}
          />
          {scene === 'creation' ? (
            <>
              <div className="molly-intro-example">
                <p className="molly-intro-callout">{t('onboarding.intro.creation.callout')}</p>
                <p className="molly-intro-example-label">
                  {t('onboarding.intro.creation.example')}
                </p>
              </div>
              <CreationConnector />
            </>
          ) : null}
        </main>
        <footer className="molly-intro-footer">
          <div className="molly-intro-progress">
            <div
              className="molly-intro-segments"
              role="group"
              aria-label={t('onboarding.intro.navigation')}
            >
              {SCENES.map((item, pageIndex) => (
                <button
                  key={item.id}
                  type="button"
                  className="app-region-no-drag"
                  aria-label={t('onboarding.intro.selectScene', {
                    number: pageIndex + 1,
                    title: t(`onboarding.intro.${item.id}.title`),
                  })}
                  aria-current={item.id === scene ? 'step' : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
            <span className="molly-intro-count" aria-hidden="true">
              0{index + 1} / 03
            </span>
          </div>
          <Button
            variant={isFinal ? 'default' : 'ghost'}
            onClick={onStart}
            className={isFinal ? 'molly-intro-start' : 'molly-intro-skip'}
          >
            {t(isFinal ? 'onboarding.intro.cta' : 'onboarding.intro.skip')}
            {isFinal ? <ArrowRight aria-hidden="true" className="size-4" /> : null}
          </Button>
        </footer>
      </div>
    </div>
  );
}

export function IntroSequence({
  playing = true,
  onStart,
  soundControl,
  getElapsedMs = currentTimeMs,
}: {
  playing?: boolean;
  onStart: () => void;
  soundControl?: ReactNode;
  getElapsedMs?: () => number;
}) {
  const [index, setIndex] = useState(0);
  const [manual, setManual] = useState(false);
  const remainingRef = useRef(3000);
  const reducedMotion = useSyncExternalStore(
    subscribeToMotionPreference,
    prefersReducedMotion,
    () => true
  );
  useEffect(() => {
    if (!playing || manual || reducedMotion || index === INTRO_SHOT_COUNT - 1) return undefined;
    const startedAt = getElapsedMs();
    let advanced = false;
    const timer = window.setTimeout(() => {
      advanced = true;
      remainingRef.current = 3000;
      setIndex((value) => value + 1);
    }, remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      if (!advanced) {
        remainingRef.current = Math.max(0, remainingRef.current - (getElapsedMs() - startedAt));
      }
    };
  }, [index, playing, manual, reducedMotion, getElapsedMs]);
  return (
    <IntroPage
      scene={SCENES[index].id}
      onStart={onStart}
      soundControl={soundControl}
      onSelect={(scene) => {
        setManual(true);
        setIndex(SCENES.findIndex((item) => item.id === scene));
      }}
    />
  );
}
