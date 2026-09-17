import { useEffect, useRef, type ReactNode } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MOBILE_LAYOUT_BREAKPOINT } from '@molly/shared/layout';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLocation } from '@tanstack/react-router';
import { LoroAppSidebar } from './loro-app-sidebar';
import { ErrorBoundary } from './error-boundary';
import { useKeyboardNavigation } from '../hooks/use-keyboard-navigation';
import {
  navigationSidebarHiddenAtom,
  sidebarCollapsedAtom,
  sidebarLastWidthAtom,
  WORKSPACE_FOCUS_SCOPES,
} from '../atoms';
import { getWebWorkspaceLayoutRootClassName, isSettingsRoute } from './workspace-layout-utils';
import { FocusScope } from '@/ui/focus-scope';
import { WindowDragStrip } from '@/ui/window-drag-region';

// LoroSidebar's default expanded width (see loro-sidebar.tsx `defaultWidth`);
// `sidebarLastWidthAtom` stores 0 until the user resizes, so fall back to this.
const DEFAULT_SIDEBAR_WIDTH = 280;
// Extra px the sidebar card is inset by (`ml-2` + `mr-1` in loro-app-sidebar),
// added to the slide distance so it clears fully off the left edge.
const SIDEBAR_GUTTER = 12;

export function WebWorkspaceLayout({ children }: { children: ReactNode }) {
  // Only the pathname drives this layout (settings branch + error boundary
  // resets), so search-only navigations (dialogs, panels) don't re-render the
  // whole workspace shell.
  const pathname = useLocation({ select: (l) => l.pathname });
  const sidebarHidden = useAtomValue(navigationSidebarHiddenAtom);
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtom);
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  sidebarCollapsedRef.current = sidebarCollapsed;
  const wideSidebarStateRef = useRef<boolean | null>(null);
  const sidebarLastWidth = useAtomValue(sidebarLastWidthAtom);
  const shouldReduceMotion = useReducedMotion();

  useKeyboardNavigation();

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${MOBILE_LAYOUT_BREAKPOINT - 1}px)`);
    const update = () => {
      if (media.matches) {
        if (wideSidebarStateRef.current === null) {
          wideSidebarStateRef.current = sidebarCollapsedRef.current;
        }
        setSidebarCollapsed(true);
      } else if (wideSidebarStateRef.current !== null) {
        setSidebarCollapsed(wideSidebarStateRef.current);
        wideSidebarStateRef.current = null;
      }
    };
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, [setSidebarCollapsed]);

  if (isSettingsRoute(pathname)) {
    return (
      <div className={getWebWorkspaceLayoutRootClassName({ settingsRoute: true })}>
        <WindowDragStrip />
        <div className="min-h-0 flex-1 overflow-hidden">
          <ErrorBoundary name="AppContent" variant="section" resetKeys={[pathname]}>
            {children}
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  // Slide the sidebar in/out horizontally on collapse/expand. Animating
  // `marginLeft` (not width/transform) both slides the card off the left edge —
  // clipped by this row's `overflow-hidden` — and reclaims the flex space so the
  // content pane grows to fill. AnimatePresence keeps the sidebar mounted for the
  // exit slide, then unmounts it. marginLeft stays 0 while expanded, so live
  // resize never fights the animation.
  const sidebarSlideWidth =
    (sidebarLastWidth > 0 ? sidebarLastWidth : DEFAULT_SIDEBAR_WIDTH) + SIDEBAR_GUTTER;

  return (
    <div className={`${getWebWorkspaceLayoutRootClassName()} relative`}>
      {!sidebarHidden ? (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-20 hidden bg-black/20 max-[767px]:block"
          onClick={() => setSidebarCollapsed(true)}
        />
      ) : null}
      <AnimatePresence initial={false}>
        {!sidebarHidden && (
          <motion.div
            key="app-sidebar"
            className="h-full shrink-0 max-[767px]:absolute max-[767px]:inset-y-0 max-[767px]:left-0 max-[767px]:z-30"
            initial={{ marginLeft: -sidebarSlideWidth }}
            animate={{ marginLeft: 0 }}
            exit={{ marginLeft: -sidebarSlideWidth }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.22, ease: [0.32, 0.72, 0, 1] }}
          >
            <ErrorBoundary name="AppSidebar" variant="section" resetKeys={[pathname]}>
              <LoroAppSidebar className="h-full transition-shadow duration-150" />
            </ErrorBoundary>
          </motion.div>
        )}
      </AnimatePresence>
      <FocusScope
        id={WORKSPACE_FOCUS_SCOPES.content}
        className="relative flex min-w-0 flex-1 overflow-hidden"
      >
        <WindowDragStrip />
        <ErrorBoundary name="AppContent" variant="section" resetKeys={[pathname]}>
          <div className="flex h-full min-w-0 w-full flex-1 flex-col overflow-hidden">
            {children}
          </div>
        </ErrorBoundary>
      </FocusScope>
    </div>
  );
}
