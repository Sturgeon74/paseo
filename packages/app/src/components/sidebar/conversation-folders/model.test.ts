import { describe, expect, it } from "vitest";
import {
  applyFolderAction,
  conversationProjectKey,
  emptyProjectFolders,
  groupConversations,
  placeFolders,
  selectProjectConversations,
  type FolderAction,
} from "./model";

function organize(...actions: FolderAction[]) {
  return actions.reduce(applyFolderAction, emptyProjectFolders);
}

describe("conversation folders", () => {
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
    expect(selectProjectConversations(input).map(({ id }) => id)).toEqual(["a", "b"]);
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
