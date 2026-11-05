import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Folder, MessageSquare } from "lucide-react-native";
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
  deriveIdentityColorName,
  IDENTITY_COLOR_NAMES,
  identityColor,
} from "@/styles/identity-colors";
import {
  conversationProjectKey,
  groupConversations,
  placeFolders,
  selectProjectConversations,
  folderDropAction,
  type FolderAction,
  type ProjectFolders,
} from "./model";
import { ConversationFolderRow } from "./row";
import { conversationFolderStore } from "./store";
import { FolderDragContainer } from "./drag-container";

interface ProjectConversationFoldersProps {
  project: SidebarProjectEntry;
  onOpenConversation?: () => void;
  createRequest?: number;
  onCreateHandled?: () => void;
  renderWorkspaces: (serverId: string, folderId: string, depth: number) => ReactNode;
}

export function ProjectConversationFolders({
  project,
  onOpenConversation,
  createRequest = 0,
  onCreateHandled,
  renderWorkspaces,
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
        createRequest={
          project.hosts[0]?.serverId === serverId && project.hosts[0]?.projectId === projectId
            ? createRequest
            : 0
        }
        onCreateHandled={onCreateHandled}
        onOpenConversation={onOpenConversation}
        renderWorkspaces={renderWorkspaces}
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
  createRequest: number;
  onCreateHandled?: () => void;
  renderWorkspaces: ProjectConversationFoldersProps["renderWorkspaces"];
}

type NameDialog =
  | { kind: "create"; parentId: string | null; agentId?: string }
  | { kind: "folder"; id: string; name: string }
  | { kind: "agent"; id: string; name: string };

function HostProjectFolders({
  projectKey,
  projectViewKey,
  serverId,
  showHost,
  onOpenConversation,
  createRequest,
  onCreateHandled,
  renderWorkspaces,
}: HostProjectFoldersProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const status = conversationFolderStore.useStore((state) => state.status);
  const folders = conversationFolderStore.useStore(
    (state) => state.organization.projects[projectKey],
  );
  const importError = conversationFolderStore.useStore((state) => state.importErrors[projectKey]);
  useEffect(() => {
    if (importError) toast.error(importError);
  }, [importError, toast]);
  const online = useHostRuntimeIsConnected(serverId);
  const [dialog, setDialog] = useState<NameDialog | null>(null);
  const hosts = useHosts();
  const host = showHost ? hosts.find((entry) => entry.serverId === serverId)?.label : undefined;
  const createLabel = t("sidebar.conversationFolders.create");
  const renameFolderLabel = t("sidebar.conversationFolders.renameFolder");
  const renameAgentLabel = t("workspace.tabs.menu.renameAgent");
  useEffect(() => {
    if (createRequest > 0) {
      setDialog({ kind: "create", parentId: null });
      onCreateHandled?.();
    }
  }, [createRequest, onCreateHandled]);

  const change = useCallback(
    (action: FolderAction) => {
      void conversationFolderStore
        .change(projectKey, action)
        .catch((error: unknown) =>
          toast.error(
            error instanceof Error ? error.message : t("sidebar.conversationFolders.saveFailed"),
          ),
        );
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
          ? {
              kind: "create",
              id: crypto.randomUUID(),
              name,
              parentId: dialog.parentId,
              agentId: dialog.agentId,
              color:
                IDENTITY_COLOR_NAMES.find(
                  (color) =>
                    color !== deriveIdentityColorName(projectViewKey) &&
                    !folders?.folders.some((folder) => folder.color === color),
                ) ??
                IDENTITY_COLOR_NAMES.find(
                  (color) => color !== deriveIdentityColorName(projectViewKey),
                ),
            }
          : { kind: "rename", id: dialog.id, name };
      try {
        await conversationFolderStore.change(projectKey, action);
      } catch (error) {
        throw error instanceof Error
          ? error
          : new Error(t("sidebar.conversationFolders.saveFailed"));
      }
    },
    [dialog, folders, projectKey, projectViewKey, serverId, t],
  );

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
          renderWorkspaces={renderWorkspaces}
        />
      ) : null}
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
  renderWorkspaces: ProjectConversationFoldersProps["renderWorkspaces"];
}

