import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import type { ConversationFolder, ProjectFolders } from "@getpaseo/protocol/conversation-folders";
export {
  applyFolderAction,
  conversationProjectKey,
  emptyProjectFolders,
  organizationSchema,
  type ConversationFolder,
  type ProjectFolders,
  type ConversationOrganization,
  type FolderAction,
} from "@getpaseo/protocol/conversation-folders";

export interface FolderPlacement {
  folder: ConversationFolder;
  depth: number;
  path: string;
  visible: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export function placeFolders(folders: ConversationFolder[]): FolderPlacement[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const children = new Map<string | null, ConversationFolder[]>();
  for (const folder of byId.values()) {
    const parentId = folder.parentId && byId.has(folder.parentId) ? folder.parentId : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(folder);
    children.set(parentId, siblings);
  }

  const result: FolderPlacement[] = [];
  const queue: FolderPlacement[] = [];
  function pushSiblings(siblings: ConversationFolder[], parent?: FolderPlacement) {
    const nameCounts = new Map<string, number>();
    for (const folder of siblings) {
      nameCounts.set(folder.name, (nameCounts.get(folder.name) ?? 0) + 1);
    }
    const occurrence = new Map(nameCounts);
    for (let index = siblings.length - 1; index >= 0; index -= 1) {
      const folder = siblings[index];
      if (!folder) continue;
      const ordinal = occurrence.get(folder.name) ?? 1;
      occurrence.set(folder.name, ordinal - 1);
      const name =
        (nameCounts.get(folder.name) ?? 0) > 1 ? `${folder.name} (${ordinal})` : folder.name;
      queue.push({
        folder,
        depth: parent ? parent.depth + 1 : 0,
        path: parent ? `${parent.path} / ${name}` : name,
        visible: !parent || (parent.visible && !parent.folder.collapsed),
        canMoveUp: index > 0,
        canMoveDown: index < siblings.length - 1,
      });
    }
  }
  pushSiblings(children.get(null) ?? []);
  while (queue.length > 0) {
    const placement = queue.pop();
    if (!placement) break;
    result.push(placement);
    pushSiblings(children.get(placement.folder.id) ?? [], placement);
  }
  // Cycles cannot be created by the UI. Their sessions fall back to Unfiled.
  return result;
}

export function groupConversations<T extends { id: string }>(
  agents: T[],
  assignments: ProjectFolders["assignments"],
  placements: FolderPlacement[],
): Map<string | null, T[]> {
  const folderIds = new Set(placements.map(({ folder }) => folder.id));
  const groups = new Map<string | null, T[]>();
  for (const agent of agents) {
    const assignment = Object.hasOwn(assignments, agent.id) ? assignments[agent.id] : undefined;
    const key = assignment && folderIds.has(assignment) ? assignment : null;
    const group = groups.get(key) ?? [];
    group.push(agent);
    groups.set(key, group);
  }
  return groups;
}

export function runningFolderAncestors(
  folders: ConversationFolder[],
  runningFolderIds: Iterable<string>,
): Set<string> {
  const parents = new Map(folders.map((folder) => [folder.id, folder.parentId]));
  const result = new Set<string>();
  for (const folderId of runningFolderIds) {
    let current: string | null | undefined = folderId;
    while (current && parents.has(current) && !result.has(current)) {
      result.add(current);
      current = parents.get(current);
    }
  }
  return result;
}

// A workspace placement survives its last active session. An explicit root placement
// also prevents an old session assignment from pulling the workspace back into a folder.
export function workspaceFolderId(
  state: ProjectFolders,
  workspaceId: string,
): string | null | undefined {
  if (!state.workspaceAssignments || !Object.hasOwn(state.workspaceAssignments, workspaceId))
    return undefined;
  const folderId = state.workspaceAssignments[workspaceId];
  return placeFolders(state.folders).some(({ folder }) => folder.id === folderId) ? folderId : null;
}

export function folderDropAction(
  kind: "folder" | "agent" | "workspace",
  id: string,
  folderId: string | null,
): import("@getpaseo/protocol/conversation-folders").FolderAction {
  switch (kind) {
    case "folder":
      return { kind: "reparent", id, parentId: folderId };
    case "agent":
      return { kind: "move", agentId: id, folderId };
    case "workspace":
      return { kind: "moveWorkspace", workspaceId: id, folderId };
  }
}

export function selectWorkspaceFolderTargets({
  workspace,
  agents,
  folders,
}: {
  workspace?: Pick<WorkspaceDescriptor, "id" | "name">;
  agents: Iterable<
    Pick<Agent, "id" | "workspaceId" | "archivedAt" | "parentAgentId" | "title" | "provider">
  >;
  folders: ProjectFolders;
}): Array<{ kind: "agent" | "workspace"; id: string; title: string }> {
  if (!workspace) return [];
  const targets = [...agents]
    .filter(
      (agent) => agent.workspaceId === workspace.id && !agent.archivedAt && !agent.parentAgentId,
    )
    .map((agent) => ({
      kind: "agent" as const,
      id: agent.id,
      title: agent.title || agent.provider,
    }));
  if (targets.length > 0 && workspaceFolderId(folders, workspace.id) === undefined) return targets;
  return [{ kind: "workspace", id: workspace.id, title: workspace.name }];
}

export function selectWorkspaceSidebarTitle(
  workspaceTitle: string,
  targets: Array<{ kind: "agent" | "workspace"; id: string; title: string }>,
): string {
  const target = targets[0];
  return targets.length === 1 && target?.kind === "agent" ? target.title : workspaceTitle;
}

interface ProjectConversationInput<T> {
  agents: Iterable<T>;
  visibleWorkspaces: ReadonlyMap<string, { projectViewKey: string }>;
  projectViewKey: string;
  serverId: string;
  workspaceAssignments?: ProjectFolders["workspaceAssignments"];
}

export function selectProjectConversations<
  T extends Pick<
    Agent,
    "id" | "workspaceId" | "archivedAt" | "parentAgentId" | "title" | "provider"
  >,
>({
  agents,
  visibleWorkspaces,
  projectViewKey,
  serverId,
  workspaceAssignments,
}: ProjectConversationInput<T>): T[] {
  const result: T[] = [];
  for (const agent of agents) {
    if (!agent.workspaceId || agent.archivedAt || agent.parentAgentId) continue;
    if (workspaceAssignments && Object.hasOwn(workspaceAssignments, agent.workspaceId)) continue;
    const workspace = visibleWorkspaces.get(`${serverId}:${agent.workspaceId}`);
    if (workspace?.projectViewKey === projectViewKey) result.push(agent);
  }
  return result.sort(
    (left, right) =>
      (left.title || left.provider).localeCompare(right.title || right.provider) ||
      left.id.localeCompare(right.id),
  );
}
