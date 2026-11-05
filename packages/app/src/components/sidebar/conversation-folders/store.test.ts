import { describe, expect, it, vi } from "vitest";
import {
  applyFolderAction,
  emptyProjectFolders,
  mergeFolderImport,
  type FolderCommand,
  type ProjectFolders,
} from "@getpaseo/protocol/conversation-folders";
import { conversationProjectKey } from "./model";
import { createConversationFolderStore, type FolderHostRuntime } from "./store";

vi.mock("./host-runtime", () => ({
  folderHostRuntime: { snapshot: () => new Map(), subscribe: () => () => {} },
}));
const key = conversationProjectKey("host", "project");
const storageKey = "sidebar-conversation-folders";
function memoryStorage(sourceId: string, initial: string | null = null) {
  const values = new Map([[`${storageKey}-host-import-id`, sourceId]]);
  if (initial !== null) values.set(storageKey, initial);
  return {
    values,
    getItem: vi.fn(async (name: string) => values.get(name) ?? null),
    setItem: vi.fn(async (name: string, value: string) => {
      values.set(name, value);
    }),
  };
}
function sharedHost() {
  let state: ProjectFolders | undefined;
  let projects = new Map<string, { conversationFolders?: ProjectFolders }>([["project", {}]]);
  const listeners = new Set<() => void>();
  const receipts = new Set<string>();
  let supported = true;
  let workspaceSupported = true;
  let connected = true;
  const publish = (next: ProjectFolders) => {
    state = next;
    projects = new Map([["project", { conversationFolders: next }]]);
    for (const listener of listeners) listener();
  };
  const change = vi.fn(async (_id: string, command: FolderCommand) => {
    const current = state ?? emptyProjectFolders;
    if (command.kind === "import" && receipts.has(command.sourceId)) return current;
    const next =
      command.kind === "import"
        ? mergeFolderImport(current, command.state)
        : applyFolderAction(current, command);
    if (command.kind === "import") receipts.add(command.sourceId);
    const updated = { ...next, revision: (current.revision ?? 0) + 1 };
    publish(updated);
    return updated;
  });
  const runtime: FolderHostRuntime = {
    snapshot: () =>
      new Map([
        ["host", { connected, supported, workspaceSupported, generation: 1, projects, change }],
      ]),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    runtime,
    change,
    publish,
    unsupported: () => {
      supported = false;
    },
    unsupportedWorkspaces: () => {
      workspaceSupported = false;
    },
    disconnect: (clearProjects = false) => {
      connected = false;
      if (clearProjects) projects = new Map();
      for (const listener of listeners) listener();
    },
    reconnect: () => {
      connected = true;
      projects = new Map([["project", state ? { conversationFolders: state } : {}]]);
      for (const listener of listeners) listener();
    },
  };
}
function legacyState() {
  let state = applyFolderAction(emptyProjectFolders, {
    kind: "create",
    id: "f03",
    parentId: null,
    name: "F03",
    color: "sky",
  });
  state = applyFolderAction(state, {
    kind: "create",
    id: "child",
    parentId: "f03",
    name: "Review",
  });
  state = applyFolderAction(state, { kind: "move", agentId: "chat", folderId: "child" });
  return state;
}
function legacyJson() {
  return JSON.stringify({ version: 1, projects: { [key]: legacyState() } });
}

