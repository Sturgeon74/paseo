import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { isWeb } from "@/constants/platform";
import {
  applyFolderAction,
  emptyProjectFolders,
  organizationSchema,
  type ConversationOrganization,
  type FolderAction,
} from "./model";

const storageKey = "sidebar-conversation-folders";
type FolderStorage = Pick<typeof AsyncStorage, "getItem" | "setItem">;

interface FolderStoreState {
  status: "loading" | "ready" | "unavailable";
  organization: ConversationOrganization;
}

export function createConversationFolderStore(storage: FolderStorage) {
  const useStore = create<FolderStoreState>(() => ({
    status: "loading",
    organization: { version: 1, projects: {} },
  }));
  let pending: Promise<void> = Promise.resolve();
  let loading: Promise<void> | null = null;

  async function read(): Promise<ConversationOrganization> {
    const raw = await storage.getItem(storageKey);
    return raw === null ? { version: 1, projects: {} } : organizationSchema.parse(JSON.parse(raw));
  }

  function load(): Promise<void> {
    loading ??= read().then(
      (organization) => useStore.setState({ status: "ready", organization }),
      () => useStore.setState({ status: "unavailable" }),
    );
    return loading;
  }

  function change(projectKey: string, action: FolderAction): Promise<void> {
    const save = async () => {
      // Read inside the lock so a second desktop window cannot overwrite unrelated edits.
      const latest = await read();
      const current = latest.projects[projectKey] ?? emptyProjectFolders;
      const next = applyFolderAction(current, action);
      if (next === current) throw new Error("Conversation folder changed before the edit");
      const organization = { ...latest, projects: { ...latest.projects, [projectKey]: next } };
      await storage.setItem(storageKey, JSON.stringify(organization));
      useStore.setState({ status: "ready", organization });
    };

    const operation = pending.then(() =>
      isWeb && typeof navigator !== "undefined" && navigator.locks
        ? navigator.locks.request(storageKey, save)
        : save(),
    );
    pending = operation.catch(() => {});
    return operation;
  }

  if (isWeb && typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key !== storageKey) return;
      // Serialize refreshes with local writes. A queued refresh always rereads the latest value.
      pending = pending.then(refresh);
    });

    async function refresh() {
      try {
        useStore.setState({ status: "ready", organization: await read() });
      } catch {
        useStore.setState({ status: "unavailable" });
      }
    }
  }

  return { useStore, load, change };
}

export const conversationFolderStore = createConversationFolderStore(AsyncStorage);
