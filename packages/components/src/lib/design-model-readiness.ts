import {
  getModelConnectionConfigurationIssue,
  ModelConnectionSchema,
  type ModelConnection,
  type ProtectedImageConnection,
} from '@molly/shared/embedded-harness';
import { getIpcServices } from '@/lib/electron-ipc-client';

/**
 * Design-session model readiness, shared by Settings (design-readiness.tsx),
 * onboarding, and the landing composer so the three surfaces can never drift.
 * Readiness describes saved configuration only: it never probes a key.
 */
export function isModelConnectionReady(connection: ModelConnection): boolean {
  return connection.enabled && !getModelConnectionConfigurationIssue(connection);
}

export function getReadyModelConnections(
  connections: readonly ModelConnection[]
): ModelConnection[] {
  return connections.filter(isModelConnectionReady);
}

export function isImageConnectionReady(
  connection: ProtectedImageConnection | null | undefined
): boolean {
  return connection != null && connection.enabled && connection.hasApiKey;
}

export type DesignModelClass = 'language' | 'image';

/**
 * Missing model classes for starting a design session. `undefined` means the
 * saved state has not been read yet and is treated as missing: callers must
 * not report ready from an unread snapshot.
 */
export function getMissingDesignModelClasses(input: {
  connections: readonly ModelConnection[] | undefined;
  imageConnection: ProtectedImageConnection | null | undefined;
}): DesignModelClass[] {
  const missing: DesignModelClass[] = [];
  if (!input.connections || getReadyModelConnections(input.connections).length === 0) {
    missing.push('language');
  }
  if (!isImageConnectionReady(input.imageConnection)) {
    missing.push('image');
  }
  return missing;
}

/**
 * Live snapshot read for the landing send gate. `null` means the saved state
 * could not be read (for example Keychain access was denied); callers block
 * the send rather than treat an unread snapshot as ready.
 */
export async function readMissingDesignModelClasses(): Promise<DesignModelClass[] | null> {
  const ipc = getIpcServices();
  if (!ipc) return [];
  try {
    const [models, image] = await Promise.all([
      ipc.modelConnections.getSnapshot(),
      ipc.modelConnections.getImageSnapshot(),
    ]);
    return getMissingDesignModelClasses({
      connections: ModelConnectionSchema.array().parse(models.connections),
      imageConnection: image.connection ?? null,
    });
  } catch (error) {
    console.error('Failed to read design model readiness', error);
    return null;
  }
}
