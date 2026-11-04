import { View } from "react-native";
import type { ReactNode } from "react";

export interface FolderDragContainerProps {
  children: ReactNode;
  projectKey: string;
  itemKind?: "agent" | "folder";
  itemId?: string;
  onDropItem?: (item: { kind: "agent" | "folder"; id: string }) => void;
}

export function FolderDragContainer({ children }: FolderDragContainerProps) {
  return <View>{children}</View>;
}
