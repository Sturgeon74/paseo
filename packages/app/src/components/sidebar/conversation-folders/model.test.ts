import { describe, expect, it } from "vitest";
import {
  applyFolderAction,
  conversationProjectKey,
  emptyProjectFolders,
  groupConversations,
  selectWorkspaceSidebarTitle,
  placeFolders,
  selectProjectConversations,
  selectWorkspaceFolderTargets,
  workspaceFolderId,
  folderDropAction,
  type FolderAction,
} from "./model";

function organize(...actions: FolderAction[]) {
  return actions.reduce(applyFolderAction, emptyProjectFolders);
}

describe("conversation folders", () => {
  it("keeps agent titles intact when conversations move between folders and back to root", () => {
    const folders = organize(
      { kind: "create", id: "a", parentId: null, name: "A" },
      { kind: "create", id: "b", parentId: null, name: "B" },
    );
    const agent = { id: "session", title: "Prompt title", provider: "codex" };
    const move = (state: typeof folders, folderId: string | null) =>
      applyFolderAction(state, { kind: "move", agentId: agent.id, folderId });
    const titleIn = (state: typeof folders, folderId: string | null) =>
      groupConversations([agent], state.assignments, placeFolders(state.folders)).get(folderId)?.[0]
        ?.title;

    const inA = move(folders, "a");
    const inB = move(inA, "b");
    const atRoot = move(inB, null);
    expect(titleIn(inA, "a")).toBe("Prompt title");
    expect(titleIn(inB, "b")).toBe("Prompt title");
    expect(titleIn(atRoot, null)).toBe("Prompt title");

    const renamed = { ...agent, title: "Manual title" };
    expect(
      groupConversations([renamed], inA.assignments, placeFolders(inA.folders)).get("a"),
    ).toEqual([renamed]);
    expect(folders.assignments).toEqual({});
  });

  it("offers workspace filing when there is no active session and retains it when a session appears", () => {
    const workspace = { id: "workspace", name: "F03 review" };
    const folders = organize({ kind: "create", id: "f03", name: "F03", parentId: null });
    const archived = {
      id: "old",
      workspaceId: workspace.id,
      title: "Review",
      provider: "codex",
      archivedAt: new Date(0),
      parentAgentId: null,
    };
    const target = [{ kind: "workspace", id: workspace.id, title: workspace.name }];
    expect(selectWorkspaceFolderTargets({ workspace, agents: [archived], folders })).toEqual(
      target,
    );
    const filed = applyFolderAction(folders, folderDropAction("workspace", workspace.id, "f03"));
    expect(workspaceFolderId(filed, workspace.id)).toBe("f03");
    const active = { ...archived, id: "new", archivedAt: null };
    expect(selectWorkspaceFolderTargets({ workspace, agents: [active], folders: filed })).toEqual(
      target,
    );
    expect(
      selectProjectConversations({
        agents: [active],
        visibleWorkspaces: new Map([["host:workspace", { projectViewKey: "project" }]]),
        projectViewKey: "project",
        serverId: "host",
        workspaceAssignments: filed.workspaceAssignments,
      }),
    ).toEqual([]);
    expect(selectWorkspaceFolderTargets({ workspace, agents: [active], folders })).toEqual([
      { kind: "agent", id: "new", title: "Review" },
    ]);
  });

  it("creates and files an empty workspace and explicitly returns it to the project root", () => {
    const state = organize({
      kind: "create",
      id: "f03",
      name: "F03",
      parentId: null,
      workspaceId: "empty",
    });
    expect(state.workspaceAssignments).toEqual({ empty: "f03" });
    expect(
      applyFolderAction(state, {
        kind: "moveWorkspace",
        workspaceId: "empty",
        folderId: "missing",
      }),
    ).toBe(state);
    const root = applyFolderAction(state, {
      kind: "moveWorkspace",
      workspaceId: "empty",
      folderId: null,
    });
    expect(root.workspaceAssignments).toEqual({ empty: null });
    expect(workspaceFolderId(root, "empty")).toBeNull();
    expect(workspaceFolderId(root, "other")).toBeUndefined();
    expect(applyFolderAction(state, { kind: "remove", id: "f03" }).workspaceAssignments).toEqual({
      empty: null,
    });
  });

  it("creates a folder and files a conversation in one change", () => {
    const state = organize({
      kind: "create",
      id: "one",
      parentId: null,
      name: "Work",
      agentId: "chat",
      color: "teal",
    });
    expect(state.assignments).toEqual({ chat: "one" });
    expect(state.folders[0]?.color).toBe("teal");
  });

  it("moves folders within a project and refuses cycles and missing destinations", () => {
    const state = organize(
      { kind: "create", id: "one", parentId: null, name: "One" },
      { kind: "create", id: "two", parentId: "one", name: "Two" },
      { kind: "create", id: "three", parentId: null, name: "Three" },
    );
    expect(applyFolderAction(state, { kind: "reparent", id: "one", parentId: "two" })).toBe(state);
    expect(applyFolderAction(state, { kind: "reparent", id: "one", parentId: "missing" })).toBe(
      state,
    );
    const moved = applyFolderAction(state, { kind: "reparent", id: "two", parentId: "three" });
    expect(moved.folders.find((folder) => folder.id === "two")?.parentId).toBe("three");
  });
  it("allows duplicate names while targeting opaque IDs and reorders only siblings", () => {
    const state = organize(
      { kind: "create", id: "first", parentId: null, name: "Review" },
      { kind: "create", id: "child", parentId: "first", name: "Review" },
      { kind: "create", id: "second", parentId: null, name: "Review" },
      { kind: "reorder", id: "second", direction: -1 },
      { kind: "rename", id: "child", name: " Acceptance " },
      { kind: "toggle", id: "first" },
    );

    expect(
      placeFolders(state.folders).map(({ folder, path, depth, visible }) => ({
        id: folder.id,
        path,
        depth,
        visible,
      })),
    ).toEqual([
      { id: "second", path: "Review (1)", depth: 0, visible: true },
      { id: "first", path: "Review (2)", depth: 0, visible: true },
      { id: "child", path: "Review (2) / Acceptance", depth: 1, visible: false },
    ]);
  });

  it("unfiles direct members and promotes subfolders without touching their assignments", () => {
    const state = organize(
      { kind: "create", id: "root", parentId: null, name: "Root" },
      { kind: "create", id: "child", parentId: "root", name: "Child" },
      { kind: "move", agentId: "one", folderId: "root" },
      { kind: "move", agentId: "two", folderId: "child" },
      { kind: "remove", id: "root" },
    );
    expect(state.assignments).toEqual({ two: "child" });
    expect(state.folders).toEqual([
      { id: "child", name: "Child", parentId: null, collapsed: false },
    ]);
  });

  it("keeps unassigned and stale assignments accessible without showing missing agents", () => {
    const state = organize({ kind: "create", id: "root", parentId: null, name: "Root" });
    const groups = groupConversations(
      [{ id: "legacy" }, { id: "stale" }, { id: "filed" }, { id: "cyclic" }],
      { stale: "gone", filed: "root", deletedAgent: "root", cyclic: "cycle" },
      placeFolders([
        ...state.folders,
        { id: "orphan", parentId: "gone", name: "Orphan", collapsed: false },
        { id: "cycle", parentId: "cycle", name: "Cycle", collapsed: false },
      ]),
    );
    expect(groups.get("root")).toEqual([{ id: "filed" }]);
    expect(groups.get(null)).toEqual([{ id: "legacy" }, { id: "stale" }, { id: "cyclic" }]);
    expect(groups.has("cycle")).toBe(false);
  });

  it("sorts conversations and leaves archived, subagent and missing project sessions to their native views", () => {
    const base = {
      provider: "codex",
      workspaceId: "workspace",
      archivedAt: null,
      parentAgentId: null,
    };
    const visibleWorkspaces = new Map([
      ["host:workspace", { projectViewKey: "project" }],
      ["host:other", { projectViewKey: "other" }],
    ]);
    const agents = [
      { ...base, id: "b", title: "Review" },
      { ...base, id: "a", title: "Build" },
      { ...base, id: "archive", title: "Archived", archivedAt: new Date(0) },
      { ...base, id: "child", title: "Child", parentAgentId: "a" },
      { ...base, id: "stale", title: "Stale", workspaceId: "missing" },
      { ...base, id: "different", title: "Different project", workspaceId: "other" },
    ];
    const input = { agents, visibleWorkspaces, projectViewKey: "project", serverId: "host" };
    const visible = selectProjectConversations(input);
    expect(visible.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(visible.map(({ title }) => title)).toEqual(["Build", "Review"]);
    expect(selectProjectConversations({ ...input, serverId: "missing-host" })).toEqual([]);
  });

  it("allows arbitrarily nested folders and rejects moves to a missing folder", () => {
    const folders = Array.from({ length: 30 }, (_, index) => ({
      id: String(index),
      parentId: index === 0 ? null : String(index - 1),
      name: "Task",
      collapsed: false,
    }));
    const state = { ...emptyProjectFolders, folders };
    expect(placeFolders(folders).at(-1)?.depth).toBe(29);
    expect(applyFolderAction(state, { kind: "move", agentId: "one", folderId: "missing" })).toBe(
      state,
    );
    expect(conversationProjectKey("a:b", "c")).not.toBe(conversationProjectKey("a", "b:c"));
  });
});

describe("selectWorkspaceSidebarTitle", () => {
  it("uses a sole session's title at the project root", () => {
    expect(
      selectWorkspaceSidebarTitle("Workspace title", [
        { kind: "agent", id: "agent", title: "Session title" },
      ]),
    ).toBe("Session title");
  });

  it("keeps the workspace title when the row represents a workspace", () => {
    expect(
      selectWorkspaceSidebarTitle("Workspace title", [
        { kind: "workspace", id: "workspace", title: "Workspace title" },
      ]),
    ).toBe("Workspace title");
  });
});
