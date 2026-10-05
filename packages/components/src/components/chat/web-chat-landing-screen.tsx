import type { ReactNode, Ref } from 'react';
import type { DropZone } from '@/hooks/use-drop-zone';
import { cn } from '@/lib/utils';
import { isElectronRenderer, isMacOSElectronRenderer, useElectronFullscreen } from '@/lib/electron';
import { ConversationColumn } from '@/components/shared/conversation-column';
import {
  ConversationDropOverlay,
  type ConversationDropKind,
} from '@/components/shared/conversation-drop-overlay';
import { focusFirstChatLandingOption } from '@/hooks/use-chat-landing-keyboard-nav';
import { FocusScope } from '@/ui/focus-scope';
import { WINDOW_DRAG_EXEMPT_CLASS, WindowDragStrip } from '@/ui/window-drag-region';

import { WORKSPACE_FOCUS_SCOPES } from '@/atoms';

export type WebChatLandingScreenProps = {
  title: ReactNode;
  /** Short brand line above the heading. */
  eyebrow?: string;
  /** The promise under the heading. */
  subtitle?: string;
  /** Prompt starters shown under the composer. */
  ideas?: ReactNode;
  /** Recent work below the hero. */
  gallery?: ReactNode;
  contextSwitch?: ReactNode;
  composer: ReactNode;
  noMachineHint?: ReactNode;
  agentConfigHint?: ReactNode;
  leftSidebarExpandSlot?: ReactNode;
  /** Page-level drop target (a sidebar session dragged onto the new chat). */
  dropActive?: boolean;
  dropKind?: ConversationDropKind;
  dropHandlers?: DropZone['handlers'];
  /** Scope root for keyboard navigation — wraps the title, context switch and composer
   *  so arrow/Esc nav covers the config controls but not the surrounding page chrome. */
  navRootRef?: Ref<HTMLDivElement>;
};

export function WebChatLandingScreen({
  title,
  eyebrow,
  subtitle,
  ideas,
  gallery,
  contextSwitch,
  composer,
  noMachineHint,
  agentConfigHint,
  leftSidebarExpandSlot,
  navRootRef,
  dropActive = false,
  dropKind = 'session-mention',
  dropHandlers,
}: WebChatLandingScreenProps) {
  const isElectron = isElectronRenderer();
  const isElectronFullscreen = useElectronFullscreen();

  return (
    <div
      className={cn(
        'relative flex h-full w-full flex-1 flex-col overflow-hidden',
        'bg-background text-foreground',
        isElectron &&
          'select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text'
      )}
      {...dropHandlers}
    >
      <WindowDragStrip />
      <ConversationDropOverlay active={dropActive} kind={dropKind} />
      {leftSidebarExpandSlot != null ? (
        <div
          className={cn(
            'absolute top-3 z-20',
            WINDOW_DRAG_EXEMPT_CLASS,
            // macOS Electron: `top-[9px]` centers the h-7 button at 23px, on the
            // traffic-light centerline (`trafficLightPosition.y` 16 + 7px radius
            // in apps/electron/src/main/window.ts); `left-[96px]` leaves a 24px
            // buffer after the light cluster (which ends at x=72).
            isMacOSElectronRenderer() && !isElectronFullscreen ? 'top-[9px] left-[96px]' : 'left-3'
          )}
        >
          {leftSidebarExpandSlot}
        </div>
      ) : null}
      {/* Greeting + composer share one keyboard-nav scope (navRootRef); the
          absolutely-positioned sidebar-expand chrome above stays outside it. */}
      <FocusScope
        id={WORKSPACE_FOCUS_SCOPES.chatLanding}
        ref={navRootRef}
        className="relative flex min-h-0 flex-1 flex-col"
        onFocus={(event) => {
          if (event.target === event.currentTarget) {
            focusFirstChatLandingOption(event.currentTarget);
          }
        }}
      >
        <div className="input-scrollbar relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto overflow-x-hidden px-[clamp(24px,5vw,64px)]">
          <div className="relative flex min-h-[74%] w-full max-w-[820px] shrink-0 flex-col items-center justify-center gap-9 pb-8 pt-20">
            <div className="flex flex-col items-center gap-6 text-center">
              {eyebrow ? (
                <span className="eyebrow animate-reveal inline-flex items-center gap-2.5 text-muted-foreground">
                  <span
                    aria-hidden
                    className="animate-signal size-[6px] rounded-full bg-[var(--signal)]"
                  />
                  {eyebrow}
                </span>
              ) : null}
              <h1
                className="font-editorial animate-reveal text-balance text-[clamp(52px,6.6vw,104px)] leading-[0.94] text-foreground [&_em]:italic"
                style={{ animationDelay: '80ms' }}
              >
                {title}
              </h1>
              {subtitle ? (
                <p
                  className="animate-reveal max-w-[480px] text-balance text-[15px] leading-relaxed text-muted-foreground"
                  style={{ animationDelay: '160ms' }}
                >
                  {subtitle}
                </p>
              ) : null}
            </div>
            <ConversationColumn
              className="@container animate-reveal w-full"
              style={{ animationDelay: '240ms' }}
            >
              {noMachineHint != null ? <div className="pb-2">{noMachineHint}</div> : null}
              {agentConfigHint != null ? <div className="pb-2">{agentConfigHint}</div> : null}
              {composer}
            </ConversationColumn>
            {ideas != null || contextSwitch != null ? (
              <div
                className="animate-reveal flex w-full flex-col items-center gap-7"
                style={{ animationDelay: '320ms' }}
              >
                {ideas}
                {contextSwitch}
              </div>
            ) : null}
          </div>
          {gallery != null ? (
            <div className="relative w-full max-w-[1240px] shrink-0 pb-24 pt-10">{gallery}</div>
          ) : null}
        </div>
      </FocusScope>
    </div>
  );
}
