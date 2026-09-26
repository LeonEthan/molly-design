import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom } from 'jotai';
import { Monitor, Moon, Sun } from 'lucide-react';

import {
  conversationFontSizeAtom,
  CONVERSATION_FONT_SIZE_MAX,
  CONVERSATION_FONT_SIZE_MIN,
  interfaceFontFamilyAtom,
  normalizeConversationFontSize,
  type ConversationFontSize,
} from '@/atoms';
import { OptionSelector, type OptionSelectorOption } from '@/components/shared/option-selector';
import { listSystemFontFamilies } from '@/lib/local-fonts';
import { Input } from '@/ui/input';
import { LanguageSelector } from '../../i18n';
import { useTheme, type Theme } from '../../theme-provider';
import { settingContainerClass } from '.';
import { CompactRow, CompactSection } from './compact-layout';
import { PreviewSelect, type PreviewSelectOption } from './preview-select';

export type SystemFontLoadState = 'idle' | 'loading' | 'loaded' | 'error';

export interface AppearanceSettingsViewProps {
  theme: Theme;
  onThemePreview: (value: Theme) => void;
  onThemeCommit: (value: Theme) => void;
  onThemeCancel: () => void;
  conversationFontSize: ConversationFontSize;
  onConversationFontSizeChange: (value: ConversationFontSize) => void;
  isElectron: boolean;
  interfaceFontFamily: string;
  onInterfaceFontFamilyChange: (value: string) => void;
  systemFontFamilies: string[];
  systemFontLoadState: SystemFontLoadState;
  onSystemFontMenuOpen: () => void;
}

function buildSystemFontOptions(
  families: string[],
  selectedFamily: string,
  defaultLabel: string,
  defaultKey: string
): OptionSelectorOption<string>[] {
  const availableFamilies = families.some(
    (family) => family.toLowerCase() === selectedFamily.toLowerCase()
  )
    ? families
    : selectedFamily
      ? [selectedFamily, ...families]
      : families;

  return [
    { key: defaultKey, value: '', label: defaultLabel },
    ...availableFamilies.map((family) => ({ value: family, label: family })),
  ];
}

export function AppearanceSettingsView({
  theme,
  onThemePreview,
  onThemeCommit,
  onThemeCancel,
  conversationFontSize,
  onConversationFontSizeChange,
  isElectron,
  interfaceFontFamily,
  onInterfaceFontFamilyChange,
  systemFontFamilies,
  systemFontLoadState,
  onSystemFontMenuOpen,
}: AppearanceSettingsViewProps) {
  const { t } = useTranslation();

  const themeOptions: PreviewSelectOption<Theme>[] = [
    {
      value: 'light',
      label: (
        <div className="flex items-center gap-2">
          <Sun className="h-4 w-4" />
          <span>{t('settings.theme.light')}</span>
        </div>
      ),
    },
    {
      value: 'dark',
      label: (
        <div className="flex items-center gap-2">
          <Moon className="h-4 w-4" />
          <span>{t('settings.theme.dark')}</span>
        </div>
      ),
    },
    {
      value: 'system',
      label: (
        <div className="flex items-center gap-2">
          <Monitor className="h-4 w-4" />
          <span>{t('settings.theme.system')}</span>
        </div>
      ),
    },
  ];

  const defaultFontLabel = t('settings.fontFamily.placeholder', 'Default');
  const interfaceFontOptions = useMemo(
    () =>
      buildSystemFontOptions(
        systemFontFamilies,
        interfaceFontFamily,
        defaultFontLabel,
        'interface-font-default'
      ),
    [defaultFontLabel, interfaceFontFamily, systemFontFamilies]
  );

  const fontLoadStatus =
    systemFontLoadState === 'loading' ? (
      <span>{t('settings.fontFamily.loading', 'Loading system fonts...')}</span>
    ) : systemFontLoadState === 'error' ? (
      <span className="text-destructive">
        {t(
          'settings.fontFamily.unavailable',
          'System fonts could not be loaded. Reopen the menu to try again.'
        )}
      </span>
    ) : null;

  return (
    <div className={settingContainerClass}>
      <CompactSection>
        <CompactRow label={t('settings.theme.label')}>
          <PreviewSelect
            value={theme}
            options={themeOptions}
            onPreview={onThemePreview}
            onCommit={onThemeCommit}
            onCancel={onThemeCancel}
            triggerClassName="w-full sm:w-[220px]"
          />
        </CompactRow>
        <CompactRow label={t('settings.language.label')}>
          <LanguageSelector triggerClassName="w-full sm:w-[220px]" />
        </CompactRow>
      </CompactSection>

      <CompactSection>
        {isElectron ? (
          <CompactRow
            label={t('settings.interfaceFontFamily.label', 'Interface font')}
            helper={
              <span className="flex flex-col gap-0.5">
                <span>
                  {t(
                    'settings.interfaceFontFamily.helper',
                    'Choose an installed font for the interface and conversation content.'
                  )}
                </span>
                {fontLoadStatus}
              </span>
            }
          >
            <OptionSelector
              value={interfaceFontFamily}
              options={interfaceFontOptions}
              onSelect={(option) => onInterfaceFontFamilyChange(option.value)}
              placeholder={defaultFontLabel}
              searchable
              searchPlaceholder={t('settings.fontFamily.searchPlaceholder', 'Search system fonts...')}
              emptyText={t('settings.fontFamily.empty', 'No matching fonts')}
              align="end"
              className="w-full rounded-md border-input-border bg-input-field sm:w-[220px] hover:bg-input-field"
              contentClassName="w-[320px]"
              onOpenChange={(open) => {
                if (open) onSystemFontMenuOpen();
              }}
              renderTriggerValue={(option) => (
                <span
                  className="truncate font-normal"
                  style={{ fontFamily: 'var(--font-sans-default)' }}
                >
                  {option?.label ?? interfaceFontFamily}
                </span>
              )}
              renderOption={(option) => (
                <span
                  className="min-w-0 flex-1 truncate"
                  style={{ fontFamily: 'var(--font-sans-default)' }}
                >
                  {option.label}
                </span>
              )}
            />
          </CompactRow>
        ) : null}
        <CompactRow
          label={t('settings.conversationFontSize.label', 'Conversation font size')}
          helper={t(
            'settings.conversationFontSize.helper',
            'Adjusts message body text in conversations.'
          )}
        >
          <Input
            type="number"
            min={CONVERSATION_FONT_SIZE_MIN}
            max={CONVERSATION_FONT_SIZE_MAX}
            step={1}
            value={conversationFontSize}
            aria-label={t('settings.conversationFontSize.label', 'Conversation font size')}
            className="w-24"
            onChange={(event) => {
              if (Number.isFinite(event.target.valueAsNumber)) {
                onConversationFontSizeChange(
                  normalizeConversationFontSize(event.target.valueAsNumber)
                );
              }
            }}
          />
        </CompactRow>
      </CompactSection>

    </div>
  );
}

