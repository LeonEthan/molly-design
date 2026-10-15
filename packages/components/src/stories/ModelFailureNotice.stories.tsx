import type { Meta, StoryObj } from '@storybook/react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import {
  getSessionRoomId,
  type AgentConfigId,
  type MachineId,
  type SessionHistoryParsed,
  type SessionId,
  type SessionMeta,
} from '@molly/shared';

import { sessionMetaCacheAtom } from '@/atoms/doc-meta';
import { MessageRowView, type ModelFailureRetryControl } from '@/components/ai-gui/view';
import { ConversationColumn } from '@/components/shared/conversation-column';

const meta = {
  title: 'Sessions/ModelFailureNotice',
  component: MessageRowView,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
} satisfies Meta<typeof MessageRowView>;

export default meta;
type Story = StoryObj<typeof meta>;

const sessionId = 'model-failure-session' as SessionId;
const noticeId = 'model-failure-notice';
const sessionMeta = {
  id: sessionId,
  machineId: 'story-machine' as MachineId,
  agentConfigId: 'story-agent' as AgentConfigId,
  userId: 'story-user',
  createdAt: '2026-08-31T09:00:00.000Z',
  cliType: 'builtin',
  agentType: 'codex',
  status: { type: 'idle' as const },
} satisfies SessionMeta;

const transientMessage = {
  id: noticeId,
  role: 'system',
  timestamp: '2026-08-31T09:00:00.000Z',
  read: true,
  items: [
    {
      type: 'system_notice',
      name: 'chat_failed',
      meta: {
        reason: 'acp_upstream_api_error',
        code: 'model_temporarily_unavailable',
        message: 'Model request failed after automatic retries: 503 Service Unavailable',
      },
    },
  ],
} as SessionHistoryParsed;

const permanentAuthMessage = {
  ...transientMessage,
  id: 'model-auth-failure-notice',
  items: [
    {
      type: 'system_notice',
      name: 'chat_failed',
      meta: {
        reason: 'acp_upstream_api_error',
        code: 'model_auth_rejected',
        message: 'Model request failed: 401 Unauthorized',
      },
    },
  ],
} as SessionHistoryParsed;

function renderRow(args: React.ComponentProps<typeof MessageRowView>) {
  const store = createStore();
  store.set(sessionMetaCacheAtom, { [getSessionRoomId(sessionId)]: sessionMeta });
  return (
    <JotaiProvider store={store}>
      <div className="w-[760px] max-w-[100vw] bg-background py-6">
        <ConversationColumn>
          <MessageRowView {...args} />
        </ConversationColumn>
      </div>
    </JotaiProvider>
  );
}

const retryControl = {
  noticeId,
  pending: false,
  canRetry: true,
  retry: () => undefined,
} satisfies ModelFailureRetryControl;

const retryingControl = {
  ...retryControl,
  pending: true,
} satisfies ModelFailureRetryControl;

export const TransientWithRetry: Story = {
  args: {
    message: transientMessage,
    sessionId,
    modelFailureRetry: retryControl,
  },
  render: renderRow,
};

export const TransientRetrying: Story = {
  args: {
    message: transientMessage,
    sessionId,
    modelFailureRetry: retryingControl,
  },
  render: renderRow,
};

export const PermanentAuth: Story = {
  args: {
    message: permanentAuthMessage,
    sessionId,
  },
  render: renderRow,
};
