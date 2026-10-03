import { useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { HarnessModelCatalog } from '@molly/shared/embedded-harness';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Input } from '@/ui/input';
import { Search } from '@/ui/icons';

export type CatalogModel = HarnessModelCatalog['models'][number];

export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

function Tag({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={
        muted
          ? 'shrink-0 text-[11px] text-muted-foreground/80'
          : 'shrink-0 rounded-full bg-foreground/[0.05] px-1.5 py-px text-[11px] text-muted-foreground'
      }
    >
      {children}
    </span>
  );
}

/**
 * Chooses which catalog models a connection offers in the conversation picker. `listed`
 * marks the models the provider reported for this key; it informs, it never selects.
 */
export function ModelChecklist({
  models,
  selected,
  listed,
  disabled = false,
  onChange,
}: {
  models: readonly CatalogModel[];
  selected: readonly string[];
  listed?: ReadonlySet<string>;
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? models.filter(
          (model) =>
            model.name.toLowerCase().includes(needle) ||
            model.modelId.toLowerCase().includes(needle)
        )
      : models;
  }, [models, query]);
  const chosen = new Set(selected);
  const toggle = (modelId: string, on: boolean) =>
    onChange(
      models
        .map((model) => model.modelId)
        .filter((candidate) => (candidate === modelId ? on : chosen.has(candidate)))
    );
  const setVisible = (on: boolean) => {
    const affected = new Set(visible.map((model) => model.modelId));
    onChange(
      models
        .map((model) => model.modelId)
        .filter((candidate) => (affected.has(candidate) ? on : chosen.has(candidate)))
    );
  };
  return (
    <div className="overflow-hidden rounded-xl border border-border/60">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Input
          aria-label={t('settings.models.picker.search')}
          placeholder={t('settings.models.picker.search')}
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
        />
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {t('settings.models.picker.count', { selected: selected.length, total: models.length })}
        </span>
      </div>
      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          disabled={disabled || visible.length === 0}
          onClick={() => setVisible(true)}
        >
          {query ? t('settings.models.picker.selectShown') : t('settings.models.picker.selectAll')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          disabled={disabled || visible.length === 0}
          onClick={() => setVisible(false)}
        >
          {query ? t('settings.models.picker.clearShown') : t('settings.models.picker.clearAll')}
        </Button>
      </div>
      <ul className="max-h-64 overflow-y-auto py-1">
        {visible.length === 0 ? (
          <li className="px-3 py-3 text-xs text-muted-foreground">
            {t('settings.models.picker.empty')}
          </li>
        ) : (
          visible.map((model) => {
            const checkboxId = `${id}-${model.modelId}`;
            return (
              <li key={model.modelId}>
                <label
                  htmlFor={checkboxId}
                  className="flex cursor-default items-center gap-2.5 px-3 py-1.5 hover:bg-foreground/[0.03]"
                >
                  <Checkbox
                    id={checkboxId}
                    checked={chosen.has(model.modelId)}
                    disabled={disabled}
                    onCheckedChange={(value) => toggle(model.modelId, value === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-xs text-foreground">{model.name}</span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground">
                        {model.modelId}
                      </span>
                    </span>
                  </span>
                  {listed && !listed.has(model.modelId) ? (
                    <Tag muted>{t('settings.models.picker.notListed')}</Tag>
                  ) : null}
                  {model.input.includes('image') ? (
                    <Tag>{t('settings.models.picker.seesImages')}</Tag>
                  ) : null}
                  {model.thinking.some((level) => level !== 'off') ? (
                    <Tag>{t('settings.models.picker.thinks')}</Tag>
                  ) : null}
                  <Tag>{formatContextWindow(model.contextWindow)}</Tag>
                </label>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
