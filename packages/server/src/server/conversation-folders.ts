import {
  applyFolderAction,
  emptyProjectFolders,
  mergeFolderImport,
  type FolderCommand,
  type ProjectFolders,
} from "@getpaseo/protocol/conversation-folders";
import type { ProjectRegistry } from "./workspace-registry.js";

export async function changeProjectConversationFolders(
  registry: ProjectRegistry,
  projectId: string,
  command: FolderCommand,
): Promise<ProjectFolders> {
  const project = await registry.update(projectId, (record) => {
    if (record.archivedAt) throw new Error("Project is archived");
    const current = record.conversationFolders ?? emptyProjectFolders;
    const imports = record.conversationFolderImports ?? [];
    if (command.kind === "import" && imports.includes(command.sourceId)) return record;
    let next: ProjectFolders;
    if (command.kind === "import") {
      next = record.conversationFolders ? mergeFolderImport(current, command.state) : command.state;
    } else {
      next = applyFolderAction(current, command);
    }
    if (next === current) throw new Error("Conversation folder changed before the edit");
    return {
      ...record,
      conversationFolders: { ...next, revision: (current.revision ?? 0) + 1 },
      ...(command.kind === "import"
        ? { conversationFolderImports: [...imports, command.sourceId] }
        : {}),
      updatedAt: new Date().toISOString(),
    };
  });
  if (!project?.conversationFolders) throw new Error("Project not found");
  return project.conversationFolders;
}
