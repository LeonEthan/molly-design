import { useState } from 'react';
import { ListChecks, Loader2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { McpDiscoveredTool, McpToolDiscoveryResult } from '@molly/shared/embedded-harness';
import { Button } from '@/ui/button';
import { Field } from './form-primitives';

type ListState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; result: McpToolDiscoveryResult };

const HINTS = [
  ['readOnlyHint', 'readOnly'],
  ['destructiveHint', 'destructive'],
  ['openWorldHint', 'openWorld'],
] as const;

/**
 * Live, advisory tool list for one saved server. Hints are what the server declares, never
 * verified; nothing here is stored or changes a rule unless the user adds one.
 */
export function McpToolList({
  disabled,
  listTools,
  ruledNames,
  onAddRule,
}: {
  disabled: boolean;
  listTools: () => Promise<McpToolDiscoveryResult>;
  ruledNames: ReadonlySet<string>;
  onAddRule: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<ListState>({ status: 'idle' });
  const run = async () => {
    setState({ status: 'loading' });
    const result = await listTools().catch(
      (): McpToolDiscoveryResult => ({ ok: false, reason: 'unavailable' })
    );
    setState({ status: 'done', result });
  };

  return (
    <Field label={t('settings.mcp.tools.label')} hint={t('settings.mcp.tools.hint')}>
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={disabled || state.status === 'loading'}
          onClick={() => void run()}
        >
          {state.status === 'loading' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {t('settings.mcp.tools.list')}
        </Button>
        {disabled ? (
          <p className="text-xs text-muted-foreground">{t('settings.mcp.tools.saveFirst')}</p>
        ) : null}
        {state.status === 'done' && !state.result.ok ? (
          <p role="status" className="text-xs text-destructive">
            {t(`settings.mcp.tools.failure.${state.result.reason}`)}
          </p>
        ) : null}
        {state.status === 'done' && state.result.ok ? (
          <ToolRows
            tools={state.result.tools}
            truncated={state.result.truncated}
            ruledNames={ruledNames}
            onAddRule={onAddRule}
          />
        ) : null}
      </div>
    </Field>
  );
}

function ToolRows({
  tools,
  truncated,
  ruledNames,
  onAddRule,
}: {
  tools: McpDiscoveredTool[];
  truncated: boolean;
  ruledNames: ReadonlySet<string>;
  onAddRule: (name: string) => void;
}) {
  const { t } = useTranslation();
  if (tools.length === 0)
    return <p className="text-xs text-muted-foreground">{t('settings.mcp.tools.empty')}</p>;
  return (
    <div className="space-y-1">
      <ul className="divide-y divide-border/40 rounded-md border border-border/50">
        {tools.map((tool) => {
          const hints = HINTS.filter(([key]) => tool[key] === true);
          return (
            <li key={tool.name} className="flex items-start gap-2 px-2.5 py-2">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs">{tool.name}</span>
                  {hints.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground">
                      {t('settings.mcp.tools.noHints')}
                    </span>
                  ) : (
                    hints.map(([key, label]) => (
                      <span
                        key={key}
                        className={
                          key === 'destructiveHint'
                            ? 'rounded bg-destructive/10 px-1.5 py-px text-[11px] text-destructive'
                            : 'rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground'
                        }
                      >
                        {t(`settings.mcp.tools.hints.${label}`)}
                      </span>
                    ))
                  )}
                </div>
                {tool.description ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{tool.description}</p>
                ) : null}
              </div>
              {ruledNames.has(tool.name) ? (
                <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
                  {t('settings.mcp.tools.hasRule')}
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground"
                  aria-label={t('settings.mcp.tools.addRuleFor', { name: tool.name })}
                  onClick={() => onAddRule(tool.name)}
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  {t('settings.mcp.tools.addRule')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {truncated ? (
        <p className="text-xs text-muted-foreground">{t('settings.mcp.tools.truncated')}</p>
      ) : null}
    </div>
  );
}