describe("shared conversation folders", () => {
  it("shares empty workspace filing across clients and reopening, and gates older hosts", async () => {
    const host = sharedHost();
    const mac = createConversationFolderStore(memoryStorage("mac"), host.runtime);
    const ipadStorage = memoryStorage("ipad");
    const ipad = createConversationFolderStore(ipadStorage, host.runtime);
    await Promise.all([mac.load(), ipad.load()]);
    await mac.change(key, { kind: "create", id: "f03", parentId: null, name: "F03" });
    await ipad.change(key, { kind: "moveWorkspace", workspaceId: "empty", folderId: "f03" });
    expect(mac.useStore.getState().organization.projects[key]?.workspaceAssignments).toEqual({
      empty: "f03",
    });
    ipad.dispose();
    const reopened = createConversationFolderStore(ipadStorage, host.runtime);
    await reopened.load();
    expect(reopened.useStore.getState().organization.projects[key]?.workspaceAssignments).toEqual({
      empty: "f03",
    });
    host.unsupportedWorkspaces();
    const calls = host.change.mock.calls.length;
    await expect(
      reopened.change(key, { kind: "moveWorkspace", workspaceId: "empty", folderId: null }),
    ).rejects.toThrow("Update this host");
    expect(host.change.mock.calls).toHaveLength(calls);
    mac.dispose();
    reopened.dispose();
  });
  it("imports the Mac hierarchy into an already connected empty iPad and shares edits in both directions", async () => {
    const host = sharedHost();
    const macStorage = memoryStorage("mac", legacyJson());
    const ipad = createConversationFolderStore(memoryStorage("ipad"), host.runtime);
    await ipad.load();
    expect(host.change).not.toHaveBeenCalled();
    const mac = createConversationFolderStore(macStorage, host.runtime);
    await mac.load();
    await vi.waitFor(() =>
      expect(ipad.useStore.getState().organization.projects[key]?.assignments).toEqual({
        chat: "child",
      }),
    );
    expect(ipad.useStore.getState().organization.projects[key]?.folders).toEqual(
      legacyState().folders,
    );
    await ipad.change(key, { kind: "rename", id: "f03", name: "Feature 03" });
    expect(mac.useStore.getState().organization.projects[key]?.folders[0]?.name).toBe("Feature 03");
    await mac.change(key, { kind: "move", agentId: "second", folderId: "f03" });
    expect(ipad.useStore.getState().organization.projects[key]?.assignments.second).toBe("f03");
    const reopened = createConversationFolderStore(memoryStorage("fresh-ipad"), host.runtime);
    await reopened.load();
    expect(reopened.useStore.getState().organization).toEqual(
      ipad.useStore.getState().organization,
    );
    expect(macStorage.values.get(storageKey)).toBe(legacyJson());
  });

  it("does not resurrect deleted folders when the Mac reopens with its retained legacy backup", async () => {
    const host = sharedHost();
    const storage = memoryStorage("mac", legacyJson());
    const mac = createConversationFolderStore(storage, host.runtime);
    await mac.load();
    await mac.change(key, { kind: "remove", id: "child" });
    mac.dispose();
    const reopened = createConversationFolderStore(storage, host.runtime);
    await reopened.load();
    await vi.waitFor(() => expect(host.change).toHaveBeenCalledTimes(3));
    expect(
      reopened.useStore.getState().organization.projects[key]?.folders.map(({ id }) => id),
    ).toEqual(["f03"]);
    expect(reopened.useStore.getState().organization.projects[key]?.assignments).toEqual({});
  });

  it("ignores an older directory update that arrives after an edit response", async () => {
    const host = sharedHost();
    const store = createConversationFolderStore(memoryStorage("ipad"), host.runtime);
    await store.load();
    await store.change(key, { kind: "create", id: "folder", parentId: null, name: "Current" });
    host.publish({ ...emptyProjectFolders, revision: 0 });
    expect(store.useStore.getState().organization.projects[key]?.folders[0]?.name).toBe("Current");
  });

  it("preserves local data and explains that an older host must be updated", async () => {
    const host = sharedHost();
    host.unsupported();
    const storage = memoryStorage("mac", legacyJson());
    const store = createConversationFolderStore(storage, host.runtime);
    await store.load();
    await expect(store.change(key, { kind: "remove", id: "f03" })).rejects.toThrow(
      "Update this host",
    );
    expect(host.change).not.toHaveBeenCalled();
    expect(storage.values.get(storageKey)).toBe(legacyJson());
  });

  it("keeps a failed import recoverable and retries it before a subsequent edit", async () => {
    const host = sharedHost();
    host.change.mockRejectedValueOnce(new Error("disk full"));
    const storage = memoryStorage("mac", legacyJson());
    const store = createConversationFolderStore(storage, host.runtime);
    await store.load();
    await vi.waitFor(() => expect(store.useStore.getState().importErrors[key]).toBe("disk full"));
    await store.change(key, { kind: "rename", id: "f03", name: "Recovered" });
    expect(store.useStore.getState().importErrors[key]).toBeUndefined();
    expect(store.useStore.getState().organization.projects[key]?.folders[0]?.name).toBe(
      "Recovered",
    );
    expect(storage.values.get(storageKey)).toBe(legacyJson());
  });

  it("retries an automatic import after reconnecting", async () => {
    const host = sharedHost();
    host.change.mockRejectedValueOnce(new Error("temporary failure"));
    const store = createConversationFolderStore(memoryStorage("mac", legacyJson()), host.runtime);
    await store.load();
    await vi.waitFor(() =>
      expect(store.useStore.getState().importErrors[key]).toBe("temporary failure"),
    );
    host.disconnect(true);
    host.reconnect();
    await vi.waitFor(() => expect(store.useStore.getState().importErrors[key]).toBeUndefined());
    expect(host.change).toHaveBeenCalledTimes(2);
  });

  it("shows cached host folders offline without attempting a mutation", async () => {
    const host = sharedHost();
    host.publish({ ...legacyState(), revision: 7 });
    host.disconnect();
    const store = createConversationFolderStore(memoryStorage("ipad"), host.runtime);
    await store.load();
    expect(store.useStore.getState().organization.projects[key]?.revision).toBe(7);
    expect(host.change).not.toHaveBeenCalled();
  });

  it("leaves an unknown future local format untouched", async () => {
    const host = sharedHost();
    const storage = memoryStorage("mac", '{"version":2,"projects":{}}');
    const store = createConversationFolderStore(storage, host.runtime);
    await store.load();
    expect(store.useStore.getState().status).toBe("unavailable");
    expect(host.change).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
