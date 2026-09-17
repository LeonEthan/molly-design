import { atomWithProductStorage } from '@/lib/atom-with-product-storage';
import { mollyStorage } from '@/lib/product-storage';
import { atom } from 'jotai';

import { currentWorkspaceIdAtom } from './workspace-context';

/**
 * Sidebar state atoms with localStorage persistence
 *
 * Repo ordering and collapse choices survive renderer refreshes.
 *
 * These atoms manage:
 * - Repo collapse states
 * - Repo ordering
 * - Pinned section collapsed state
 * - Chats section collapsed state
 */

// ============================================================================
// Repo State (Collapse + Ordering)
// ============================================================================

export type RepoCollapseState = Record<string, boolean>;

/**
 * Repo collapse states - persisted to localStorage
 * Key: repoFullName, Value: collapsed (true/false)
 */
export const repoCollapseStateAtom = atomWithProductStorage<RepoCollapseState>(
  'molly-sidebar-repo-collapse',
  {}
);

/**
 * Per-workspace repo ordering, persisted to localStorage as
 * `{ [workspaceId]: string[] }`. Use `repoOrderAtom` for the current workspace.
 */
const repoOrderByWorkspaceAtom = atomWithProductStorage<Record<string, string[]>>(
  'molly-sidebar-repo-order-by-workspace',
  {}
);

/**
 * BC-2026-04-17-SIDEBAR-REPO-ORDER-LEGACY-FALLBACK
 *
 * Pre-workspace-scoping, repo order was stored globally under
 * `molly-sidebar-repo-order`. If a workspace has no entry in the new
 * per-workspace map yet, we read the legacy value once as a default so users
 * don't lose their saved order on first load after the upgrade. The legacy
 * value is never written — first real write (drag or new repo discovery)
 * persists under the new per-workspace key.
 */
const LEGACY_REPO_ORDER_KEY = 'molly-sidebar-repo-order';
function readLegacyRepoOrder(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = mollyStorage.getItem(LEGACY_REPO_ORDER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    return [];
  }
}

const EMPTY_REPO_ORDER: readonly string[] = Object.freeze([]);

/**
 * Repo order scoped to the current workspace. Reading outside a workspace
 * returns an empty array; writing outside a workspace is a no-op.
 */
export const repoOrderAtom = atom<readonly string[], [readonly string[]], void>(
  (get) => {
    const workspaceId = get(currentWorkspaceIdAtom);
    if (!workspaceId) return EMPTY_REPO_ORDER;
    const map = get(repoOrderByWorkspaceAtom);
    const saved = map[workspaceId];
    if (saved !== undefined) return saved;
    return readLegacyRepoOrder();
  },
  (get, set, value) => {
    const workspaceId = get(currentWorkspaceIdAtom);
    if (!workspaceId) return;
    const map = get(repoOrderByWorkspaceAtom);
    set(repoOrderByWorkspaceAtom, {
      ...map,
      [workspaceId]: [...value],
    });
  }
);

/**
 * Update repo collapse state for a specific repo
 */
export const toggleRepoCollapsedAtom = atom(null, (get, set, repoFullName: string) => {
  const current = get(repoCollapseStateAtom);
  set(repoCollapseStateAtom, {
    ...current,
    [repoFullName]: !current[repoFullName],
  });
});

/**
 * Set repo order for the current workspace.
 */
export const setRepoOrderAtom = atom(null, (_get, set, order: string[]) => {
  set(repoOrderAtom, order);
});

// ============================================================================
// Chats Section Collapsed
// ============================================================================

/**
 * Chats section collapsed state - persisted to localStorage
 */
export const chatsCollapsedAtom = atomWithProductStorage<boolean>('molly-sidebar-chats-collapsed', false);

/**
 * Toggle chats section collapsed state
 */
export const toggleChatsCollapsedAtom = atom(null, (get, set) => {
  set(chatsCollapsedAtom, !get(chatsCollapsedAtom));
});

/**
 * Pinned section collapsed state - persisted to localStorage
 */
export const pinnedSectionCollapsedAtom = atomWithProductStorage<boolean>(
  'molly-sidebar-pinned-section-collapsed',
  false
);

// ============================================================================
// Local Project Collapse State (folders under Local Projects / <Machine> project)
// ============================================================================

export type LocalProjectCollapseState = Record<string, boolean>;

/**
 * Local project collapse states - persisted to localStorage
 * Key: `${machineId}:${localProjectId}`, Value: collapsed (true/false)
 */
export const localProjectCollapseStateAtom = atomWithProductStorage<LocalProjectCollapseState>(
  'molly-sidebar-local-project-collapse',
  {}
);

// ============================================================================
// Section Collapsed (Local Projects + GitHub Worktrees headers)
// ============================================================================

/**
 * Local Projects section header collapsed state (per machine section) - persisted.
 * Key: section.machineId ?? section.kind, Value: collapsed (true/false)
 */
export const localProjectsSectionCollapseStateAtom = atomWithProductStorage<Record<string, boolean>>(
  'molly-sidebar-local-projects-section-collapse',
  {}
);

/**
 * Whether the "GitHub Worktrees" section header is collapsed - persisted.
 */
export const githubWorktreesSectionCollapsedAtom = atomWithProductStorage<boolean>(
  'molly-sidebar-github-worktrees-section-collapsed',
  false
);

// ============================================================================
// Sidebar Collapsed (Desktop)
// ============================================================================

/**
 * Whether the desktop left sidebar is collapsed (fully hidden). Persisted.
 * Mobile uses `mobileDrawerOpenAtom` and ignores this.
 */
export const sidebarCollapsedAtom = atomWithProductStorage<boolean>('molly-sidebar-collapsed', false);

/**
 * Last expanded width in px. Restored when the user re-opens the sidebar so
 * width preference survives collapse/expand cycles. 0 means "use default".
 */
export const sidebarLastWidthAtom = atomWithProductStorage<number>('molly-sidebar-last-width', 0);

// ============================================================================
// Sidebar Organize Mode (Workspace vs Updated)
// ============================================================================

export type SidebarOrganizeMode = 'workspace' | 'updated';

/**
 * How the sidebar groups items.
 * - 'workspace' = group by Chats / Local Projects / GitHub Worktrees (default)
 * - 'updated'   = single flat list sorted by latest-update recency
 */
export const sidebarOrganizeModeAtom = atomWithProductStorage<SidebarOrganizeMode>(
  'molly-sidebar-organize-mode',
  'workspace'
);

/**
 * Per-bucket collapse state for the Updated organize mode.
 * Keyed by the single 'all' bucket; value is whether collapsed. (Persisted
 * entries from the retired today/week/older buckets are simply ignored.)
 */
export const sidebarUpdatedBucketCollapseStateAtom = atomWithProductStorage<Record<string, boolean>>(
  'molly-sidebar-updated-bucket-collapse',
  {}
);

/**
 * Per-bucket "show all" state for the Updated organize mode. Buckets above the
 * preview threshold default to a compact preview; this map records which
 * buckets the user has explicitly expanded. Mirrors the pattern that
 * `sidebarShowFullListAtom` uses for Workspace task groups, but keyed by the
 * single 'all' bucket.
 */
export const sidebarUpdatedBucketShowFullStateAtom = atomWithProductStorage<Record<string, boolean>>(
  'molly-sidebar-updated-bucket-show-full',
  {}
);
