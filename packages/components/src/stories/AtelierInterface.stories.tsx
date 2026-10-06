import { useState, type ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { useTranslation } from 'react-i18next';
import { MollyWordmark } from '@/components/molly-wordmark';
import { WebChatLandingScreen } from '@/components/chat/web-chat-landing-screen';
import { HomeIdeaChips } from '@/components/chat/home-idea-chips';
import { CanvasFormatTiles, CanvasSizeSelector } from '@/components/chat/canvas-size-selector';
import { CompactRow, CompactSection } from '@/components/settings/compact-layout';
type CanvasSize = Pick<ComponentProps<typeof CanvasSizeSelector>, 'mode' | 'width' | 'height'>;

function AtelierInterface({ narrow = false }: { narrow?: boolean }) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<CanvasSize>({ mode: 'auto', width: 800, height: 600 });
  return (
    <div
      className="mx-auto bg-background font-sans text-foreground"
      style={{
        width: narrow ? 360 : '100%',
        maxWidth: '100%',
        fontFamily: 'var(--font-sans-default)',
      }}
    >
      <header className="flex h-20 items-center border-b border-hairline px-6">
        <MollyWordmark className="h-9" />
      </header>
      <div className="h-[740px]">
        <WebChatLandingScreen
          title={
            <>
              {t('home.headlineBefore')}
              <em>{t('home.headlineEmphasis')}</em>
              {t('home.headlineAfter')}
            </>
          }
          eyebrow={t('home.eyebrow')}
          subtitle={t('home.subtitle')}
          composer={
            <div className="rounded-3xl border border-border bg-card p-4">
              <textarea
                aria-label={t('chat.heading')}
                placeholder={t('chat.heading')}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                className="min-h-20 w-full resize-none bg-transparent text-sm outline-none"
              />
              <CanvasSizeSelector {...size} disabled={false} onChange={setSize} />
            </div>
          }
          ideas={
            <HomeIdeaChips
              label={t('home.ideasLabel')}
              ideas={[1, 2, 3, 4].map((index) => ({
                label: t(`home.idea${index}.label`),
                prompt: t(`home.idea${index}.prompt`),
              }))}
              disabled={false}
              onPick={setPrompt}
            />
          }
          contextSwitch={<CanvasFormatTiles {...size} disabled={false} onChange={setSize} />}
          gallery={
            <CompactSection title={t('settings.tabs.about')}>
              <div className="px-5 py-6">
                <MollyWordmark className="h-12" />
              </div>
              <CompactRow label={t('settings.about.version')}>
                <span className="font-mono text-xs">1.0.0</span>
              </CompactRow>
            </CompactSection>
          }
        />
      </div>
    </div>
  );
}

const meta = {
  title: 'Brand/Atelier interface',
  component: AtelierInterface,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AtelierInterface>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LightEnglish: Story = { globals: { theme: 'light', locale: 'en' } };
export const DarkEnglish: Story = { globals: { theme: 'dark', locale: 'en' } };
export const LightChineseNarrow: Story = {
  args: { narrow: true },
  globals: { theme: 'light', locale: 'zh_CN' },
};
export const DarkChineseNarrow: Story = {
  args: { narrow: true },
  globals: { theme: 'dark', locale: 'zh_CN' },
};
