import { FROZEN_CAPABILITY_MATRIX } from './capability-matrix.ts';

/** The YAML projection changes representation, never editor capabilities.
 * Each frozen row keeps its original admission/render evidence.
 */
export const AUTHORING_PROJECTION_CAPABILITIES = FROZEN_CAPABILITY_MATRIX.rows
  .filter((row) => row.profileState === 'active')
  .map((row) => ({
    capabilityId: row.capabilityId,
    canonicalPath: row.canonicalPath,
    projectionVersion: 'molly-canvas/1' as const,
    representation: [
      'common.theme',
      'common.styleInheritance',
      'chart.seriesDefaults',
      'table.cellTextStyleRef',
      'table.styleRef',
    ].includes(row.capabilityId)
      ? 'Only resolved literal Bento fields are represented; authoring references/defaults are excluded'
      : 'v4 fields preserved; size maps canvas dimensions, id/kind stay native, asset src uses media paths',
  }));
