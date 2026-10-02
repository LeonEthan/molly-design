import { atom } from 'jotai';
import { sidebarCollapsedAtom } from './sidebar-state';

/**
 * Zen is a transient visibility override for the current app window. The
 * persisted sidebar preferences remain untouched so leaving Zen restores the
 * exact layout each surface already owns.
 */
export const zenLayoutModeAtom = atom(false);

/**
 * True while the active design canvas is focused. Like Zen it hides the
 * navigation sidebar without writing the persisted collapse preference.
 */
export const designCanvasFocusAtom = atom(false);

export const navigationSidebarHiddenAtom = atom(
  (get) => get(zenLayoutModeAtom) || get(designCanvasFocusAtom) || get(sidebarCollapsedAtom)
);

export type ZenAwarePanelState = {
  zenMode: boolean;
  panelOpen: boolean;
};

/** A panel toggle made during Zen means "leave Zen and reveal this panel". */
export function getZenAwarePanelToggleState({
  zenMode,
  panelOpen,
}: ZenAwarePanelState): ZenAwarePanelState {
  return {
    zenMode: false,
    panelOpen: zenMode ? true : !panelOpen,
  };
}

export const toggleZenLayoutModeAtom = atom(null, (get, set) => {
  set(zenLayoutModeAtom, !get(zenLayoutModeAtom));
});

export const showNavigationSidebarAtom = atom(null, (_get, set) => {
  set(zenLayoutModeAtom, false);
  set(designCanvasFocusAtom, false);
  set(sidebarCollapsedAtom, false);
});

export const toggleNavigationSidebarAtom = atom(null, (get, set) => {
  const next = getZenAwarePanelToggleState({
    zenMode: get(zenLayoutModeAtom) || get(designCanvasFocusAtom),
    panelOpen: !get(sidebarCollapsedAtom),
  });
  set(zenLayoutModeAtom, next.zenMode);
  set(designCanvasFocusAtom, false);
  set(sidebarCollapsedAtom, !next.panelOpen);
});
