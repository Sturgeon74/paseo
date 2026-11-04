import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Folder, FolderPlus, MessageSquare } from "lucide-react-native";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { DropdownMenuSubTrigger, type MenuPageDefinition } from "@/components/ui/dropdown-menu";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useToast } from "@/contexts/toast-context";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import { getHostRuntimeStore, useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import {
  conversationProjectKey,
  groupConversations,
  placeFolders,
  selectProjectConversations,
  type FolderAction,
  type ProjectFolders,
} from "./model";
import { ConversationFolderRow } from "./row";
import { conversationFolderStore } from "./store";

interface ProjectConversationFoldersProps {
  project: SidebarProjectEntry;
  onOpenConversation?: () => void;
}

export function ProjectConversationFolders({
  project,
  onOpenConversation,
}: ProjectConversationFoldersProps) {
  useEffect(() => {
    void conversationFolderStore.load();
  }, []);
  return project.hosts.map(({ serverId, projectId }) => {
    const projectKey = conversationProjectKey(serverId, projectId);
    return (
      <HostProjectFolders
        key={projectKey}
        projectKey={projectKey}
        projectViewKey={project.viewKey}
        serverId={serverId}
        showHost={project.hosts.length > 1}
        onOpenConversation={onOpenConversation}
      />
    );
  });
}

interface HostProjectFoldersProps {
  projectKey: string;
  projectViewKey: string;
  serverId: string;
  showHost: boolean;
  onOpenConversation?: () => void;
}

type NameDialog =
  | { kind: "create"; parentId: string | null }
  | { kind: "folder"; id: string; name: string }
  | { kind: "agent"; id: string; name: string };

function HostProjectFolders({
  projectKey,
  projectViewKey,
  serverId,
  showHost,
  onOpenConversation,
}: HostProjectFoldersProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const status = conversationFolderStore.useStore((state) => state.status);
  const folders = conversationFolderStore.useStore(
    (state) => state.organization.projects[projectKey],
  );
  const online = useHostRuntimeIsConnected(serverId);
  const [dialog, setDialog] = useState<NameDialog | null>(null);
  const hosts = useHosts();
  const host = showHost ? hosts.find((entry) => entry.serverId === serverId)?.label : undefined;
  const createLabel = t("sidebar.conversationFolders.create");
  const renameFolderLabel = t("sidebar.conversationFolders.renameFolder");
  const renameAgentLabel = t("workspace.tabs.menu.renameAgent");

  const change = useCallback(
    (action: FolderAction) => {
      void conversationFolderStore
        .change(projectKey, action)
        .catch(() => toast.error(t("sidebar.conversationFolders.saveFailed")));
    },
    [projectKey, toast, t],
  );

  const submit = useCallback(
    async (name: string) => {
      if (!dialog) return;
      if (dialog.kind === "agent") {
        const client = getHostRuntimeStore().getClient(serverId);
        if (!client?.isConnected) throw new Error(t("workspace.terminal.hostDisconnected"));
        await client.updateAgent(dialog.id, { name: name.trim() });
        return;
      }
      const action: FolderAction =
        dialog.kind === "create"
          ? { kind: "create", id: crypto.randomUUID(), name, parentId: dialog.parentId }
          : { kind: "rename", id: dialog.id, name };
      try {
        await conversationFolderStore.change(projectKey, action);
      } catch {
        throw new Error(t("sidebar.conversationFolders.saveFailed"));
      }
    },
    [dialog, projectKey, serverId, t],
  );

  const createFolder = useCallback(() => {
    if (status === "ready") setDialog({ kind: "create", parentId: null });
    else toast.error(t("sidebar.conversationFolders.loadFailed"));
  }, [status, toast, t]);
  const closeDialog = useCallback(() => setDialog(null), []);
  const renameLabel = dialog?.kind === "folder" ? renameFolderLabel : renameAgentLabel;

  if (status === "loading") return null;

  return (
    <>
      {status === "ready" && folders ? (
        <FolderTree
          folders={folders}
          projectViewKey={projectViewKey}
          projectKey={projectKey}
          serverId={serverId}
          onOpenConversation={onOpenConversation}
          onChange={change}
          onName={setDialog}
          online={online}
          hostLabel={host}
        />
      ) : null}
      <ConversationFolderRow
        icon={FolderPlus}
        label={createLabel}
        detail={host}
        depth={0}
        testID={`sidebar-conversation-new-folder-${projectKey}`}
        onPress={createFolder}
      />
      {dialog ? (
        <AdaptiveRenameModal
          visible
          title={dialog.kind === "create" ? createLabel : renameLabel}
          initialValue={dialog.kind === "create" ? "" : dialog.name}
          submitLabel={
            dialog.kind === "create"
              ? t("sidebar.conversationFolders.createAction")
              : t("workspace.tabs.menu.rename")
          }
          maxLength={dialog.kind === "agent" ? 200 : 100}
          onSubmit={submit}
          onClose={closeDialog}
          testID="sidebar-conversation-name"
        />
      ) : null}
    </>
  );
}

interface FolderTreeProps {
  folders: ProjectFolders;
  projectKey: string;
  projectViewKey: string;
  serverId: string;
  online: boolean;
  hostLabel?: string;
  onOpenConversation?: () => void;
  onChange: (action: FolderAction) => void;
  onName: (dialog: NameDialog) => void;
}

function FolderTree({
  folders,
  projectKey,
  projectViewKey,
  serverId,
  online,
  hostLabel,
  onOpenConversation,
  onChange,
  onName,
}: FolderTreeProps) {
  const { t } = useTranslation();
  const active = useRetainedPanelActive();
  const { workspaceEntriesByKey } = useSidebarModel();
  const agents = useSessionStore((state) =>
    active ? state.sessions[serverId]?.agents : undefined,
  );
  const placements = useMemo(() => placeFolders(folders.folders), [folders.folders]);
  const groups = useMemo(() => {
    const visible = selectProjectConversations({
      agents: agents?.values() ?? [],
      visibleWorkspaces: workspaceEntriesByKey,
      projectViewKey,
      serverId,
    });
    return groupConversations(visible, folders.assignments, placements);
  }, [agents, workspaceEntriesByKey, serverId, projectViewKey, folders.assignments, placements]);

  const unfiledLabel = t("sidebar.conversationFolders.unfiled");
  const folderChoices = useMemo(
    () => [
      { id: null, path: unfiledLabel },
      ...placements.map(({ folder, path }) => ({ id: folder.id, path })),
    ],
    [unfiledLabel, placements],
  );
  const toggleUnfiled = useCallback(() => onChange({ kind: "toggle", id: null }), [onChange]);

  function renderAgents(folderId: string | null, depth: number) {
    return groups
      .get(folderId)
      ?.map((agent) => (
        <ConversationRow
          key={agent.id}
          agent={agent}
          depth={depth}
          folderId={folderId}
          folderChoices={folderChoices}
          online={online}
          onOpenConversation={onOpenConversation}
          onName={onName}
          onChange={onChange}
        />
      ));
  }

  return (
    <>
      {placements
        .filter(({ visible }) => visible)
        .map(({ folder, depth, canMoveUp, canMoveDown }) => (
          <FolderBranch
            key={folder.id}
            id={folder.id}
            depth={depth}
            label={folder.name}
            expanded={!folder.collapsed}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onChange={onChange}
            onName={onName}
            conversations={folder.collapsed ? null : renderAgents(folder.id, depth + 1)}
          />
        ))}
      <ConversationFolderRow
        icon={Folder}
        label={unfiledLabel}
        detail={hostLabel}
        expanded={!folders.unfiledCollapsed}
        depth={0}
        testID={`sidebar-conversation-unfiled-${projectKey}`}
        onPress={toggleUnfiled}
      />
      {folders.unfiledCollapsed ? null : renderAgents(null, 1)}
    </>
  );
}

interface FolderChoice {
  id: string | null;
  path: string;
}

interface ConversationRowProps {
  agent: Agent;
  depth: number;
  folderId: string | null;
  folderChoices: FolderChoice[];
  online: boolean;
  onOpenConversation: FolderTreeProps["onOpenConversation"];
  onName: FolderTreeProps["onName"];
  onChange: FolderTreeProps["onChange"];
}

const ConversationRow = memo(function ConversationRow({
  agent,
  depth,
  folderId,
  folderChoices,
  online,
  onOpenConversation,
  onName,
  onChange,
}: ConversationRowProps) {
  const { t } = useTranslation();
  const { id, serverId, workspaceId, provider, title } = agent;
  const open = useCallback(() => {
    onOpenConversation?.();
    navigateToAgent({ serverId, agentId: id, workspaceId, pin: true });
  }, [id, onOpenConversation, serverId, workspaceId]);
  const rename = useCallback(
    () => onName({ kind: "agent", id, name: title ?? "" }),
    [id, onName, title],
  );
  const move = useCallback(
    (target: string | null) => onChange({ kind: "move", agentId: id, folderId: target }),
    [id, onChange],
  );
  const moveLabel = t("sidebar.conversationFolders.move");
  const pages = useMemo<MenuPageDefinition[]>(
    () => [
      {
        id: "move-conversation",
        title: moveLabel,
        content: (
          <FolderDestinations choices={folderChoices} currentFolderId={folderId} onMove={move} />
        ),
      },
    ],
    [moveLabel, folderChoices, folderId, move],
  );

  return (
    <ConversationFolderRow
      icon={MessageSquare}
      label={title || provider}
      depth={depth}
      testID={`sidebar-conversation-${serverId}-${id}`}
      onPress={open}
      pages={pages}
      menu={
        <>
          <ContextMenuItem disabled={!online} onSelect={rename}>
            {t("workspace.tabs.menu.renameAgent")}
          </ContextMenuItem>
          <DropdownMenuSubTrigger id="move-conversation" disabled={folderChoices.length < 2}>
            {moveLabel}
          </DropdownMenuSubTrigger>
        </>
      }
    />
  );
});

function FolderDestinations({
  choices,
  currentFolderId,
  onMove,
}: {
  choices: FolderChoice[];
  currentFolderId: string | null;
  onMove: (target: string | null) => void;
}) {
  return choices.map((choice) => (
    <FolderDestination
      key={choice.id ?? "unfiled"}
      choice={choice}
      selected={choice.id === currentFolderId}
      onMove={onMove}
    />
  ));
}

function FolderDestination({
  choice,
  selected,
  onMove,
}: {
  choice: FolderChoice;
  selected: boolean;
  onMove: (target: string | null) => void;
}) {
  const select = useCallback(() => onMove(choice.id), [choice.id, onMove]);
  return (
    <ContextMenuItem selected={selected} disabled={selected} onSelect={select}>
      {choice.path}
    </ContextMenuItem>
  );
}

interface FolderBranchProps {
  id: string;
  depth: number;
  label: string;
  expanded: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: FolderTreeProps["onChange"];
  onName: FolderTreeProps["onName"];
  conversations: ReactNode;
}

function FolderBranch({
  id,
  depth,
  label,
  expanded,
  canMoveUp,
  canMoveDown,
  onChange,
  onName,
  conversations,
}: FolderBranchProps) {
  const { t } = useTranslation();
  const toggle = useCallback(() => onChange({ kind: "toggle", id }), [id, onChange]);
  const addChild = useCallback(() => onName({ kind: "create", parentId: id }), [id, onName]);
  const rename = useCallback(
    () => onName({ kind: "folder", id, name: label }),
    [id, label, onName],
  );
  const moveUp = useCallback(
    () => onChange({ kind: "reorder", id, direction: -1 }),
    [id, onChange],
  );
  const moveDown = useCallback(
    () => onChange({ kind: "reorder", id, direction: 1 }),
    [id, onChange],
  );
  const remove = useCallback(() => onChange({ kind: "remove", id }), [id, onChange]);

  return (
    <>
      <ConversationFolderRow
        icon={Folder}
        label={label}
        expanded={expanded}
        depth={depth}
        testID={`sidebar-conversation-folder-${id}`}
        onPress={toggle}
        menu={
          <>
            <ContextMenuItem onSelect={addChild}>
              {t("sidebar.conversationFolders.createChild")}
            </ContextMenuItem>
            <ContextMenuItem onSelect={rename}>
              {t("sidebar.conversationFolders.renameFolder")}
            </ContextMenuItem>
            <ContextMenuItem disabled={!canMoveUp} onSelect={moveUp}>
              {t("sidebar.conversationFolders.moveUp")}
            </ContextMenuItem>
            <ContextMenuItem disabled={!canMoveDown} onSelect={moveDown}>
              {t("sidebar.conversationFolders.moveDown")}
            </ContextMenuItem>
            <ContextMenuItem
              destructive
              description={t("sidebar.conversationFolders.removeDescription")}
              onSelect={remove}
            >
              {t("sidebar.conversationFolders.remove")}
            </ContextMenuItem>
          </>
        }
      />
      {conversations}
    </>
  );
}
