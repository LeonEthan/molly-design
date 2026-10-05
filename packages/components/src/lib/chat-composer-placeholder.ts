import type { AcpCommandSummary } from '@molly/shared';
import type { MentionProjectSource } from '@/components/mentions/mention-project-file-source';

export type ChatComposerPromptPlaceholderKey =
  | 'composer.promptPlaceholder.base'
  | 'composer.promptPlaceholder.commands'
  | 'composer.promptPlaceholder.mentions'
  | 'composer.promptPlaceholder.skills'
  | 'composer.promptPlaceholder.commandsMentions'
  | 'composer.promptPlaceholder.commandsSkills'
  | 'composer.promptPlaceholder.mentionsSkills'
  | 'composer.promptPlaceholder.commandsMentionsSkills';

function hasChatComposerCommandHints(availableCommands?: AcpCommandSummary[]): boolean {
  return Boolean(availableCommands && availableCommands.length > 0);
}

function hasChatComposerFileMentions(mentionSource?: MentionProjectSource): boolean {
  if (mentionSource?.kind === 'local') return Boolean(mentionSource.localProjectId);
  if (mentionSource?.kind === 'github') return Boolean(mentionSource.repoFullName);
  return false;
}

function hasChatComposerIssuePrMentions(mentionSource?: MentionProjectSource): boolean {
  if (mentionSource?.kind === 'github') return Boolean(mentionSource.repoFullName);
  if (mentionSource?.kind === 'local') return Boolean(mentionSource.githubRepoFullName);
  return false;
}

export function hasChatComposerMentionHints(mentionSource?: MentionProjectSource): boolean {
  return (
    hasChatComposerFileMentions(mentionSource) || hasChatComposerIssuePrMentions(mentionSource)
  );
}

export function hasChatComposerSkillHints(
  mentionSource?: MentionProjectSource,
  skillAgent?: { machineId?: string }
): boolean {
  if (skillAgent?.machineId?.trim()) return true;
  if (mentionSource?.kind === 'local') {
    return Boolean(
      mentionSource.localProjectId && mentionSource.workspaceId && mentionSource.machineId
    );
  }
  if (mentionSource?.kind === 'github') return Boolean(mentionSource.repoFullName);
  if (mentionSource?.kind === 'provider') return Boolean(mentionSource.githubRepoFullName);
  return false;
}

export function getChatComposerPromptPlaceholderKey({
  mentionSource,
  availableCommands,
  skillAgent,
}: {
  mentionSource?: MentionProjectSource;
  availableCommands?: AcpCommandSummary[];
  skillAgent?: { machineId?: string };
}): ChatComposerPromptPlaceholderKey {
  const hasCommands = hasChatComposerCommandHints(availableCommands);
  const hasMentions = hasChatComposerMentionHints(mentionSource);
  const hasSkills = hasChatComposerSkillHints(mentionSource, skillAgent);

  if (hasCommands && hasMentions && hasSkills) {
    return 'composer.promptPlaceholder.commandsMentionsSkills';
  }
  if (hasMentions && hasSkills) return 'composer.promptPlaceholder.mentionsSkills';
  if (hasCommands && hasSkills) return 'composer.promptPlaceholder.commandsSkills';
  if (hasCommands && hasMentions) return 'composer.promptPlaceholder.commandsMentions';
  if (hasCommands) return 'composer.promptPlaceholder.commands';
  if (hasMentions) return 'composer.promptPlaceholder.mentions';
  if (hasSkills) return 'composer.promptPlaceholder.skills';
  return 'composer.promptPlaceholder.base';
}
