import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { DropdownMenuSubTrigger, type MenuPageDefinition } from "@/components/ui/dropdown-menu";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { deriveIdentityColorName, IDENTITY_COLOR_NAMES } from "@/styles/identity-colors";
import {
  conversationProjectKey,
  emptyProjectFolders,
  placeFolders,
  selectWorkspaceFolderTargets,
} from "./model";
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
  const folders = organization ?? emptyProjectFolders;
  const targets = useMemo(
    () =>
      selectWorkspaceFolderTargets({
        workspace,
        agents: session?.agents.values() ?? [],
        folders,
      }),
    [workspace, session?.agents, folders],
  );
  const agent = targets.find((item) => item.id === creatingAgentId);
  const choices = useMemo(
    () => [
      { folder: { id: null }, path: t("sidebar.conversationFolders.projectRoot") },
      ...placeFolders(folders.folders),
    ],
    [folders.folders, t],
  );
  const move = useCallback(
    (agentId: string, folderId: string | null) => {
      const target = targets.find((item) => item.id === agentId);
      if (!target) return;
      void conversationFolderStore
        .change(
          projectKey,
          target.kind === "workspace"
            ? { kind: "moveWorkspace", workspaceId: target.id, folderId }
            : { kind: "move", agentId, folderId },
        )
        .catch((error: unknown) =>
          toast.error(
            error instanceof Error ? error.message : t("sidebar.conversationFolders.saveFailed"),
          ),
        );
    },
    [projectKey, targets, toast, t],
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
        ...(agent.kind === "workspace" ? { workspaceId: agent.id } : { agentId: agent.id }),
        color,
      });
    },
    [agent, folders, projectKey, projectViewKey],
  );
  const pages: MenuPageDefinition[] =
    targets.length > 0
      ? [
          {
            id: "workspace-conversation-folder",
            title: t("sidebar.conversationFolders.move"),
            content:
              targets.length === 1
                ? choices.map(({ folder, path }) => (
                    <WorkspaceFolderDestination
                      key={folder.id ?? "root"}
                      id={folder.id}
                      agentId={targets[0]!.id}
                      path={path}
                      onMove={move}
                    />
                  ))
                : targets.map((entry) => (
                    <DropdownMenuSubTrigger
                      key={entry.id}
                      id={`workspace-conversation-folder-${entry.id}`}
                    >
                      {entry.title}
                    </DropdownMenuSubTrigger>
                  )),
          },
          ...(targets.length > 1
            ? targets.map((entry) => ({
                id: `workspace-conversation-folder-${entry.id}`,
                title: entry.title,
                content: choices.map(({ folder, path }) => (
                  <WorkspaceFolderDestination
                    key={folder.id ?? "root"}
                    id={folder.id}
                    agentId={entry.id}
                    path={path}
                    onMove={move}
                  />
                )),
              }))
            : []),
          ...(targets.length > 1
            ? [
                {
                  id: "workspace-conversation-create",
                  title: t("sidebar.conversationFolders.createAndMove"),
                  content: targets.map((entry) => (
                    <WorkspaceCreateForAgent
                      key={entry.id}
                      id={entry.id}
                      title={entry.title}
                      onOpen={open}
                    />
                  )),
                },
              ]
            : []),
        ]
      : [];
  const items =
    targets.length > 0 && status === "ready" ? (
      <>
        <DropdownMenuSubTrigger
          id="workspace-conversation-folder"
          disabled={folders.folders.length === 0}
        >
          {t("sidebar.conversationFolders.move")}
        </DropdownMenuSubTrigger>
        {targets.length === 1 ? (
          <WorkspaceCreateForAgent
            id={targets[0]!.id}
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
  id: string | null;
  agentId: string;
  path: string;
  onMove: (agentId: string, id: string | null) => void;
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
