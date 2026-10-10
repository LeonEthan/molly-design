import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  KNOWN_SKILL_DIRS_VERSION,
  compareProjectSkillScope,
  getRegisteredGlobalSkillDirs,
  getRegisteredSkillDirs,
  getRegisteredSystemSkillDirs,
  getServerNow,
  getSkillScanCandidateDirs,
  type AgentConfigMeta,
  type LocalProjectId,
  type MachineId,
  type ProjectSkillGroup,
  type WorkspaceId,
} from '@molly/shared';
import { getAllAgentConfigAtom, runtimeAtom, userAtom } from '@/atoms';
import { createLocalProjectSkillsTransport } from '@/lib/local-project-skills-provider';
import {
  getLocalProjectSkillsCacheKey,
  getMachineGlobalSkillsCacheKey,
  readProjectSkillsCacheEntry,
  writeProjectSkillsCacheEntry,
  type ProjectSkillsCacheEntry,
} from '@/lib/project-skills-cache';

export type ProjectSkillsSource =
  | {
      kind: 'local';
      workspaceId: string;
      machineId: string;
      localProjectId: string;
    }
  | {
      // Machine-global skills only (no project) — for chats that still run on a
      // known machine.
      kind: 'global';
      workspaceId: string;
      machineId: string;
    };

export type ProjectSkillGroupRegistration = 'registered' | 'found';

export type ProjectSkillResolvedGroup = ProjectSkillGroup & {
  registration: ProjectSkillGroupRegistration;
};

export type ProjectSkillsStatus = 'idle' | 'loading' | 'ready' | 'refreshing' | 'error';

export type ProjectSkillsState = {
  status: ProjectSkillsStatus;
  groups: ProjectSkillResolvedGroup[];
  rawGroups: ProjectSkillGroup[];
  error?: string;
  stale: boolean;
  fetchedAt?: number;
  refresh: () => void;
};

type NormalizedProjectSkillsSource =
  | {
      kind: 'local';
      workspaceId: string;
      machineId: string;
      localProjectId: string;
    }
  | {
      kind: 'global';
      workspaceId: string;
      machineId: string;
    };

type ProjectSkillsInternalState = Omit<ProjectSkillsState, 'groups' | 'refresh'>;

type RegisteredSkillDirsByScope = {
  project: Set<string>;
  global: Set<string>;
  system: Set<string>;
};

const EMPTY_INTERNAL_STATE: ProjectSkillsInternalState = {
  status: 'idle',
  rawGroups: [],
  stale: false,
};

function normalizeSource(
  source: ProjectSkillsSource | null | undefined
): NormalizedProjectSkillsSource | null {
  if (!source) {
    return null;
  }
  const workspaceId = source.workspaceId.trim();
  if (!workspaceId) {
    return null;
  }

  if (source.kind === 'local') {
    const machineId = source.machineId.trim();
    const localProjectId = source.localProjectId.trim();
    if (!machineId || !localProjectId) {
      return null;
    }
    return {
      kind: 'local',
      workspaceId,
      machineId,
      localProjectId,
    };
  }

  const machineId = source.machineId.trim();
  if (!machineId) {
    return null;
  }
  return {
    kind: 'global',
    workspaceId,
    machineId,
  };
}

function getAgentConfigsForSource(
  source: NormalizedProjectSkillsSource | null,
  agentConfigs: readonly AgentConfigMeta[]
): AgentConfigMeta[] {
  if (!source) {
    return [];
  }
  return agentConfigs.filter((config) => config.machineId === source.machineId);
}

function getRegisteredDirsForSource(
  source: NormalizedProjectSkillsSource | null,
  agentConfigs: readonly AgentConfigMeta[]
): RegisteredSkillDirsByScope {
  const configs = getAgentConfigsForSource(source, agentConfigs);
  return {
    project: source?.kind === 'local' ? getRegisteredSkillDirs(configs) : new Set(),
    global: getRegisteredGlobalSkillDirs(configs),
    system: getRegisteredSystemSkillDirs(configs),
  };
}

function annotateAndSortGroups(
  groups: readonly ProjectSkillGroup[],
  registeredDirs: RegisteredSkillDirsByScope
): ProjectSkillResolvedGroup[] {
  return groups
    .map((group) => {
      const scopeDirs =
        group.scope === 'system'
          ? registeredDirs.system
          : group.scope === 'global'
            ? registeredDirs.global
            : registeredDirs.project;
      const registration: ProjectSkillGroupRegistration = scopeDirs.has(group.dir)
        ? 'registered'
        : 'found';
      return {
        ...group,
        registration,
      };
    })
    .sort((left, right) => {
      if (left.scope !== right.scope) {
        return compareProjectSkillScope(left.scope, right.scope);
      }
      if (left.registration !== right.registration) {
        return left.registration === 'registered' ? -1 : 1;
      }
      return left.dir.localeCompare(right.dir);
    });
}

function stateFromCache(
  entry: ProjectSkillsCacheEntry,
  status: ProjectSkillsStatus
): ProjectSkillsInternalState {
  return {
    status,
    rawGroups: entry.groups,
    stale: false,
    fetchedAt: entry.fetchedAt,
  };
}

