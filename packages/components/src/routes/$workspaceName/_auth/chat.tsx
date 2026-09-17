import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';
import { ChatLanding } from '@/components/chat/chat-landing';
import {
  parseChatLandingSearch,
  type ChatLandingSearch,
} from '@/components/chat/chat-landing-derived';

export type ChatSearch = ChatLandingSearch;

export const Route = createFileRoute('/$workspaceName/_auth/chat')({
  component: ChatRoute,
  validateSearch: parseChatLandingSearch,
});

function ChatRoute() {
  const { workspaceName } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  // Selection steering is an in-place correction of the current address, not
  // a visit to a new page, so the mirror always replaces.
  const handleSelectionUrlSync = useCallback(
    (selectionSearch: ChatLandingSearch) => {
      void navigate({ search: selectionSearch, replace: true });
    },
    [navigate]
  );

  return (
    <ChatLanding
      workspaceSlug={workspaceName}
      preSelectedContext={search.context}
      preSelectedMachine={search.machine}
      preSelectedProject={search.project}
      preSelectedRepo={search.repo}
      onSelectionUrlSync={handleSelectionUrlSync}
    />
  );
}
