import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ModelThinkingLevelSchema,
  type CompatibleModelDefinition,
} from '@molly/shared/embedded-harness';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';

export type CompatibleModelDraft = Omit<
  CompatibleModelDefinition,
  'contextWindow' | 'maxTokens'
> & {
  contextWindow: string;
  maxTokens: string;
};

export function compatibleModelDraft(model?: CompatibleModelDefinition): CompatibleModelDraft {
  return model
    ? { ...model, contextWindow: String(model.contextWindow), maxTokens: String(model.maxTokens) }
    : {
        modelId: '',
        name: '',
        input: ['text'],
        contextWindow: '',
        maxTokens: '',
        thinking: ['off'],
        toolCalls: false,
        usageInStreaming: false,
        maxTokensField: 'max_tokens',
      };
}

export function CompatibleModelFields({
  models,
  busy,
  onChange,
}: {
  models: CompatibleModelDraft[];
  busy: boolean;
  onChange: (models: CompatibleModelDraft[]) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const update = (index: number, patch: Partial<CompatibleModelDraft>) =>
    onChange(models.map((model, current) => (current === index ? { ...model, ...patch } : model)));
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('settings.models.compatibleHint')}</p>
      {models.map((model, index) => (
        <fieldset key={index} disabled={busy} className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm">
            {t('settings.models.customModel', { number: index + 1 })}
          </legend>
          {(
            [
              ['modelId', 'settings.models.customModelId', 200],
              ['name', 'settings.models.customModelName', 300],
            ] as const
          ).map(([key, label, maxLength]) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`${id}-${index}-${key}`}>{t(label)}</Label>
              <Input
                id={`${id}-${index}-${key}`}
                value={model[key]}
                maxLength={maxLength}
                onChange={(event) => update(index, { [key]: event.target.value })}
              />
            </div>
          ))}
          {(
            [
              ['contextWindow', 'settings.models.contextWindow'],
              ['maxTokens', 'settings.models.maxOutputTokens'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`${id}-${index}-${key}`}>{t(label)}</Label>
              <Input
                id={`${id}-${index}-${key}`}
                type="number"
                min={1}
                max={16_777_216}
                step={1}
                value={model[key]}
                onChange={(event) => update(index, { [key]: event.target.value })}
              />
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor={`${id}-${index}-token-field`}>
              {t('settings.models.maxTokensField')}
            </Label>
            <Select
              value={model.maxTokensField}
              disabled={busy}
              onValueChange={(value) => {
                if (value === 'max_tokens' || value === 'max_completion_tokens')
                  update(index, { maxTokensField: value });
              }}
            >
              <SelectTrigger id={`${id}-${index}-token-field`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="max_tokens">max_tokens</SelectItem>
                <SelectItem value="max_completion_tokens">max_completion_tokens</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(
            [
              ['image', 'settings.models.imageInput', model.input.includes('image')],
              ['toolCalls', 'settings.models.toolCalls', model.toolCalls],
              ['usageInStreaming', 'settings.models.streamingUsage', model.usageInStreaming],
            ] as const
          ).map(([key, label, checked]) => (
            <div key={key} className="flex items-center gap-2">
              <Checkbox
                id={`${id}-${index}-${key}`}
                disabled={busy}
                checked={checked}
                onCheckedChange={(value) => {
                  if (key === 'image')
                    update(index, { input: value === true ? ['text', 'image'] : ['text'] });
                  else update(index, { [key]: value === true });
                }}
              />
              <Label htmlFor={`${id}-${index}-${key}`}>{t(label)}</Label>
            </div>
          ))}
          {!model.toolCalls && (
            <p className="text-xs text-muted-foreground">
              {t('settings.models.toolsRequiredHint')}
            </p>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm">{t('settings.models.thinkingLevels')}</legend>
            <div className="flex flex-wrap gap-3">
              {ModelThinkingLevelSchema.options.map((level) => (
                <div key={level} className="flex items-center gap-1">
                  <Checkbox
                    id={`${id}-${index}-thinking-${level}`}
                    disabled={busy}
                    checked={model.thinking.includes(level)}
                    onCheckedChange={(value) =>
                      update(index, {
                        thinking: ModelThinkingLevelSchema.options.filter((candidate) =>
                          candidate === level ? value === true : model.thinking.includes(candidate)
                        ),
                      })
                    }
                  />
                  <Label htmlFor={`${id}-${index}-thinking-${level}`}>{level}</Label>
                </div>
              ))}
            </div>
          </fieldset>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onChange(models.filter((_, current) => current !== index))}
          >
            {t('settings.models.removeCustomModel', { number: index + 1 })}
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy || models.length >= 32}
        onClick={() => onChange([...models, compatibleModelDraft()])}
      >
        {t('settings.models.addCustomModel')}
      </Button>
    </div>
  );
}
