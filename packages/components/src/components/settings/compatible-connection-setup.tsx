import { useTranslation } from 'react-i18next';
import {
  COMPATIBLE_CONNECTION_PRESETS,
  CompatibleConnectionApiSchema,
  isCompatibleConnectionApiShipped,
  type CompatibleConnectionApi,
  type CompatibleConnectionPreset,
} from '@molly/shared/embedded-harness';
import { compatibleModelDraft, type CompatibleModelDraft } from './compatible-model-fields';
import { SegmentedControl } from '@/components/shared/segmented-control';
import { Button } from '@/ui/button';
import { Label } from '@/ui/label';
import { cn } from '@/lib/utils';

const API_LABEL_KEYS: Record<CompatibleConnectionApi, string> = {
  'anthropic-messages': 'settings.models.compatibleApi.anthropicMessages',
  'openai-completions': 'settings.models.compatibleApi.openaiChatCompletions',
  'openai-responses': 'settings.models.compatibleApi.openaiResponses',
  'google-generative-ai': 'settings.models.compatibleApi.geminiGenerateContent',
};

export function CompatibleConnectionSetup({
  compatibleApi,
  busy,
  onApiChange,
  onApplyPreset,
}: {
  compatibleApi: CompatibleConnectionApi;
  busy: boolean;
  onApiChange: (api: CompatibleConnectionApi) => void;
  onApplyPreset: (preset: CompatibleConnectionPreset) => void;
}) {
  const { t } = useTranslation();
  const connectionTypeOptions = CompatibleConnectionApiSchema.options.map((api) => ({
    value: api,
    label: isCompatibleConnectionApiShipped(api)
      ? t(API_LABEL_KEYS[api])
      : t('settings.models.compatibleApi.unavailable', { name: t(API_LABEL_KEYS[api]) }),
    disabled: !isCompatibleConnectionApiShipped(api),
  }));
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t('settings.models.compatibleApi.label')}</Label>
        <SegmentedControl
          ariaLabel={t('settings.models.compatibleApi.label')}
          size="sm"
          value={compatibleApi}
          disabled={busy}
          options={connectionTypeOptions}
          onChange={(value) => {
            if (isCompatibleConnectionApiShipped(value)) onApiChange(value);
          }}
        />
        <p className="text-xs text-muted-foreground">{t('settings.models.compatibleApi.hint')}</p>
      </div>
      <div className="space-y-2">
        <Label>{t('settings.models.compatiblePresets.label')}</Label>
        <div className="flex flex-wrap gap-2">
          {COMPATIBLE_CONNECTION_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              className={cn('h-8 text-xs')}
              onClick={() => onApplyPreset(preset)}
            >
              {t(preset.labelKey)}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('settings.models.compatiblePresets.hint')}</p>
      </div>
    </div>
  );
}

export function presetToCustomModels(preset: CompatibleConnectionPreset): CompatibleModelDraft[] {
  if (!preset.starterModel) return [];
  const model = preset.starterModel;
  return [
    compatibleModelDraft({
      ...model,
      usageInStreaming: false,
    }),
  ];
}
