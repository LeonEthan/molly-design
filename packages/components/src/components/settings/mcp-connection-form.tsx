import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { FileJson, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  MCP_EXPOSURES,
  parseMcpJsonImport,
  type McpConnectionSpec,
  type McpExposure,
  type McpToolExposureRule,
  type McpTransport,
  type WorkspaceMcpServerMeta,
} from '@molly/shared';
import { SegmentedControl } from '@/components/shared/segmented-control';
import {
  MCP_TRANSPORT_SHORT_LABELS,
  MCP_TRANSPORTS,
  McpTransportIcon,
} from '@/components/shared/mcp-transport';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Switch } from '@/ui/switch';
import { Textarea } from '@/ui/textarea';
import { Field, Section } from './form-primitives';

type KeyValueDraft = { key: string; value: string };
type ToolExposureDraft = McpToolExposureRule;

type McpConnectionFormDraft = {
  name: string;
  description: string;
  exposure: McpExposure;
  toolExposure: ToolExposureDraft[];
  transport: McpTransport;
  enabledByDefault: boolean;
  command: string;
  args: string[];
  env: KeyValueDraft[];
  envPassthrough: string[];
  url: string;
  bearerToken: string;
  headers: KeyValueDraft[];
  protectedCredentials?: McpConnectionSpec['protectedCredentials'];
};

export type McpConnectionFormValue = {
  name: string;
  description?: string;
  exposure?: McpExposure;
  toolExposure?: McpToolExposureRule[];
  transport: McpTransport;
  enabledByDefault: boolean;
  connection?: McpConnectionSpec;
};

type McpConnectionFormSource = Partial<
  Pick<
    WorkspaceMcpServerMeta,
    | 'name'
    | 'description'
    | 'exposure'
    | 'toolExposure'
    | 'transport'
    | 'enabledByDefault'
    | 'connection'
  >
>;

const emptyConnectionFields = (transport: McpTransport) => ({
  command: '',
  args: transport === 'stdio' ? [''] : [],
  env: [] as KeyValueDraft[],
  envPassthrough: [] as string[],
  url: '',
  bearerToken: '',
  headers: [] as KeyValueDraft[],
});

const createMcpConnectionFormDraft = (entry?: McpConnectionFormSource): McpConnectionFormDraft => {
  const transport = entry?.transport ?? 'stdio';
  const connection = entry?.connection;
  return {
    name: entry?.name ?? '',
    description: entry?.description ?? '',
    exposure: entry?.exposure ?? 'codemode',
    toolExposure: (entry?.toolExposure ?? []).map((rule) => ({ ...rule })),
    transport,
    enabledByDefault: entry?.enabledByDefault ?? false,
    ...emptyConnectionFields(transport),
    protectedCredentials: connection?.protectedCredentials,
    ...(connection?.transport === 'stdio'
      ? {
          command: connection.command,
          args: connection.args?.length ? [...connection.args] : [''],
          env: Object.entries(connection.env ?? {}).map(([key, value]) => ({ key, value })),
          envPassthrough: connection.envPassthrough?.length ? [...connection.envPassthrough] : [],
        }
      : connection?.transport === 'http'
        ? {
            url: connection.url,
            bearerToken: connection.bearerToken ?? '',
            headers: Object.entries(connection.headers ?? {}).map(([key, value]) => ({
              key,
              value,
            })),
          }
        : {}),
  };
};