function DesktopAppearanceSettings() {
  const { theme, setTheme, previewTheme } = useTheme();
  const [conversationFontSize, setConversationFontSize] = useAtom(conversationFontSizeAtom);
  const [interfaceFontFamily, setInterfaceFontFamily] = useAtom(interfaceFontFamilyAtom);
  const [systemFontFamilies, setSystemFontFamilies] = useState<string[]>([]);
  const [systemFontLoadState, setSystemFontLoadState] = useState<SystemFontLoadState>('idle');
  const isElectron = typeof window !== 'undefined' && window.__MOLLY_ELECTRON__ === true;
  const savedThemeRef = useRef<Theme>(theme);

  const handleThemePreview = useCallback(
    (value: Theme) => {
      previewTheme(value);
    },
    [previewTheme]
  );
  const handleThemeCommit = useCallback(
    (value: Theme) => {
      savedThemeRef.current = value;
      setTheme(value);
    },
    [setTheme]
  );
  const handleThemeCancel = useCallback(() => {
    setTheme(savedThemeRef.current);
  }, [setTheme]);

  const handleSystemFontMenuOpen = useCallback(() => {
    if (systemFontLoadState === 'loading' || systemFontLoadState === 'loaded') return;

    const fontRequest = listSystemFontFamilies();
    setSystemFontLoadState('loading');
    void fontRequest
      .then((families) => {
        setSystemFontFamilies(families);
        setSystemFontLoadState('loaded');
      })
      .catch((error: unknown) => {
        console.warn('Failed to enumerate system fonts', error);
        setSystemFontLoadState('error');
      });
  }, [systemFontLoadState]);

  return (
    <AppearanceSettingsView
      theme={theme}
      onThemePreview={handleThemePreview}
      onThemeCommit={handleThemeCommit}
      onThemeCancel={handleThemeCancel}
      conversationFontSize={conversationFontSize}
      onConversationFontSizeChange={setConversationFontSize}
      isElectron={isElectron}
      interfaceFontFamily={interfaceFontFamily}
      onInterfaceFontFamilyChange={setInterfaceFontFamily}
      systemFontFamilies={systemFontFamilies}
      systemFontLoadState={systemFontLoadState}
      onSystemFontMenuOpen={handleSystemFontMenuOpen}
    />
  );
}

export function AppearanceSettingsComponent() {
  return <DesktopAppearanceSettings />;
}