export function useProjectSkills(
  sourceInput: ProjectSkillsSource | null | undefined
): ProjectSkillsState {
  const runtime = useAtomValue(runtimeAtom);
  const requestedByUserId = useAtomValue(userAtom)?.id ?? null;
  const agentConfigs = useAtomValue(getAllAgentConfigAtom);
  const inputKind = sourceInput?.kind ?? null;
  const inputWorkspaceId = sourceInput?.workspaceId ?? '';
  const inputMachineId = sourceInput?.machineId ?? '';
  const inputLocalProjectId = sourceInput?.kind === 'local' ? sourceInput.localProjectId : '';
  const source = useMemo(() => {
    if (inputKind === 'local') {
      return normalizeSource({
        kind: 'local',
        workspaceId: inputWorkspaceId,
        machineId: inputMachineId,
        localProjectId: inputLocalProjectId,
      });
    }
    if (inputKind === 'global') {
      return normalizeSource({
        kind: 'global',
        workspaceId: inputWorkspaceId,
        machineId: inputMachineId,
      });
    }
    return null;
  }, [inputKind, inputLocalProjectId, inputMachineId, inputWorkspaceId]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [state, setState] = useState<ProjectSkillsInternalState>(EMPTY_INTERNAL_STATE);
  const scanDirs = useMemo(() => getSkillScanCandidateDirs(), []);
  const registeredDirs = useMemo(
    () => getRegisteredDirsForSource(source, agentConfigs),
    [agentConfigs, source]
  );
  const groups = useMemo(
    () => annotateAndSortGroups(state.rawGroups, registeredDirs),
    [registeredDirs, state.rawGroups]
  );
  const refresh = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  const sourceCacheKey = useMemo(() => {
    if (!source || !requestedByUserId) {
      return null;
    }
    if (source.kind === 'local') {
      return getLocalProjectSkillsCacheKey(
        requestedByUserId,
        source.workspaceId,
        source.machineId,
        source.localProjectId
      );
    }
    return getMachineGlobalSkillsCacheKey(requestedByUserId, source.workspaceId, source.machineId);
  }, [requestedByUserId, source]);

  useEffect(() => {
    if (!source || !sourceCacheKey) {
      setState(EMPTY_INTERNAL_STATE);
      return undefined;
    }

    let cancelled = false;

    const load = async (): Promise<void> => {
      const cached = await readProjectSkillsCacheEntry(sourceCacheKey);
      if (cancelled) {
        return;
      }

      if (cached) {
        setState(stateFromCache(cached, 'refreshing'));
      } else {
        setState({ status: 'loading', rawGroups: [], stale: false });
      }

      // SWR cache hit: the source is unchanged, so keep the cached groups and
      // only bump fetchedAt. Shared by the project and global content-fingerprint
      // checks below.
      const reuseCachedEntry = async (entry: ProjectSkillsCacheEntry): Promise<void> => {
        const refreshed: ProjectSkillsCacheEntry = { ...entry, fetchedAt: getServerNow() };
        await writeProjectSkillsCacheEntry(refreshed);
        if (!cancelled) {
          setState(stateFromCache(refreshed, 'ready'));
        }
      };

      try {
        if (source.kind === 'local') {
          if (!runtime || !requestedByUserId) {
            throw new Error('Local project control is unavailable.');
          }
          const transport = createLocalProjectSkillsTransport({
            workspaceId: source.workspaceId as WorkspaceId,
            machineId: source.machineId as MachineId,
            localProjectId: source.localProjectId as LocalProjectId,
            requestedByUserId,
            requestLocalProjectControl: (request, requestOptions) =>
              runtime.requestLocalProjectControl(request, requestOptions),
          });
          const [projectResult, globalResult] = await Promise.all([
            transport.listSkills({ skillDirs: scanDirs }),
            transport.listGlobalSkills(),
          ]);
          if (cancelled) {
            return;
          }

          const contentFingerprint = [
            `project:${projectResult.contentFingerprint ?? ''}`,
            `global:${globalResult.contentFingerprint ?? ''}`,
          ].join('|');
          const combinedGroups = [...projectResult.groups, ...globalResult.groups];

          if (cached && cached.contentFingerprint === contentFingerprint) {
            await reuseCachedEntry(cached);
            return;
          }

          const nextEntry: ProjectSkillsCacheEntry = {
            key: sourceCacheKey,
            groups: combinedGroups,
            source: 'local',
            contentFingerprint,
            knownDirsVersion: KNOWN_SKILL_DIRS_VERSION,
            fetchedAt: getServerNow(),
          };
          await writeProjectSkillsCacheEntry(nextEntry);
          if (!cancelled) {
            setState(stateFromCache(nextEntry, 'ready'));
          }
          return;
        }

        if (!runtime || !requestedByUserId) {
          throw new Error('Local project control is unavailable.');
        }
        const transport = createLocalProjectSkillsTransport({
          workspaceId: source.workspaceId as WorkspaceId,
          machineId: source.machineId as MachineId,
          requestedByUserId,
          requestLocalProjectControl: (request, requestOptions) =>
            runtime.requestLocalProjectControl(request, requestOptions),
        });
        const globalResult = await transport.listGlobalSkills();
        if (cancelled) {
          return;
        }

        const contentFingerprint = `global:${globalResult.contentFingerprint ?? ''}`;
        if (cached && cached.contentFingerprint === contentFingerprint) {
          await reuseCachedEntry(cached);
          return;
        }

        const nextEntry: ProjectSkillsCacheEntry = {
          key: sourceCacheKey,
          groups: globalResult.groups,
          source: 'global',
          contentFingerprint,
          knownDirsVersion: KNOWN_SKILL_DIRS_VERSION,
          fetchedAt: getServerNow(),
        };
        await writeProjectSkillsCacheEntry(nextEntry);
        if (!cancelled) {
          setState(stateFromCache(nextEntry, 'ready'));
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setState((previous) => ({
          ...previous,
          status: 'error',
          error: message,
          stale: previous.rawGroups.length > 0,
        }));
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [requestedByUserId, refreshNonce, runtime, scanDirs, source, sourceCacheKey]);

  return {
    ...state,
    groups,
    refresh,
  };
}