const compactRecord = (rows: readonly KeyValueDraft[]): Record<string, string> | undefined => {
  const entries = rows
    .map(({ key, value }) => [key.trim(), value] as const)
    .filter(([key]) => key.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const buildStdioConnection = (draft: McpConnectionFormDraft): McpConnectionSpec | undefined => {
  const command = draft.command.trim();
  if (!command) return undefined;
  const args = draft.args.filter((arg) => arg.length > 0);
  const env = compactRecord(draft.env);
  const envPassthrough = [...new Set(draft.envPassthrough.map((name) => name.trim()))].filter(
    Boolean
  );
  return {
    transport: 'stdio',
    ...(draft.protectedCredentials ? { protectedCredentials: draft.protectedCredentials } : {}),
    command,
    ...(args.length > 0 ? { args } : {}),
    ...(env ? { env } : {}),
    ...(envPassthrough.length > 0 ? { envPassthrough } : {}),
  };
};

const buildHttpConnection = (draft: McpConnectionFormDraft): McpConnectionSpec | undefined => {
  const url = draft.url.trim();
  if (!url) return undefined;
  const headers = compactRecord(draft.headers);
  const bearerToken = draft.bearerToken || undefined;
  return {
    transport: 'http',
    ...(draft.protectedCredentials ? { protectedCredentials: draft.protectedCredentials } : {}),
    url,
    ...(bearerToken ? { bearerToken } : {}),
    ...(headers ? { headers } : {}),
  };
};

const buildToolExposure = (
  rows: readonly ToolExposureDraft[]
): McpToolExposureRule[] | undefined => {
  const seen = new Set<string>();
  const rules = rows
    .map(({ pattern, exposure }) => ({ pattern: pattern.trim(), exposure }))
    .filter(({ pattern }) => pattern.length > 0 && !seen.has(pattern) && seen.add(pattern));
  return rules.length > 0 ? rules : undefined;
};

const buildMcpConnectionFormValue = (draft: McpConnectionFormDraft): McpConnectionFormValue => {
  const description = draft.description.trim() || undefined;
  const toolExposure = buildToolExposure(draft.toolExposure);
  const connection =
    draft.transport === 'stdio' ? buildStdioConnection(draft) : buildHttpConnection(draft);
  return {
    name: draft.name.trim(),
    ...(description ? { description } : {}),
    ...(draft.exposure !== 'codemode' ? { exposure: draft.exposure } : {}),
    ...(toolExposure ? { toolExposure } : {}),
    transport: draft.transport,
    enabledByDefault: draft.enabledByDefault,
    ...(connection ? { connection } : {}),
  };
};

/** Server editor body: a scrolling field stack plus the sticky action footer.
 *  It is sized by its container (the settings dialog), so it stays a plain
 *  `flex` column instead of owning any width or backdrop of its own. */
export function McpConnectionForm({
  initialEntry,
  submitting = false,
  error,
  onSubmit,
  onCancel,
  className,
}: {
  initialEntry?: WorkspaceMcpServerMeta;
  submitting?: boolean;
  error?: string;
  onSubmit: (value: McpConnectionFormValue) => void | Promise<void>;
  onCancel: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [draft, setDraft] = useState(() => createMcpConnectionFormDraft(initialEntry));
  const [needsCredentialReentry, setNeedsCredentialReentry] = useState(false);
  const hasCredentialInput = Boolean(
    draft.bearerToken ||
    draft.headers.some((row) => row.key.trim()) ||
    draft.env.some((row) => row.key.trim())
  );
  const setTransport = (transport: McpTransport) => {
    setDraft((current) => ({
      name: current.name,
      description: current.description,
      exposure: current.exposure,
      toolExposure: current.toolExposure,
      enabledByDefault: current.enabledByDefault,
      transport,
      ...emptyConnectionFields(transport),
      protectedCredentials: current.protectedCredentials,
    }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting || (needsCredentialReentry && !hasCredentialInput)) return;
    void onSubmit({
      ...buildMcpConnectionFormValue(draft),
    });
    setNeedsCredentialReentry(hasCredentialInput);
    setDraft((current) => ({ ...current, bearerToken: '', headers: [], env: [] }));
  };
  const isStdio = draft.transport === 'stdio';

  return (
    <form className={cn('flex min-h-0 flex-col', className)} onSubmit={submit}>
      <div className="scrollbar-pro min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {initialEntry ? null : (
          <McpJsonImport
            disabled={submitting}
            onImport={(source) => {
              setNeedsCredentialReentry(false);
              setDraft(createMcpConnectionFormDraft(source));
            }}
          />
        )}
        <Section title={t('settings.mcp.form.sectionIdentity')}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field htmlFor={`${fieldId}-name`} label={t('settings.mcp.form.name')}>
              <Input
                id={`${fieldId}-name`}
                required
                autoComplete="off"
                placeholder={t('settings.mcp.form.namePlaceholder')}
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </Field>
            <Field label={t('settings.mcp.form.transport')}>
              <TransportToggle value={draft.transport} onChange={setTransport} />
            </Field>
          </div>
          <Field
            htmlFor={`${fieldId}-description`}
            label={t('settings.mcp.form.description')}
            hint={t('settings.mcp.form.descriptionHint')}
          >
            <Textarea
              id={`${fieldId}-description`}
              rows={2}
              className="resize-none"
              value={draft.description}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
            />
          </Field>
        </Section>

        <Section
          title={t('settings.mcp.form.sectionAgentAccess')}
          hint={t('settings.mcp.form.sectionAgentAccessHint')}
        >
          <Field
            htmlFor={`${fieldId}-exposure`}
            label={t('settings.mcp.form.exposure')}
            hint={t(`settings.mcp.exposure.${draft.exposure}Hint`)}
          >
            <ExposureSelect
              id={`${fieldId}-exposure`}
              value={draft.exposure}
              onChange={(exposure) => setDraft((current) => ({ ...current, exposure }))}
            />
          </Field>
          <ListEditor
            label={t('settings.mcp.form.toolExposure')}
            hint={t('settings.mcp.form.toolExposureHint')}
            addLabel={t('settings.mcp.form.addToolRule')}
            onAdd={() =>
              setDraft((current) => ({
                ...current,
                toolExposure: [...current.toolExposure, { pattern: '', exposure: 'direct' }],
              }))
            }
          >
            {draft.toolExposure.map((rule, index) => {
              const update = (next: Partial<ToolExposureDraft>) =>
                setDraft((current) => ({
                  ...current,
                  toolExposure: current.toolExposure.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, ...next } : item
                  ),
                }));
              return (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_auto] items-center gap-1.5"
                >
                  <Input
                    aria-label={t('settings.mcp.form.toolPattern')}
                    placeholder={t('settings.mcp.form.toolPattern')}
                    value={rule.pattern}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono text-xs"
                    onChange={(event) => update({ pattern: event.target.value })}
                  />
                  <ExposureSelect
                    value={rule.exposure}
                    onChange={(exposure) => update({ exposure })}
                  />
                  <RemoveRowButton
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        toolExposure: current.toolExposure.filter(
                          (_, itemIndex) => itemIndex !== index
                        ),
                      }))
                    }
                  />
                </div>
              );
            })}
          </ListEditor>
        </Section>

        <Section
          title={t('settings.mcp.form.sectionConnection')}
          hint={t('settings.mcp.protectedStorageHint')}
        >
          {draft.protectedCredentials ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('settings.mcp.protectedStored')}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() => {
                  setNeedsCredentialReentry(false);
                  setDraft((current) => ({ ...current, protectedCredentials: undefined }));
                }}
              >
                {t('settings.mcp.removeStoredCredentials')}
              </Button>
            </div>
          ) : null}
          {isStdio ? (
            <>
              <Field
                htmlFor={`${fieldId}-command`}
                label={t('settings.mcp.form.command')}
                icon={<McpTransportIcon transport="stdio" />}
              >
                <Input
                  id={`${fieldId}-command`}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                  placeholder="/absolute/path/to/mcp-server"
                  value={draft.command}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, command: event.target.value }))
                  }
                />
              </Field>
              <StringListEditor
                label={t('settings.mcp.form.arguments')}
                addLabel={t('settings.mcp.form.addArgument')}
                values={draft.args}
                placeholder="--flag"
                onChange={(args) => setDraft((current) => ({ ...current, args }))}
              />
              <KeyValueEditor
                label={t('settings.mcp.form.environment')}
                addLabel={t('settings.mcp.form.addEnvironment')}
                rows={draft.env}
                onChange={(env) => setDraft((current) => ({ ...current, env }))}
              />
              {draft.envPassthrough.length ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {t('settings.mcp.legacyPassthrough')}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={submitting}
                    onClick={() => setDraft((current) => ({ ...current, envPassthrough: [] }))}
                  >
                    {t('common.remove')}
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <Field
                htmlFor={`${fieldId}-url`}
                label={t('settings.mcp.form.url')}
                icon={<McpTransportIcon transport="http" />}
              >
                <Input
                  id={`${fieldId}-url`}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                  placeholder="https://mcp.example.com/mcp"
                  value={draft.url}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, url: event.target.value }))
                  }
                />
              </Field>
              <Field
                htmlFor={`${fieldId}-token`}
                label={t('settings.mcp.form.bearerToken')}
                icon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
              >
                <Input
                  id={`${fieldId}-token`}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                  type="password"
                  value={draft.bearerToken}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, bearerToken: event.target.value }))
                  }
                />
              </Field>
              <KeyValueEditor
                label={t('settings.mcp.form.headers')}
                addLabel={t('settings.mcp.form.addHeader')}
                rows={draft.headers}
                keyPlaceholder="X-Header"
                onChange={(headers) => setDraft((current) => ({ ...current, headers }))}
              />
            </>
          )}
        </Section>

        <div className="flex items-center justify-between gap-4 rounded-xl bg-foreground/[0.04] px-4 py-4">
          <div className="min-w-0">
            <Label htmlFor={`${fieldId}-default`} className="text-sm">
              {t('settings.mcp.form.defaultEnabled')}
            </Label>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t('settings.mcp.form.defaultEnabledHint')}
            </p>
          </div>
          <Switch
            id={`${fieldId}-default`}
            checked={draft.enabledByDefault}
            onCheckedChange={(enabledByDefault) =>
              setDraft((current) => ({ ...current, enabledByDefault }))
            }
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-snug text-destructive"
          >
            {error}
          </p>
        ) : null}
        {needsCredentialReentry && !hasCredentialInput ? (
          <p role="status" className="text-xs text-muted-foreground">
            {t('settings.mcp.credentialReentry')}
          </p>
        ) : null}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border/40 bg-card px-5 py-4">
        <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={
            submitting ||
            draft.name.trim().length === 0 ||
            (needsCredentialReentry && !hasCredentialInput)
          }
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          {submitting ? t('settings.mcp.form.saving') : t('common.save')}
        </Button>
      </footer>
    </form>
  );
}

function ExposureSelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: McpExposure;
  onChange: (exposure: McpExposure) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select value={value} onValueChange={(next) => onChange(next as McpExposure)}>
      <SelectTrigger id={id} aria-label={t('settings.mcp.form.exposure')} className="h-9 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MCP_EXPOSURES.map((exposure) => (
          <SelectItem key={exposure} value={exposure}>
            {t(`settings.mcp.exposure.${exposure}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Paste one `mcpServers` entry to prefill the form; saving still goes through the vault. */
function McpJsonImport({
  disabled,
  onImport,
}: {
  disabled: boolean;
  onImport: (source: McpConnectionFormSource) => void;
}) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<{ error?: string; notes: string[] }>({ notes: [] });
  if (!open)
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
        {t('settings.mcp.import.action')}
      </Button>
    );
  const fill = () => {
    const result = parseMcpJsonImport(text);
    if (!result.ok) {
      setMessages({
        error: t(`settings.mcp.import.errors.${result.reason}`, {
          names: result.reason === 'multiple_servers' ? result.names?.join(', ') : undefined,
          field: result.reason === 'invalid_field' ? result.field : undefined,
        }),
        notes: [],
      });
      return;
    }
    const { server, ignoredFields, referenceFields } = result;
    onImport({ ...server, transport: server.connection.transport });
    setText('');
    setMessages({
      notes: [
        ...(ignoredFields.length
          ? [t('settings.mcp.import.ignored', { fields: ignoredFields.join(', ') })]
          : []),
        ...(referenceFields.length
          ? [t('settings.mcp.import.references', { fields: referenceFields.join(', ') })]
          : []),
      ],
    });
  };
  return (
    <Section title={t('settings.mcp.import.action')} hint={t('settings.mcp.import.hint')}>
      <Textarea
        id={`${fieldId}-json`}
        aria-label={t('settings.mcp.import.action')}
        rows={5}
        spellCheck={false}
        className="resize-y font-mono text-xs"
        placeholder={'{ "mcpServers": { "name": { "command": "…" } } }'}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {messages.error ? (
        <p role="alert" className="text-xs text-destructive">
          {messages.error}
        </p>
      ) : null}
      {messages.notes.map((note) => (
        <p key={note} role="status" className="text-xs text-muted-foreground">
          {note}
        </p>
      ))}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={disabled || text.trim().length === 0}
          onClick={fill}
        >
          {t('settings.mcp.import.fill')}
        </Button>
      </div>
    </Section>
  );
}

/** Two-state transport switch. Same segmented grammar as the other binary
 *  settings controls, so it reads as one control rather than a dropdown. */
function TransportToggle({
  value,
  onChange,
}: {
  value: McpTransport;
  onChange: (transport: McpTransport) => void;
}) {
  const { t } = useTranslation();
  return (
    <SegmentedControl
      ariaLabel={t('settings.mcp.form.transport')}
      value={value}
      onChange={onChange}
      options={MCP_TRANSPORTS.map((transport) => ({
        value: transport,
        label: MCP_TRANSPORT_SHORT_LABELS[transport],
        icon: <McpTransportIcon transport={transport} />,
      }))}
    />
  );
}

/** Shared frame for the repeatable rows (arguments, passthrough, key/value):
 *  label, the rows themselves, then one quiet add affordance. */
function ListEditor({
  label,
  hint,
  addLabel,
  onAdd,
  children,
}: {
  label: string;
  hint?: string;
  addLabel: string;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="space-y-1.5">
        {children}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
          onClick={onAdd}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {addLabel}
        </Button>
      </div>
    </Field>
  );
}

function RemoveRowButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      aria-label={t('common.remove')}
      onClick={onClick}
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
    </Button>
  );
}

function StringListEditor({
  label,
  addLabel,
  values,
  placeholder,
  hint,
  onChange,
}: {
  label: string;
  addLabel: string;
  values: string[];
  placeholder: string;
  hint?: string;
  onChange: (values: string[]) => void;
}) {
  return (
    <ListEditor
      label={label}
      hint={hint}
      addLabel={addLabel}
      onAdd={() => onChange([...values, ''])}
    >
      {values.map((value, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            value={value}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
            onChange={(event) =>
              onChange(
                values.map((item, itemIndex) => (itemIndex === index ? event.target.value : item))
              )
            }
          />
          <RemoveRowButton
            onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
          />
        </div>
      ))}
    </ListEditor>
  );
}

function KeyValueEditor({
  label,
  addLabel,
  rows,
  keyPlaceholder,
  onChange,
}: {
  label: string;
  addLabel: string;
  rows: KeyValueDraft[];
  keyPlaceholder?: string;
  onChange: (rows: KeyValueDraft[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <ListEditor
      label={label}
      addLabel={addLabel}
      onAdd={() => onChange([...rows, { key: '', value: '' }])}
    >
      {rows.map((row, index) => (
        <div
          key={index}
          className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto] items-center gap-1.5"
        >
          <Input
            aria-label={t('settings.mcp.form.key')}
            placeholder={keyPlaceholder ?? t('settings.mcp.form.key')}
            value={row.key}
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
            onChange={(event) =>
              onChange(
                rows.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, key: event.target.value } : item
                )
              )
            }
          />
          <Input
            aria-label={t('settings.mcp.form.value')}
            placeholder={t('settings.mcp.form.value')}
            value={row.value}
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
            onChange={(event) =>
              onChange(
                rows.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, value: event.target.value } : item
                )
              )
            }
          />
          <RemoveRowButton
            onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))}
          />
        </div>
      ))}
    </ListEditor>
  );
}
