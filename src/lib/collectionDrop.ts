export type CollectionDropEdge = "before" | "after";

export interface CollectionDropTarget {
  edge: CollectionDropEdge;
  beforeId: string | null;
}

/**
 * Resolve a collection drop by movement direction, so the whole target tree is
 * usable instead of requiring a release inside one half of its 30px header.
 */
export function collectionDropTarget(
  order: readonly string[],
  draggedId: string,
  targetId: string,
): CollectionDropTarget | null {
  const draggedIndex = order.indexOf(draggedId);
  const targetIndex = order.indexOf(targetId);
  if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return null;
  if (draggedIndex > targetIndex) return { edge: "before", beforeId: targetId };
  return { edge: "after", beforeId: order[targetIndex + 1] ?? null };
}
