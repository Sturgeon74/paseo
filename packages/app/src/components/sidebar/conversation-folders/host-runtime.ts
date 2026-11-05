import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { FolderHostRuntime, FolderHostSnapshot } from "./store";

export const folderHostRuntime: FolderHostRuntime = {
  snapshot() {
    const hosts = new Map<string, FolderHostSnapshot>();
    for (const [serverId, session] of Object.entries(useSessionStore.getState().sessions)) {
      const client = session.client;
      hosts.set(serverId, {
        connected: client?.isConnected ?? false,
        supported: session.serverInfo?.features?.conversationFolders === true,
        workspaceSupported: session.serverInfo?.features?.conversationFolderWorkspaces === true,
        generation: session.clientGeneration,
        projects: session.projects,
        change: async (projectId, command) => {
          if (!client) throw new Error("Host is disconnected");
          return client.changeProjectConversationFolders(projectId, command);
        },
      });
    }
    return hosts;
  },
  subscribe(listener) {
    const releaseSession = useSessionStore.subscribe(listener);
    const releaseHost = getHostRuntimeStore().subscribeAll(listener);
    return () => {
      releaseSession();
      releaseHost();
    };
  },
};
