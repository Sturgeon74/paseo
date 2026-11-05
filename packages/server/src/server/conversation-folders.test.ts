import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { expect, test } from "vitest";
import { changeProjectConversationFolders } from "./conversation-folders.js";
import { createPersistedProjectRecord, FileBackedProjectRegistry } from "./workspace-registry.js";
import { writeJsonFileAtomic } from "./atomic-file.js";
import { createTestLogger } from "../test-utils/test-logger.js";

test("failed folder imports do not commit data or import receipts, and can be retried", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-folders-write-"));
  let failWrite = false;
  const registry = new FileBackedProjectRegistry(
    path.join(root, "projects.json"),
    createTestLogger(),
    {
      writeRecords: async (file, records) => {
        if (failWrite) throw new Error("disk full");
        await writeJsonFileAtomic(file, records);
      },
    },
  );
  try {
    await registry.upsert(
      createPersistedProjectRecord({
        projectId: "one",
        rootPath: root,
        kind: "non_git",
        displayName: "One",
        createdAt: "2026-11-05T00:00:00Z",
        updatedAt: "2026-11-05T00:00:00Z",
      }),
    );
    const command = {
      kind: "import",
      sourceId: "mac",
      state: {
        folders: [{ id: "f03", parentId: null, name: "F03", collapsed: false }],
        assignments: { chat: "f03" },
        unfiledCollapsed: true,
      },
    } as const;
    failWrite = true;
    await expect(
      changeProjectConversationFolders(registry, "one", {
        ...command,
        state: { ...command.state, folders: [...command.state.folders] },
      }),
    ).rejects.toThrow("disk full");
    expect((await registry.get("one"))?.conversationFolders).toBeUndefined();
    expect((await registry.get("one"))?.conversationFolderImports).toBeUndefined();
    failWrite = false;
    const result = await changeProjectConversationFolders(registry, "one", {
      ...command,
      state: { ...command.state, folders: [...command.state.folders] },
    });
    expect(result.assignments).toEqual({ chat: "f03" });
    expect((await registry.get("one"))?.conversationFolderImports).toEqual(["mac"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a second device import preserves live host names and assignments while adding its own folders", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-folders-merge-"));
  const registry = new FileBackedProjectRegistry(
    path.join(root, "projects.json"),
    createTestLogger(),
  );
  try {
    await registry.upsert(
      createPersistedProjectRecord({
        projectId: "one",
        rootPath: root,
        kind: "non_git",
        displayName: "One",
        createdAt: "2026-11-05T00:00:00Z",
        updatedAt: "2026-11-05T00:00:00Z",
      }),
    );
    await changeProjectConversationFolders(registry, "one", {
      kind: "import",
      sourceId: "mac",
      state: {
        folders: [{ id: "f03", parentId: null, name: "Mac name", collapsed: false }],
        assignments: { chat: "f03" },
        unfiledCollapsed: false,
      },
    });
    const result = await changeProjectConversationFolders(registry, "one", {
      kind: "import",
      sourceId: "ipad",
      state: {
        folders: [
          { id: "f03", parentId: null, name: "Stale name", collapsed: true },
          { id: "ipad-folder", parentId: "f03", name: "iPad", collapsed: false },
        ],
        assignments: { chat: "ipad-folder", other: "ipad-folder" },
        unfiledCollapsed: true,
      },
    });
    expect(result.folders.map(({ name }) => name)).toEqual(["Mac name", "iPad"]);
    expect(result.assignments).toEqual({ chat: "f03", other: "ipad-folder" });
    expect(result.unfiledCollapsed).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
