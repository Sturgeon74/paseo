import { z } from "zod";
import type { Agent } from "@/stores/session-store";
import { IDENTITY_COLOR_NAMES } from "@/styles/identity-colors";

const folderSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  name: z.string().trim().min(1).max(100),
  collapsed: z.boolean(),
  color: z.enum(IDENTITY_COLOR_NAMES).optional(),
});

const projectSchema = z.object({
  folders: z.array(folderSchema),
  assignments: z.record(z.string(), z.string()),
  unfiledCollapsed: z.boolean(),
});

export const organizationSchema = z.object({
  version: z.literal(1),
  projects: z.record(z.string(), projectSchema),
});

export type ConversationFolder = z.infer<typeof folderSchema>;
export type ProjectFolders = z.infer<typeof projectSchema>;
export type ConversationOrganization = z.infer<typeof organizationSchema>;

export const emptyProjectFolders: ProjectFolders = {
  folders: [],
  assignments: {},
  unfiledCollapsed: true,
};

export type FolderAction =
  | {
      kind: "create";
      id: string;
      parentId: string | null;
      name: string;
      color?: ConversationFolder["color"];
      agentId?: string;
    }
  | { kind: "rename"; id: string; name: string }
  | { kind: "color"; id: string; color: NonNullable<ConversationFolder["color"]> }
  | { kind: "reparent"; id: string; parentId: string | null }
  | { kind: "toggle"; id: string | null }
  | { kind: "reorder"; id: string; direction: -1 | 1 }
  | { kind: "remove"; id: string }
  | { kind: "move"; agentId: string; folderId: string | null };

export function conversationProjectKey(serverId: string, projectId: string): string {
  return JSON.stringify([serverId, projectId]);
}

function reparentFolder(
  state: ProjectFolders,
  current: ConversationFolder,
  index: number,
  destination: string | null,
): ProjectFolders {
  if (destination === current.parentId) return state;
  const folders = [...state.folders];
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let parentId = destination;
  const visited = new Set<string>();
  while (parentId !== null) {
    if (parentId === current.id || visited.has(parentId)) return state;
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) return state;
    parentId = parent.parentId;
  }
  folders[index] = { ...current, parentId: destination };
  const targetIndex = folders.findIndex((folder) => folder.id === destination);
  const target = folders[targetIndex];
  if (target) folders[targetIndex] = { ...target, collapsed: false };
  return { ...state, folders };
}

function moveConversation(
  state: ProjectFolders,
  action: Extract<FolderAction, { kind: "move" }>,
): ProjectFolders {
  if (action.folderId !== null && !state.folders.some((folder) => folder.id === action.folderId)) {
    return state;
  }
  const assignments = { ...state.assignments };
  if (action.folderId === null) {
    delete assignments[action.agentId];
    return { ...state, assignments };
  }
  return {
    ...state,
    folders: state.folders.map((folder) => {
      if (folder.id === action.folderId) return { ...folder, collapsed: false };
      return folder;
    }),
    assignments: { ...assignments, [action.agentId]: action.folderId },
  };
}

export function applyFolderAction(state: ProjectFolders, action: FolderAction): ProjectFolders {
  if (action.kind === "move") return moveConversation(state, action);

  if (action.kind === "create") {
    const folder = folderSchema.parse({ ...action, collapsed: false });
    if (state.folders.some(({ id }) => id === folder.id)) return state;
    if (folder.parentId !== null && !state.folders.some(({ id }) => id === folder.parentId)) {
      return state;
    }
    const folders = state.folders.map((item) =>
      item.id === folder.parentId ? { ...item, collapsed: false } : item,
    );
    return {
      ...state,
      folders: [...folders, folder],
      assignments: action.agentId
        ? { ...state.assignments, [action.agentId]: folder.id }
        : state.assignments,
    };
  }

  if (action.kind === "toggle" && action.id === null) {
    return { ...state, unfiledCollapsed: !state.unfiledCollapsed };
  }

  const index = state.folders.findIndex((folder) => folder.id === action.id);
  const current = state.folders[index];
  if (!current) return state;
  const folders = [...state.folders];

  switch (action.kind) {
    case "color":
      folders[index] = folderSchema.parse({ ...current, color: action.color });
      return { ...state, folders };
    case "reparent":
      return reparentFolder(state, current, index, action.parentId);
    case "rename":
      folders[index] = folderSchema.parse({ ...current, name: action.name });
      return { ...state, folders };
    case "toggle":
      folders[index] = { ...current, collapsed: !current.collapsed };
      return { ...state, folders };
    case "reorder": {
      const siblingIndices = folders.flatMap((folder, position) =>
        folder.parentId === current.parentId ? [position] : [],
      );
      const targetIndex = siblingIndices[siblingIndices.indexOf(index) + action.direction];
      if (targetIndex === undefined) return state;
      const sibling = folders[targetIndex];
      if (!sibling) return state;
      folders[index] = sibling;
      folders[targetIndex] = current;
      return { ...state, folders };
    }
    case "remove": {
      folders.splice(index, 1);
      const assignments = Object.fromEntries(
        Object.entries(state.assignments).filter(([, folderId]) => folderId !== current.id),
      );
      for (const [position, folder] of folders.entries()) {
        if (folder.parentId === current.id) {
          folders[position] = { ...folder, parentId: current.parentId };
        }
      }
      return { ...state, assignments, folders };
    }
  }
}

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

interface ProjectConversationInput<T> {
  agents: Iterable<T>;
  visibleWorkspaces: ReadonlyMap<string, { projectViewKey: string }>;
  projectViewKey: string;
  serverId: string;
}

export function selectProjectConversations<
  T extends Pick<
    Agent,
    "id" | "workspaceId" | "archivedAt" | "parentAgentId" | "title" | "provider"
  >,
>({ agents, visibleWorkspaces, projectViewKey, serverId }: ProjectConversationInput<T>): T[] {
  const result: T[] = [];
  for (const agent of agents) {
    if (!agent.workspaceId || agent.archivedAt || agent.parentAgentId) continue;
    const workspace = visibleWorkspaces.get(`${serverId}:${agent.workspaceId}`);
    if (workspace?.projectViewKey === projectViewKey) result.push(agent);
  }
  return result.sort(
    (left, right) =>
      (left.title || left.provider).localeCompare(right.title || right.provider) ||
      left.id.localeCompare(right.id),
  );
}
