import { useState } from 'react';
import { Paperclip, Plug, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  describeMcpConnection,
  type McpServerId,
  type WorkspaceMcpServerMeta,
} from '@molly/shared';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { MCP_TRANSPORT_LABELS } from '@/components/shared/mcp-transport';

/** Per-turn MCP selection, surfaced as a second level of the "+" menu. */
export interface AttachmentAddMenuMcp {
  servers: readonly WorkspaceMcpServerMeta[];
  selectedIds: readonly McpServerId[];
  onSelectedIdsChange: (ids: McpServerId[]) => void;
  /** Existing conversation: the change applies the next time the agent starts. */
  existingSession?: boolean;
  disabled?: boolean;
}

export interface AttachmentAddMenuProps {
  /** Disables the whole trigger (e.g. the prompt is disabled). */
  disabled?: boolean;
  /** Omit the callback to hide the attachment item entirely. The picker is
   * intentionally unfiltered; its owner routes the selected files by MIME. */
  onAddAttachment?: () => void;
  attachmentDisabled?: boolean;
  /** Omit (or pass an empty catalog) to hide the MCP entry entirely. */
  mcp?: AttachmentAddMenuMcp;
}

export function AttachmentAddMenu({
  disabled,
  onAddAttachment,
  attachmentDisabled,
  mcp,
}: AttachmentAddMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerLabel = t('sessions.addAttachmentMenu', 'Add attachment');

  const mcpServers = mcp?.servers ?? [];
  const hasMcp = mcpServers.length > 0;
  if (!onAddAttachment && !hasMcp) {
    return null;
  }

  const itemClass = cn('cursor-pointer');
  const iconClass = 'size-4 shrink-0 text-muted-foreground';
  const selectedCount = mcp
    ? mcp.selectedIds.filter((id) => mcpServers.some((server) => server.id === id)).length
    : 0;
  const mcpLabel =
    selectedCount > 0
      ? t('session.mcp.loadCount', { count: selectedCount })
      : t('session.mcp.loadNone');

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={triggerLabel}
          className={cn(
            'size-7',
            // Light-stroke "+" with a circular hover/open fill. `bg-hover` (not
            // `bg-accent`/`bg-muted`) because those equal the background in the
            // dark theme and paint nothing.
            'rounded-full text-foreground transition-colors',
            'hover:bg-hover hover:text-foreground',
            'data-[state=open]:bg-hover data-[state=open]:text-foreground'
          )}
        >
          <Plus strokeWidth={1.5} className={'size-5'} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-max min-w-[140px]">
        <div key="root" className="animate-in fade-in-0 slide-in-from-left-2 duration-150">
          {onAddAttachment ? (
            <DropdownMenuItem
              onSelect={onAddAttachment}
              disabled={attachmentDisabled}
              className={itemClass}
            >
              <Paperclip className={iconClass} />
              {triggerLabel}
            </DropdownMenuItem>
          ) : null}
          {hasMcp && mcp ? (
            <>
              {onAddAttachment ? <DropdownMenuSeparator /> : null}
              {
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className={itemClass} disabled={mcp.disabled}>
                    <Plug className={iconClass} />
                    <span className="min-w-0 flex-1 truncate">{mcpLabel}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-[min(20rem,calc(100vw-2rem))]">
                    <McpServerItems mcp={mcp} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              }
            </>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function McpServerItems({ mcp }: { mcp: AttachmentAddMenuMcp }) {
  const { t } = useTranslation();
  const selected = new Set(mcp.selectedIds);
  const toggle = (id: McpServerId, checked: boolean) => {
    mcp.onSelectedIdsChange(
      checked
        ? [...mcp.selectedIds.filter((selectedId) => selectedId !== id), id]
        : mcp.selectedIds.filter((selectedId) => selectedId !== id)
    );
  };

  return (
    <>
      {mcp.servers.map((server) => {
        const detail =
          server.description ??
          describeMcpConnection(server.connection) ??
          MCP_TRANSPORT_LABELS[server.transport];
        return (
          <DropdownMenuCheckboxItem
            key={server.id}
            checked={selected.has(server.id)}
            disabled={mcp.disabled}
            // Stays `items-center` (the shared selection-item default): the check
            // indicator is absolutely positioned from its static spot, so the row's
            // own alignment is what centers it against the two-line label.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => toggle(server.id, checked === true)}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{server.name}</span>
              <span
                className={cn(
                  'truncate text-xs leading-snug text-muted-foreground',
                  server.description ? undefined : 'font-mono'
                )}
              >
                {detail}
              </span>
            </span>
          </DropdownMenuCheckboxItem>
        );
      })}
      {mcp.existingSession ? (
        <p className="select-none px-2.5 pb-1.5 pt-2 text-[11px] leading-snug text-muted-foreground">
          {t('session.mcp.nextStartHint')}
        </p>
      ) : null}
    </>
  );
}
