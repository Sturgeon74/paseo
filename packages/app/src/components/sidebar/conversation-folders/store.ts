import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { isWeb } from "@/constants/platform";
import type { FolderCommand } from "@getpaseo/protocol/conversation-folders";
import { folderHostRuntime } from "./host-runtime";
import {
  conversationProjectKey,
  organizationSchema,
  type ConversationOrganization,
  type FolderAction,
  type ProjectFolders,
} from "./model";

const storageKey = "sidebar-conversation-folders";
const importKey = `${storageKey}-host-import-id`;
type FolderStorage = Pick<typeof AsyncStorage, "getItem" | "setItem">;

export interface FolderHostSnapshot {
  connected: boolean;
  supported: boolean;
  workspaceSupported?: boolean;
  generation: number;
  projects: ReadonlyMap<string, { conversationFolders?: ProjectFolders }>;
  change(projectId: string, command: FolderCommand): Promise<ProjectFolders>;
}
export interface FolderHostRuntime {
  snapshot(): ReadonlyMap<string, FolderHostSnapshot>;
  subscribe(listener: () => void): () => void;
}
interface FolderStoreState {
  status: "loading" | "ready" | "unavailable";
  organization: ConversationOrganization;
  importErrors: Readonly<Record<string, string>>;
}
function splitProjectKey(key: string): [string, string] {
  const value: unknown = JSON.parse(key);
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value.some((part) => typeof part !== "string")
  ) {
    throw new Error("Invalid conversation folder project");
  }
  return value as [string, string];
}

export function createConversationFolderStore(storage: FolderStorage, runtime: FolderHostRuntime) {
  const useStore = create<FolderStoreState>(() => ({
    status: "loading",
    organization: { version: 1, projects: {} },
    importErrors: {},
  }));
  let loading: Promise<void> | null = null;
  let pending: Promise<void> = Promise.resolve();
  let legacy: ConversationOrganization = { version: 1, projects: {} };
  let importId = "";
  let release: (() => void) | undefined;
  const imports = new Map<string, Promise<void>>();
  const imported = new Set<string>();
  const attempts = new Map<string, number>();
  const observed = new Map<string, FolderHostSnapshot>();

  function accept(key: string, state: ProjectFolders) {
    const previous = useStore.getState().organization;
    const current = previous.projects[key];
    if (current === state || (current?.revision ?? -1) > (state.revision ?? 0)) return;
    useStore.setState({
      organization: { ...previous, projects: { ...previous.projects, [key]: state } },
    });
  }

  function importLegacy(key: string, host: FolderHostSnapshot): Promise<void> {
    const local = legacy.projects[key];
    if (!local?.folders.length || imported.has(key)) return Promise.resolve();
    const existing = imports.get(key);
    if (existing) return existing;
    const [, projectId] = splitProjectKey(key);
    const operation = host
      .change(projectId, { kind: "import", sourceId: importId, state: local })
      .then((state) => {
        imported.add(key);
        accept(key, state);
        const errors = { ...useStore.getState().importErrors };
        delete errors[key];
        useStore.setState({ importErrors: errors });
        return undefined;
      })
      .finally(() => imports.delete(key));
    imports.set(key, operation);
    return operation;
  }

  function reconcile() {
    for (const [serverId, host] of runtime.snapshot()) {
      const previous = observed.get(serverId);
      if (
        previous?.projects === host.projects &&
        previous.connected === host.connected &&
        previous.supported === host.supported &&
        previous.generation === host.generation
      )
        continue;
      observed.set(serverId, host);
      if (!host.connected) {
        for (const key of attempts.keys()) {
          if (splitProjectKey(key)[0] === serverId) attempts.delete(key);
        }
      }
      // COMPAT(conversationFolders): added in v0.15.0 fork, remove gate after 2027-05-05.
      for (const [projectId, project] of host.projects) {
        const key = conversationProjectKey(serverId, projectId);
        if (project.conversationFolders) accept(key, project.conversationFolders);
        if (!host.connected) {
          attempts.delete(key);
          continue;
        }
        if (!host.supported) continue;
        if (attempts.get(key) === host.generation) continue;
        attempts.set(key, host.generation);
        void importLegacy(key, host).catch((error: unknown) => {
          useStore.setState({
            importErrors: {
              ...useStore.getState().importErrors,
              [key]:
                error instanceof Error ? error.message : "Could not import conversation folders",
            },
          });
        });
      }
    }
  }

  function load(): Promise<void> {
    loading ??= (async () => {
      try {
        const raw = await storage.getItem(storageKey);
        legacy =
          raw === null ? { version: 1, projects: {} } : organizationSchema.parse(JSON.parse(raw));
        // Keep the local snapshot as a recovery copy. Only the import identity is
        // written locally; subsequent folder edits belong to the host.
        const ensureImportId = async () => {
          const stored = await storage.getItem(importKey);
          if (stored) return stored;
          const id = crypto.randomUUID();
          await storage.setItem(importKey, id);
          return id;
        };
        importId =
          isWeb && typeof navigator !== "undefined" && navigator.locks
            ? await navigator.locks.request(importKey, ensureImportId)
            : await ensureImportId();
        useStore.setState({ status: "ready", organization: legacy });
        release = runtime.subscribe(reconcile);
        reconcile();
      } catch {
        useStore.setState({ status: "unavailable" });
      }
    })();
    return loading;
  }

  function change(key: string, action: FolderAction): Promise<void> {
    const operation = pending.then(async () => {
      await load();
      if (useStore.getState().status !== "ready")
        throw new Error("Conversation folders could not be loaded");
      const [serverId, projectId] = splitProjectKey(key);
      const host = runtime.snapshot().get(serverId);
      if (!host?.connected) throw new Error("Host is disconnected");
      if (!host.supported)
        throw new Error("Update this host to share conversation folders between devices");
      // COMPAT(conversationFolderWorkspaces): added in v0.15.0 fork, remove gate after 2027-05-05.
      if (
        (action.kind === "moveWorkspace" || (action.kind === "create" && action.workspaceId)) &&
        !host.workspaceSupported
      )
        throw new Error("Update this host to move workspaces into conversation folders");
      await importLegacy(key, host);
      accept(key, await host.change(projectId, action));
      return undefined;
    });
    pending = operation.catch(() => {});
    return operation;
  }
  return { useStore, load, change, dispose: () => release?.() };
}

export const conversationFolderStore = createConversationFolderStore(
  AsyncStorage,
  folderHostRuntime,
);
