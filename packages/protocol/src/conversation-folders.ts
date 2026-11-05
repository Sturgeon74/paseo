import { z } from "zod";
import { WORKSPACE_LABEL_COLORS } from "./workspace-labels.js";

export const ConversationFolderSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  name: z.string().min(1).max(100),
  collapsed: z.boolean(),
  color: z.enum(WORKSPACE_LABEL_COLORS).optional(),
});

export const ProjectFoldersSchema = z.object({
  folders: z.array(ConversationFolderSchema),
  assignments: z.record(z.string(), z.string()),
  workspaceAssignments: z.record(z.string(), z.string().nullable()).optional(),
  unfiledCollapsed: z.boolean(),
  revision: z.number().int().nonnegative().optional(),
});

export const organizationSchema = z.object({
  version: z.literal(1),
  projects: z.record(z.string(), ProjectFoldersSchema),
});

export type ConversationFolder = z.infer<typeof ConversationFolderSchema>;
export type ProjectFolders = z.infer<typeof ProjectFoldersSchema>;
export type ConversationOrganization = z.infer<typeof organizationSchema>;

export const emptyProjectFolders: ProjectFolders = {
  folders: [],
  assignments: {},
  unfiledCollapsed: true,
};

export const FolderActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    id: z.string().min(1),
    parentId: z.string().nullable(),
    name: z.string().min(1).max(100),
    color: z.enum(WORKSPACE_LABEL_COLORS).optional(),
    agentId: z.string().optional(),
    workspaceId: z.string().optional(),
  }),
  z.object({ kind: z.literal("rename"), id: z.string(), name: z.string().min(1).max(100) }),
  z.object({ kind: z.literal("color"), id: z.string(), color: z.enum(WORKSPACE_LABEL_COLORS) }),
  z.object({ kind: z.literal("reparent"), id: z.string(), parentId: z.string().nullable() }),
  z.object({ kind: z.literal("toggle"), id: z.string().nullable() }),
  z.object({
    kind: z.literal("reorder"),
    id: z.string(),
    direction: z.union([z.literal(-1), z.literal(1)]),
  }),
  z.object({ kind: z.literal("remove"), id: z.string() }),
  z.object({ kind: z.literal("move"), agentId: z.string(), folderId: z.string().nullable() }),
  z.object({
    kind: z.literal("moveWorkspace"),
    workspaceId: z.string(),
    folderId: z.string().nullable(),
  }),
]);
export type FolderAction = z.infer<typeof FolderActionSchema>;
export const FolderCommandSchema = z.union([
  FolderActionSchema,
  z.object({
    kind: z.literal("import"),
    sourceId: z.string().min(1).max(100),
    state: ProjectFoldersSchema,
  }),
]);
export type FolderCommand = z.infer<typeof FolderCommandSchema>;

export function mergeFolderImport(
  current: ProjectFolders,
  incoming: ProjectFolders,
): ProjectFolders {
  const existing = new Set(current.folders.map(({ id }) => id));
  return {
    ...current,
    folders: [...current.folders, ...incoming.folders.filter(({ id }) => !existing.has(id))],
    assignments: { ...incoming.assignments, ...current.assignments },
    workspaceAssignments: { ...incoming.workspaceAssignments, ...current.workspaceAssignments },
  };
}

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

function moveWorkspace(
  state: ProjectFolders,
  action: Extract<FolderAction, { kind: "moveWorkspace" }>,
): ProjectFolders {
  if (action.folderId !== null && !state.folders.some(({ id }) => id === action.folderId))
    return state;
  return {
    ...state,
    workspaceAssignments: {
      ...state.workspaceAssignments,
      [action.workspaceId]: action.folderId,
    },
    folders: state.folders.map((folder) =>
      folder.id === action.folderId ? { ...folder, collapsed: false } : folder,
    ),
  };
}

function createFolder(
  state: ProjectFolders,
  action: Extract<FolderAction, { kind: "create" }>,
): ProjectFolders {
  const folder = ConversationFolderSchema.parse({
    ...action,
    name: action.name.trim(),
    collapsed: false,
  });
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
    ...(action.workspaceId
      ? {
          workspaceAssignments: {
            ...state.workspaceAssignments,
            [action.workspaceId]: folder.id,
          },
        }
      : {}),
  };
}

export function applyFolderAction(state: ProjectFolders, action: FolderAction): ProjectFolders {
  if (action.kind === "move") return moveConversation(state, action);
  if (action.kind === "moveWorkspace") return moveWorkspace(state, action);

  if (action.kind === "create") return createFolder(state, action);

  if (action.kind === "toggle" && action.id === null) {
    return { ...state, unfiledCollapsed: !state.unfiledCollapsed };
  }

  const index = state.folders.findIndex((folder) => folder.id === action.id);
  const current = state.folders[index];
  if (!current) return state;
  const folders = [...state.folders];

  switch (action.kind) {
    case "color":
      folders[index] = ConversationFolderSchema.parse({ ...current, color: action.color });
      return { ...state, folders };
    case "reparent":
      return reparentFolder(state, current, index, action.parentId);
    case "rename":
      folders[index] = ConversationFolderSchema.parse({ ...current, name: action.name.trim() });
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
      const workspaceAssignments =
        state.workspaceAssignments &&
        Object.fromEntries(
          Object.entries(state.workspaceAssignments).map(([id, folderId]) => [
            id,
            folderId === current.id ? null : folderId,
          ]),
        );
      return {
        ...state,
        assignments,
        folders,
        ...(workspaceAssignments ? { workspaceAssignments } : {}),
      };
    }
  }
}
