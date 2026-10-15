import type { PerseusDocumentEvent } from "./operational-history";

export type PerseusTimelineCursor = { occurredAt: string; id: string };

export function encodePerseusTimelineCursor(event: PerseusDocumentEvent) {
  return encodeURIComponent(
    JSON.stringify({ occurredAt: event.occurredAt, id: event.id }),
  );
}

export function decodePerseusTimelineCursor(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<PerseusTimelineCursor>;
    return typeof parsed.occurredAt === "string" && typeof parsed.id === "string"
      ? { occurredAt: parsed.occurredAt, id: parsed.id }
      : null;
  } catch {
    return null;
  }
}

/** One stable logical timeline for persisted and reconstructed operational facts. */
export function paginatePerseusTimeline(
  events: PerseusDocumentEvent[],
  limit: number,
  cursor: PerseusTimelineCursor | null,
) {
  const unique = new Map<string, PerseusDocumentEvent>();
  for (const event of events) unique.set(event.id, event);
  const ordered = [...unique.values()].sort(
    (left, right) =>
      right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id),
  );
  const afterCursor = cursor
    ? ordered.filter(
        (event) =>
          event.occurredAt < cursor.occurredAt ||
          (event.occurredAt === cursor.occurredAt && event.id < cursor.id),
      )
    : ordered;
  const page = afterCursor.slice(0, limit);
  const hasMore = afterCursor.length > page.length;
  return {
    events: page,
    total: ordered.length,
    hasMore,
    nextCursor: hasMore && page.length ? encodePerseusTimelineCursor(page.at(-1)!) : null,
  };
}
