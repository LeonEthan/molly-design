/** Persistent shape geometry command builders (GD-4 #24). */
import type { SetShapeGeometryCommand, StaticV1ShapeName, VisualCommandV4 } from "contracts";

/**
 * shape.preset/adjustments/customPath → complete setShapeGeometry command.
 * Optional fields are intentionally omitted, allowing the kernel to clear
 * stale preset/custom geometry instead of silently retaining it.
 */
export function shapeGeometryCommands(
  id: string,
  geometry: {
    shapeName: StaticV1ShapeName;
    adjustments?: number[];
    viewBox?: [number, number];
    path?: string;
  },
): VisualCommandV4[] {
  const command: SetShapeGeometryCommand = {
    type: "setShapeGeometry",
    targetId: id,
    shapeName: geometry.shapeName,
    ...(geometry.adjustments !== undefined ? { adjustments: [...geometry.adjustments] } : {}),
    ...(geometry.viewBox !== undefined ? { viewBox: [...geometry.viewBox] as [number, number] } : {}),
    ...(geometry.path !== undefined ? { path: geometry.path } : {}),
  };
  return [command];
}
