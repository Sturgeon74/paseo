import { expect, test } from "vitest";
import { applyFolderAction, emptyProjectFolders, ProjectFoldersSchema } from "./conversation-folders.js";

test("new folders record their creation time while legacy folder records remain valid", () => {
  const created = applyFolderAction(emptyProjectFolders, {
    kind: "create", id: "new", parentId: null, name: "Newest",
  });
  expect(Date.parse(created.folders[0]!.createdAt!)).not.toBeNaN();
  expect(ProjectFoldersSchema.parse({
    folders: [{ id: "legacy", parentId: null, name: "Old", collapsed: false }],
    assignments: {}, unfiledCollapsed: true,
  }).folders[0]?.createdAt).toBeUndefined();
});
