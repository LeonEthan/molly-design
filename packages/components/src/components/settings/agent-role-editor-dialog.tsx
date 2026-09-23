import { useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { usePostHog } from '@posthog/react';
import { useTranslation } from 'react-i18next';
import {
  canManageAgentRole,
  getServerNow,
  isAcpCapabilityCacheEntryCurrent,
  type AgentRole,
  type AgentRoleId,
  type MachineId,
} from '@molly/shared';
import {
  decodeMollyModelOption,
  getEmbeddedHarnessTargetError,
} from '@molly/shared/embedded-harness';

import { userAtom } from '@/atoms';
import { getAllAgentConfigAtom } from '@/atoms/agents';
import { onlineMachineIdsAtom } from '@/atoms/presence';
import { useAcpSelectorOptions } from '@/hooks/use-acp-selector-options';
import { useIsMobile } from '@/hooks/use-mobile';
import { useVisibleMachineMetas } from '@/hooks/use-visible-machine-metas';
import { useWorkspaceAgentRoleActions } from '@/hooks/use-workspace-agent-roles';
import {
  applyAgentRoleRunConfigDefaults,
  buildAgentRoleFormValue,
  buildAgentRoleFromForm,
  buildAgentRoleRunConfig,
  buildAgentRoleMigrationFormValue,
  buildMigratedAgentRole,
  findAgentRoleRunConfigIssues,
  validateAgentRoleForm,
  type AgentRoleFormValue,
} from '@/lib/agent-role-form';
import { cn } from '@/lib/utils';
import { capturePostHogEvent } from '@/lib/posthog-analytics';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { AgentRoleForm } from './agent-role-form';

/**
 * A `create` carries its id from the moment the form opens.
 *
 * The id is what the name check must ignore, and a `create` becomes a catalog
 * row the instant its local write lands — while the dialog is still open. An id
 * allocated at save time would leave a window where the form finds the row it
 * just wrote and reports its own name as taken.
 */
export type AgentRoleEditorState =
  | { mode: 'add'; roleId: AgentRoleId; value: AgentRoleFormValue }
  | { mode: 'edit'; role: AgentRole; value: AgentRoleFormValue }
  | { mode: 'migrate'; role: AgentRole; value: AgentRoleFormValue; migratedAt: number };

export const openAgentRoleEditorForCreate = (value: AgentRoleFormValue): AgentRoleEditorState => ({
  mode: 'add',
  roleId: crypto.randomUUID() as AgentRoleId,
  value,
});

export const openAgentRoleEditorForEdit = (role: AgentRole): AgentRoleEditorState => ({
  mode: 'edit',
  role,
  value: buildAgentRoleFormValue(role),
});

export const openAgentRoleEditorForMigration = (role: AgentRole): AgentRoleEditorState => ({
  mode: 'migrate',
  role,
  value: buildAgentRoleMigrationFormValue(role),
  migratedAt: getServerNow(),
});

/**
 * The one Role editor.
 *
 * Settings and the composer's Role picker both create and edit Roles, and the
 * rules that must not be got wrong — when `revision` moves, which option keys a
 * Role may store, whether a saved value is still supported — live in
 * `lib/agent-role-form.ts` behind this single dialog rather than being wired up
 * twice.
 */
export function AgentRoleEditorDialog({
  editor,
  accessibleRoles,
  onChange,
  onClose,
  onSaved,
  source,
}: {
  editor: AgentRoleEditorState | null;
  /** Roles this user can see, for the mention-token uniqueness check. */
  accessibleRoles: readonly AgentRole[];
  onChange: (editor: AgentRoleEditorState) => void;
  onClose: () => void;
  /**
   * The Role that was just written, once it is durable. `created` separates a
   * new Role from an edit, because a surface that OPENED the create — the
   * composer — means to start using what it just made, while an edit is only an
   * edit.
   */
  onSaved?: (role: AgentRole, meta: { created: boolean }) => void;
  /** Entry point that opened the editor; used only for product analytics. */
  source: 'settings' | 'chat_landing' | 'session_composer';
}) {
  const { t } = useTranslation();
  const postHog = usePostHog();
  const isMobile = useIsMobile();
  const currentUserId = useAtomValue(userAtom)?.id ?? null;
  const onlineMachineIds = useAtomValue(onlineMachineIdsAtom);
  const agentConfigs = useAtomValue(getAllAgentConfigAtom);
  const { machines } = useVisibleMachineMetas();
  const { upsert } = useWorkspaceAgentRoleActions();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const migrating = editor?.mode === 'migrate';
  const legacyEdit =
    editor?.mode === 'edit' &&
    !editor.role.embeddedMigration &&
    !agentConfigs.some(
      (config) =>
        config.id === editor.role.agentConfigId &&
        config.machineId === editor.role.machineId &&
        getEmbeddedHarnessTargetError(config) === undefined
    );
  const embeddedOnly = !legacyEdit;

  const machineOptions = useMemo(
    () =>
      [...machines.values()]
        .map((machine) => ({
          machineId: machine.id,
          label: machine.name || machine.id,
          online: onlineMachineIds.has(machine.id),
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [machines, onlineMachineIds]
  );

  const selectedMachineId: MachineId | null = editor?.value.machineId ?? null;
  const machineAgentConfigs = useMemo(
    () =>
      agentConfigs.filter(
        (config) =>
          config.machineId === selectedMachineId &&
          (!embeddedOnly || getEmbeddedHarnessTargetError(config) === undefined) &&
          (!legacyEdit || config.id === editor?.value.agentConfigId)
      ),
    [agentConfigs, selectedMachineId, embeddedOnly, legacyEdit, editor?.value.agentConfigId]
  );
  const selectedAgentConfig = useMemo(
    () => machineAgentConfigs.find((config) => config.id === editor?.value.agentConfigId),
    [editor?.value.agentConfigId, machineAgentConfigs]
  );
  const selectorOptions = useAcpSelectorOptions(
    selectedAgentConfig
      ? {
          configId: selectedAgentConfig.id,
          cliType: selectedAgentConfig.cliType,
          agentType: selectedAgentConfig.agentType,
          // A Role pins its model: the effort ladder must follow the model
          // being edited, not the probe-time current one, so the picker and
          // the compatibility check agree on the same ladder.
          selectedModelId: editor?.value.modelId ?? null,
          runtimeOverrides: selectedAgentConfig.runtimeOverrides,
          machine: selectedMachineId ? (machines.get(selectedMachineId) ?? null) : null,
        }
      : undefined
  );

  // A Role pins concrete values, so as soon as an agent config's capabilities
  // are known its own defaults fill the unset fields. The user then adjusts a
  // real selection instead of accepting an "Agent default" that says nothing
  // about what would run. A stored value is never overwritten — that is what
  // keeps an incompatible one visible. Derived rather than written back: the
  // defaults are a function of the value and the capabilities, and the helper
  // returns the value itself when it changes nothing.
  const editorValue = editor
    ? selectedAgentConfig
      ? applyAgentRoleRunConfigDefaults(
          editor.value,
          selectorOptions,
          selectedAgentConfig.cliType === 'builtin' && selectedAgentConfig.agentType === 'molly'
        )
      : editor.value
    : null;

  const formErrors = useMemo(
    () =>
      editorValue
        ? validateAgentRoleForm(editorValue, {
            accessibleRoles,
            editingRoleId: editor ? (editor.mode !== 'add' ? editor.role.id : editor.roleId) : null,
          })
        : [],
    [accessibleRoles, editor, editorValue]
  );
  const requiresModel =
    embeddedOnly ||
    (selectedAgentConfig?.cliType === 'builtin' && selectedAgentConfig.agentType === 'molly');
  const modelSelection = decodeMollyModelOption(
    editorValue?.modelId,
    editorValue?.configOptionValues.reasoning_effort ?? 'off'
  );
  const modelMissing = requiresModel && !modelSelection;
  const runConfigIssues = useMemo(
    () =>
      editorValue && selectedAgentConfig
        ? findAgentRoleRunConfigIssues(buildAgentRoleRunConfig(editorValue), selectorOptions)
        : [],
    [editorValue, selectedAgentConfig, selectorOptions]
  );
  const capabilityCurrent = isAcpCapabilityCacheEntryCurrent(
    selectedMachineId && selectedAgentConfig
      ? machines.get(selectedMachineId)?.acpCapabilities?.[selectedAgentConfig.id]
      : undefined
  );
  const cannotSave =
    legacyEdit ||
    !selectedAgentConfig ||
    getEmbeddedHarnessTargetError(selectedAgentConfig) !== undefined ||
    (requiresModel &&
      (!capabilityCurrent ||
        selectorOptions.capabilityAuthority !== 'authoritative' ||
        runConfigIssues.length > 0 ||
        !modelSelection ||
        selectorOptions.modelReasoningEfforts?.[editorValue?.modelId ?? '']?.includes(
          modelSelection.thinking
        ) !== true));

  const close = () => {
    setError(undefined);
    onClose();
  };

  const save = async () => {
    if (
      !editor ||
      !editorValue ||
      formErrors.length > 0 ||
      !currentUserId ||
      modelMissing ||
      cannotSave ||
      (editor.mode !== 'add' && !canManageAgentRole(editor.role, currentUserId))
    )
      return;
    setSubmitting(true);
    setError(undefined);
    try {
      const role =
        editor.mode === 'migrate'
          ? buildMigratedAgentRole(editor.role, editorValue, editor.migratedAt)
          : buildAgentRoleFromForm(editorValue, {
              existing: editor.mode === 'edit' ? editor.role : undefined,
              ownerUserId: currentUserId,
              now: getServerNow(),
              createId: () => (editor.mode === 'add' ? editor.roleId : editor.role.id),
            });
      // Resolves on durability: the row exists, so the editor is done. The
      // upload runs on its own and is deliberately not reported — a deferred
      // upload is not a failed save and there is nothing to act on.
      await upsert(role);
      if (editor.mode === 'add') {
        capturePostHogEvent(postHog, 'settings/agent_role_created', {
          source,
          visibility: role.visibility,
          has_prompt_prefix: Boolean(role.promptPrefix),
          run_config_option_count: Object.keys(role.runConfig.configOptionValues ?? {}).length,
        });
      }
      onSaved?.(role, { created: editor.mode === 'add' });
      close();
    } catch (cause) {
      setError(
        embeddedOnly
          ? t('settings.agentRoles.migration.saveFailed')
          : cause instanceof Error
            ? cause.message
            : String(cause)
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={editor !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        overlayClassName={
          // Desktop settings is itself a dialog; match its z-index so this
          // later overlay covers it without stacking a second /80 veil.
          isMobile ? undefined : 'z-[var(--z-dialog)] bg-black/20'
        }
        className={cn(
          'flex max-h-[min(680px,88dvh)] w-[min(620px,96dvw)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl border-border/50 bg-background p-0 sm:max-w-none sm:rounded-2xl sm:p-0',
          !isMobile && 'shadow-popover'
        )}
      >
        <header className="shrink-0 border-b border-border/40 px-5 py-5 pr-12">
          <DialogTitle className="text-base font-medium">
            {migrating
              ? t('settings.agentRoles.migration.title')
              : editor?.mode === 'edit'
                ? t('settings.agentRoles.editTitle')
                : t('settings.agentRoles.addTitle')}
          </DialogTitle>
          <DialogDescription className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {migrating
              ? t('settings.agentRoles.migration.description')
              : t('settings.agentRoles.dialogDescription')}
          </DialogDescription>
        </header>
        {editor && editorValue ? (
          <AgentRoleForm
            className="min-h-0 flex-1"
            value={editorValue}
            onChange={(value) => onChange({ ...editor, value })}
            machines={
              migrating
                ? machineOptions.filter((machine) => machine.machineId === editor.role.machineId)
                : machineOptions
            }
            agentConfigs={machineAgentConfigs.map((config) => ({
              agentConfigId: config.id,
              label: config.name,
            }))}
            selectorOptions={selectedAgentConfig ? selectorOptions : null}
            issues={runConfigIssues}
            errors={modelMissing ? [...formErrors, 'model_required'] : formErrors}
            submitDisabled={
              cannotSave ||
              (editor.mode !== 'add' && !canManageAgentRole(editor.role, currentUserId))
            }
            submitting={submitting}
            readOnly={legacyEdit}
            error={
              legacyEdit
                ? t(
                    selectedAgentConfig
                      ? 'settings.agentRoles.unavailable.agentConfigRetired'
                      : 'settings.agentRoles.unavailable.agentConfigMissing'
                  )
                : (error ??
                  (selectedAgentConfig && cannotSave
                    ? t(
                        !capabilityCurrent ||
                          selectorOptions.capabilityAuthority !== 'authoritative'
                          ? 'settings.agentRoles.unavailable.capabilitiesUnavailable'
                          : 'settings.agentRoles.unavailable.runConfigUnsupported'
                      )
                    : undefined))
            }
            isEditing={editor.mode !== 'add'}
            isMigrating={migrating}
            migrationBackup={editor.mode !== 'add' ? editor.role.embeddedMigration : undefined}
            onSubmit={() => void save()}
            onCancel={close}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
