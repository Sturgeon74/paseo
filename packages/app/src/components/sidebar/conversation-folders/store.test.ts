import { describe, expect, it, vi } from "vitest";
import { conversationProjectKey } from "./model";
import { createConversationFolderStore } from "./store";

const projectKey = conversationProjectKey("host", "project");

function memoryStorage(initial: string | null = null) {
  let raw = initial;
  return {
    getItem: vi.fn(async () => raw),
    setItem: vi.fn(async (_key: string, value: string) => {
      raw = value;
    }),
  };
}

describe("conversation folder persistence", () => {
  it("restores hierarchy, membership, order, and collapse in a fresh store", async () => {
    const storage = memoryStorage();
    const first = createConversationFolderStore(storage);
    await first.load();
    const otherKey = conversationProjectKey("other-host", "project");
    await Promise.all([
      first.change(projectKey, { kind: "create", id: "root", parentId: null, name: "Feature" }),
      first.change(otherKey, { kind: "create", id: "elsewhere", parentId: null, name: "Feature" }),
      first.change(projectKey, { kind: "create", id: "child", parentId: "root", name: "Task" }),
      first.change(projectKey, { kind: "move", agentId: "chat", folderId: "child" }),
      first.change(projectKey, { kind: "toggle", id: "root" }),
      first.change(projectKey, { kind: "toggle", id: null }),
    ]);

    const restarted = createConversationFolderStore(storage);
    await restarted.load();
    expect(restarted.useStore.getState()).toEqual({
      status: "ready",
      organization: {
        version: 1,
        projects: {
          [projectKey]: {
            folders: [
              { id: "root", parentId: null, name: "Feature", collapsed: true },
              { id: "child", parentId: "root", name: "Task", collapsed: false },
            ],
            assignments: { chat: "child" },
            unfiledCollapsed: false,
          },
          [otherKey]: {
            folders: [{ id: "elsewhere", parentId: null, name: "Feature", collapsed: false }],
            assignments: {},
            unfiledCollapsed: true,
          },
        },
      },
    });
  });

  it("leaves newer metadata untouched and allows retry after a write fails", async () => {
    const create = { kind: "create", id: "root", parentId: null, name: "Feature" } as const;
    const future = memoryStorage('{"version":2,"projects":{}}');
    const incompatible = createConversationFolderStore(future);
    await incompatible.load();
    expect(incompatible.useStore.getState().status).toBe("unavailable");
    await expect(incompatible.change(projectKey, create)).rejects.toThrow();
    expect(future.setItem).not.toHaveBeenCalled();

    const storage = memoryStorage();
    const store = createConversationFolderStore(storage);
    await store.load();
    storage.setItem.mockRejectedValueOnce(new Error("disk full"));
    await expect(store.change(projectKey, create)).rejects.toThrow("disk full");
    expect(store.useStore.getState().organization.projects).toEqual({});
    await store.change(projectKey, create);
    expect(store.useStore.getState().organization.projects[projectKey]?.folders[0]?.id).toBe(
      "root",
    );
  });
});
