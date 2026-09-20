/**
 * Workspace-relative harness filesystem contracts. Dependency-free on purpose:
 * this module is re-exported from embedded-harness, which raw-Node consumers
 * (Electron main tests with --experimental-strip-types) load without a bundler,
 * so it must not pull in the broader shared import graph.
 */

/**
 * Workspace-relative session attachment root. The daemon materializes uploaded
 * files under this directory before dispatch; the harness adapter validates
 * containment and rewrites resource_link blocks to absolute paths under the
 * same root. Both sides must reference this single constant (issue #49: a
 * stale hardcoded copy left over from a rename broke every image prompt).
 */
export const SESSION_ATTACHMENTS_DIR_RELATIVE = '.molly/attachments' as const;