function FolderTree({
  folders,
  projectKey,
  projectViewKey,
  serverId,
  online,
  hostLabel: _hostLabel,
  onOpenConversation,
  onChange,
  onName,
  renderWorkspaces,
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
      workspaceAssignments: folders.workspaceAssignments,
    });
    return groupConversations(visible, folders.assignments, placements);
  }, [
    agents,
    workspaceEntriesByKey,
    serverId,
    projectViewKey,
    folders.assignments,
    folders.workspaceAssignments,
    placements,
  ]);

  const unfiledLabel = t("sidebar.conversationFolders.projectRoot");
  const folderChoices = useMemo(
    () => [
      { id: null, path: unfiledLabel },
      ...placements.map(({ folder, path }) => ({ id: folder.id, path })),
    ],
    [unfiledLabel, placements],
  );

  const filedWorkspaces = useMemo(
    () =>
      new Set(
        [...groups.entries()].flatMap(([folderId, entries]) =>
          folderId === null
            ? []
            : entries.flatMap((agent) => (agent.workspaceId ? [agent.workspaceId] : [])),
        ),
      ),
    [groups],
  );

  function renderAgents(folderId: string | null, depth: number, workspaceFilter?: Set<string>) {
    return groups
      .get(folderId)
      ?.filter(
        (agent) =>
          !workspaceFilter || (agent.workspaceId && workspaceFilter.has(agent.workspaceId)),
      )
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
          projectKey={projectKey}
          color={
            folderId
              ? identityColor(
                  placements.find(({ folder }) => folder.id === folderId)?.folder.color ??
                    IDENTITY_COLOR_NAMES.find(
                      (color) => color !== deriveIdentityColorName(projectViewKey),
                    )!,
                )
              : undefined
          }
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
            projectKey={projectKey}
            color={
              folder.color ??
              IDENTITY_COLOR_NAMES.find(
                (color) => color !== deriveIdentityColorName(projectViewKey),
              )!
            }
            folderChoices={folderChoices}
            conversations={
              folder.collapsed ? null : (
                <>
                  {renderAgents(folder.id, depth + 1)}
                  {renderWorkspaces(serverId, folder.id, depth + 1)}
                </>
              )
            }
          />
        ))}
      {renderAgents(null, 0, filedWorkspaces)}
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
  projectKey: string;
  color?: string;
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
  projectKey,
  color,
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
  const createAndMove = useCallback(
    () => onName({ kind: "create", parentId: folderId, agentId: id }),
    [onName, folderId, id],
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
    <FolderDragContainer projectKey={projectKey} itemKind="agent" itemId={id}>
      <ConversationFolderRow
        icon={MessageSquare}
        label={title || provider}
        depth={depth}
        color={color}
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
            <ContextMenuItem onSelect={createAndMove}>
              {t("sidebar.conversationFolders.createAndMove")}
            </ContextMenuItem>
          </>
        }
      />
    </FolderDragContainer>
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
  projectKey: string;
  color: NonNullable<ProjectFolders["folders"][number]["color"]>;
  folderChoices: FolderChoice[];
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
  projectKey,
  color,
  folderChoices,
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
  const onDropItem = useCallback(
    (item: { kind: "folder" | "agent" | "workspace"; id: string }) =>
      onChange(folderDropAction(item.kind, item.id, id)),
    [id, onChange],
  );
  const pages: MenuPageDefinition[] = [
    {
      id: "folder-color",
      title: t("sidebar.conversationFolders.color"),
      content: IDENTITY_COLOR_NAMES.map((name) => (
        <FolderColorItem
          key={name}
          name={name}
          selected={name === color}
          id={id}
          onChange={onChange}
        />
      )),
    },
    {
      id: "folder-move",
      title: t("sidebar.conversationFolders.move"),
      content: folderChoices
        .filter((choice) => choice.id !== id)
        .map((choice) => (
          <FolderParentItem key={choice.id ?? "root"} choice={choice} id={id} onChange={onChange} />
        )),
    },
  ];

  return (
    <>
      <FolderDragContainer
        projectKey={projectKey}
        itemKind="folder"
        itemId={id}
        onDropItem={onDropItem}
      >
        <ConversationFolderRow
          icon={Folder}
          label={label}
          expanded={expanded}
          depth={depth}
          color={identityColor(color)}
          testID={`sidebar-conversation-folder-${id}`}
          onPress={toggle}
          pages={pages}
          menu={
            <>
              <ContextMenuItem onSelect={addChild}>
                {t("sidebar.conversationFolders.createChild")}
              </ContextMenuItem>
              <ContextMenuItem onSelect={rename}>
                {t("sidebar.conversationFolders.renameFolder")}
              </ContextMenuItem>
              <DropdownMenuSubTrigger id="folder-color">
                {t("sidebar.conversationFolders.color")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubTrigger id="folder-move">
                {t("sidebar.conversationFolders.move")}
              </DropdownMenuSubTrigger>
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
      </FolderDragContainer>
      {conversations}
    </>
  );
}

function FolderColorItem({
  name,
  selected,
  id,
  onChange,
}: {
  name: NonNullable<ProjectFolders["folders"][number]["color"]>;
  selected: boolean;
  id: string;
  onChange: FolderTreeProps["onChange"];
}) {
  const { t } = useTranslation();
  const select = useCallback(
    () => onChange({ kind: "color", id, color: name }),
    [id, name, onChange],
  );
  return (
    <ContextMenuItem selected={selected} onSelect={select}>
      {t(`workspaceLabels.colors.${name}`)}
    </ContextMenuItem>
  );
}

function FolderParentItem({
  choice,
  id,
  onChange,
}: {
  choice: FolderChoice;
  id: string;
  onChange: FolderTreeProps["onChange"];
}) {
  const select = useCallback(
    () => onChange({ kind: "reparent", id, parentId: choice.id }),
    [choice.id, id, onChange],
  );
  return <ContextMenuItem onSelect={select}>{choice.path}</ContextMenuItem>;
}
