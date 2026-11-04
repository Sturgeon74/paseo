import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { DropdownMenuSubTrigger, type MenuPageDefinition } from "@/components/ui/dropdown-menu";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { deriveIdentityColorName, IDENTITY_COLOR_NAMES } from "@/styles/identity-colors";
import { conversationProjectKey, emptyProjectFolders, placeFolders } from "./model";
import { conversationFolderStore } from "./store";

export function useWorkspaceConversationFolderMenu(
  serverId?: string,
  workspaceId?: string,
  projectViewKey?: string,
) {
  const { t } = useTranslation();
  const toast = useToast();
  const [creatingAgentId, setCreatingAgentId] = useState<string | null>(null);
  const session = useSessionStore((state) => (serverId ? state.sessions[serverId] : undefined));
  const workspace = workspaceId ? session?.workspaces.get(workspaceId) : undefined;
  const projectKey =
    serverId && workspace?.projectId ? conversationProjectKey(serverId, workspace.projectId) : "";
  const organization = conversationFolderStore.useStore(
    (state) => state.organization.projects[projectKey],
  );
  const status = conversationFolderStore.useStore((state) => state.status);
  useEffect(() => {
    void conversationFolderStore.load();
  }, []);
  const agents = useMemo(
    () =>
      [...(session?.agents.values() ?? [])].filter(
        (agent) => agent.workspaceId === workspaceId && !agent.archivedAt && !agent.parentAgentId,
      ),
    [session?.agents, workspaceId],
  );
  const agent = agents.find((item) => item.id === creatingAgentId);
  const folders = organization ?? emptyProjectFolders;
  const choices = useMemo(() => placeFolders(folders.folders), [folders.folders]);
  const move = useCallback(
    (agentId: string, folderId: string) => {
      void conversationFolderStore
        .change(projectKey, { kind: "move", agentId, folderId })
        .catch(() => toast.error(t("sidebar.conversationFolders.saveFailed")));
    },
    [projectKey, toast, t],
  );
  const open = useCallback((id: string) => setCreatingAgentId(id), []);
  const close = useCallback(() => setCreatingAgentId(null), []);
  const submit = useCallback(
    async (name: string) => {
      if (!agent) return;
      const color = IDENTITY_COLOR_NAMES.find(
        (value) =>
          value !== deriveIdentityColorName(projectViewKey ?? projectKey) &&
          !folders.folders.some((folder) => folder.color === value),
      );
      await conversationFolderStore.change(projectKey, {
        kind: "create",
        id: crypto.randomUUID(),
        name,
        parentId: null,
        agentId: agent.id,
        color,
      });
    },
    [agent, folders, projectKey, projectViewKey],
  );
  const pages: MenuPageDefinition[] =
    agents.length > 0
      ? [
          {
            id: "workspace-conversation-folder",
            title: t("sidebar.conversationFolders.move"),
            content:
              agents.length === 1
                ? choices.map(({ folder, path }) => (
                    <WorkspaceFolderDestination
                      key={folder.id}
                      id={folder.id}
                      agentId={agents[0]!.id}
                      path={path}
                      onMove={move}
                    />
                  ))
                : agents.map((entry) => (
                    <DropdownMenuSubTrigger
                      key={entry.id}
                      id={`workspace-conversation-folder-${entry.id}`}
                    >
                      {entry.title || entry.provider}
                    </DropdownMenuSubTrigger>
                  )),
          },
          ...(agents.length > 1
            ? agents.map((entry) => ({
                id: `workspace-conversation-folder-${entry.id}`,
                title: entry.title || entry.provider,
                content: choices.map(({ folder, path }) => (
                  <WorkspaceFolderDestination
                    key={folder.id}
                    id={folder.id}
                    agentId={entry.id}
                    path={path}
                    onMove={move}
                  />
                )),
              }))
            : []),
          ...(agents.length > 1
            ? [
                {
                  id: "workspace-conversation-create",
                  title: t("sidebar.conversationFolders.createAndMove"),
                  content: agents.map((entry) => (
                    <WorkspaceCreateForAgent
                      key={entry.id}
                      id={entry.id}
                      title={entry.title || entry.provider}
                      onOpen={open}
                    />
                  )),
                },
              ]
            : []),
        ]
      : [];
  const items =
    agents.length > 0 && status === "ready" ? (
      <>
        <DropdownMenuSubTrigger id="workspace-conversation-folder" disabled={choices.length === 0}>
          {t("sidebar.conversationFolders.move")}
        </DropdownMenuSubTrigger>
        {agents.length === 1 ? (
          <WorkspaceCreateForAgent
            id={agents[0]!.id}
            title={t("sidebar.conversationFolders.createAndMove")}
            onOpen={open}
          />
        ) : (
          <DropdownMenuSubTrigger id="workspace-conversation-create">
            {t("sidebar.conversationFolders.createAndMove")}
          </DropdownMenuSubTrigger>
        )}
      </>
    ) : null;
  const dialog =
    creatingAgentId && agent ? (
      <AdaptiveRenameModal
        visible
        title={t("sidebar.conversationFolders.create")}
        initialValue=""
        submitLabel={t("sidebar.conversationFolders.createAction")}
        maxLength={100}
        testID="sidebar-conversation-name"
        onClose={close}
        onSubmit={submit}
      />
    ) : null;
  return { pages, items, dialog };
}

function WorkspaceFolderDestination({
  id,
  path,
  onMove,
  agentId,
}: {
  id: string;
  agentId: string;
  path: string;
  onMove: (agentId: string, id: string) => void;
}) {
  const select = useCallback(() => onMove(agentId, id), [agentId, id, onMove]);
  return <ContextMenuItem onSelect={select}>{path}</ContextMenuItem>;
}

function WorkspaceCreateForAgent({
  id,
  title,
  onOpen,
}: {
  id: string;
  title: string;
  onOpen: (id: string) => void;
}) {
  const select = useCallback(() => onOpen(id), [id, onOpen]);
  return <ContextMenuItem onSelect={select}>{title}</ContextMenuItem>;
}
