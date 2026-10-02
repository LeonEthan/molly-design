/** The conversation opens at a reading width beside a canvas-first workbench (Spec: "a larger canvas"). */
const DESIGN_CHAT_TARGET_WIDTH_PX = 460;
const DESIGN_CHAT_MIN_PERCENT = 22;
const DESIGN_CHAT_MAX_PERCENT = 40;

/** Saved splits from the earlier 40/60 default are left behind so the canvas-first default applies once. */
export const DESIGN_PANEL_LAYOUT_ID = 'session-design-panels-v2';

export function getDesignPanelDefaultSizes(windowWidthPx: number): {
  main: number;
  sidebar: number;
} {
  const target =
    windowWidthPx > 0 ? (DESIGN_CHAT_TARGET_WIDTH_PX / windowWidthPx) * 100 : DESIGN_CHAT_MAX_PERCENT;
  const main = Math.round(
    Math.min(DESIGN_CHAT_MAX_PERCENT, Math.max(DESIGN_CHAT_MIN_PERCENT, target))
  );
  return { main, sidebar: 100 - main };
}
