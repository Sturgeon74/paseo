import { useCallback, type DragEvent } from "react";
import type { FolderDragContainerProps } from "./drag-container";

const dragType = "application/x-paseo-conversation-folder";

export function FolderDragContainer({
  children,
  projectKey,
  itemKind,
  itemId,
  onDropItem,
}: FolderDragContainerProps) {
  const onDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!itemKind || !itemId) return;
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(
        dragType,
        JSON.stringify({ projectKey, kind: itemKind, id: itemId }),
      );
    },
    [itemKind, itemId, projectKey],
  );
  const onDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (onDropItem && event.dataTransfer.types.includes(dragType)) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
      }
    },
    [onDropItem],
  );
  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!onDropItem) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        const data: unknown = JSON.parse(event.dataTransfer.getData(dragType));
        if (typeof data !== "object" || data === null) return;
        const value = data as { projectKey?: unknown; kind?: unknown; id?: unknown };
        if (
          value.projectKey === projectKey &&
          (value.kind === "agent" || value.kind === "folder") &&
          typeof value.id === "string"
        ) {
          onDropItem({ kind: value.kind, id: value.id });
        }
      } catch {
        /* Ignore unrelated drag data. */
      }
    },
    [onDropItem, projectKey],
  );
  return (
    <div
      draggable={Boolean(itemKind && itemId)}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}
    </div>
  );
}
