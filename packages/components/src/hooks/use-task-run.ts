import { useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { useRouter } from '@tanstack/react-router';
import {
  buildPendingUserHistoryEntry,
  buildSessionTurnInputConfig,
  getMissingTaskExecutionFields,
  getServerNow,
  type AgentConfigMeta,
  type ProjectRef,
  type SessionId,
  type TaskAgentRef,
  type TaskId,
} from '@molly/shared';
import { currentWorkspaceSlugAtom, userAtom } from '@/atoms';
import { getAllAgentConfigAtom } from '@/atoms/agents';
import { buildAgentPrompt } from '@/lib';
import { useSessionActions } from '@/hooks/use-session-actions';
import { useTaskActions } from '@/hooks/use-task-actions';

export type TaskRunRequest = {
  taskId: TaskId;
  title: string;
  body: string;
  agent: TaskAgentRef;
  projects: ProjectRef[];
};

export type TaskRunOutcome =
  | { ok: true; sessionId: SessionId }
  | { ok: false; reason: 'missing_fields' | 'agent_not_found' | 'not_ready' };

/**
 * Builds the brief the agent receives when a task is started.
 *
 * The rendered user message stays a one-liner while the prompt carries the full
 * body, so a session does not open with a wall of markdown but the agent still
 * gets the whole spec.
 */
export const buildTaskBrief = (title: string, body: string): string => {
  const trimmedBody = body.trim();
  const header = `You are executing a Molly task.\n\nTask: ${title}`;
  if (!trimmedBody) {
    return `${header}\n\n(The task has no description yet — ask for details if the title is not enough.)`;
  }
  return `${header}\n\n---\n\n${trimmedBody}`;
};

/**
 * Starts a task: creates a session, injects the brief, links it back with
 * `run` provenance, and moves the task to in progress.
 *
 * Status advances when the dispatch is accepted locally, not when the button is
 * clicked, and a later turn failure does not roll it back: "started and then
 * failed" is a true description of in-progress work.
 */
export function useTaskRun() {
  const router = useRouter();
  const user = useAtomValue(userAtom);
  const workspaceSlug = useAtomValue(currentWorkspaceSlugAtom);
  const agentConfigs = useAtomValue(getAllAgentConfigAtom);
  const { startSession, requestSessionDispatch } = useSessionActions();
  const { linkSession, updateTaskFields } = useTaskActions();

  return useCallback(
    async (request: TaskRunRequest): Promise<TaskRunOutcome> => {
      const userId = user?.id;
      if (!userId) {
        return { ok: false, reason: 'not_ready' };
      }
      if (
        getMissingTaskExecutionFields({ agent: request.agent, projects: request.projects }).length >
        0
      ) {
        return { ok: false, reason: 'missing_fields' };
      }

      const config = (agentConfigs as AgentConfigMeta[]).find(
        (candidate) => candidate.id === request.agent.agentConfigId
      );
      if (!config) {
        return { ok: false, reason: 'agent_not_found' };
      }

      const project = request.projects[0];
      const brief = buildTaskBrief(request.title, request.body);
      const inputBlocks = [{ type: 'text' as const, text: `▶ ${request.title}` }];
      const inputConfig = buildSessionTurnInputConfig({
        inputBlocks,
        prompt: buildAgentPrompt(brief, config.prompt ?? ''),
        cliType: config.cliType,
        agentType: config.agentType,
        modeId: request.agent.modeId,
        modelId: request.agent.modelId,
        configOptionValues: request.agent.configOptionValues,
        taskToolsEnabled: true,
      });
      const pendingHistoryEntry = buildPendingUserHistoryEntry({
        userId,
        inputBlocks,
        timestamp: new Date(getServerNow()).toISOString(),
        inputConfig,
      });
      if (!pendingHistoryEntry) {
        return { ok: false, reason: 'not_ready' };
      }

      const { sessionId, historyEntry } = await startSession(
        {
          userId,
          cliType: config.cliType,
          agentType: config.agentType,
          customAcp: config.customAcp,
          runtimeOverrides: config.runtimeOverrides,
          machineId: config.machineId,
          agentConfigId: config.id,
          env: config.env,
          project,
          ...(project?.kind === 'github'
            ? { repoFullName: project.repoFullName, branchName: project.branch }
            : {}),
          ...(project?.kind === 'local' && project.branch ? { branchName: project.branch } : {}),
          title: request.title.slice(0, 50),
          titleSource: 'draft',
          taskId: request.taskId,
        },
        pendingHistoryEntry
      );

      // Dual-author (#3138): the renderer direct-authors its own durable writes,
      // so start never absorbs the dispatch and every creation surface requests
      // it unconditionally — same as chat landing and child tabs.
      await requestSessionDispatch(sessionId, historyEntry.id, {
        inputConfig,
        machineId: config.machineId,
      });

      // Sibling side effects of an accepted dispatch: neither may block the
      // navigation the user is waiting for.
      void linkSession(request.taskId, sessionId, 'run').catch((error: unknown) => {
        console.error('Failed to link task session', error);
      });
      void updateTaskFields(request.taskId, {
        status: 'in_progress',
        lastRunConfig: request.agent,
      }).catch((error: unknown) => {
        console.error('Failed to advance task status', error);
      });

      if (workspaceSlug) {
        void router.navigate({
          to: '/$workspaceName/sessions/$sessionId',
          params: { workspaceName: workspaceSlug, sessionId },
        });
      }

      return { ok: true, sessionId };
    },
    [
      agentConfigs,
      linkSession,
      requestSessionDispatch,
      router,
      startSession,
      updateTaskFields,
      user?.id,
      workspaceSlug,
    ]
  );
}
