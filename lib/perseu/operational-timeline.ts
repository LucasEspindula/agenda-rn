import {
  safePerseusEventMetadata,
  type PerseusDocumentEvent,
} from "./operational-history";

/**
 * SUPERSEDED describes the review's current state, not its original action.
 * Reconstruct the original confirmation/rejection only when no ledger event
 * for that same review and original action has already been persisted.
 */
export function reconstructPerseusLegacyReviews(
  documentId: string,
  reviews: readonly Record<string, unknown>[],
  persisted: readonly PerseusDocumentEvent[],
): PerseusDocumentEvent[] {
  const recordedOriginalReviews = new Set(
    persisted
      .filter(
        (event) =>
          event.relatedReviewId &&
          (event.eventType === "MAPPING_REVIEW_APPLIED" ||
            event.eventType === "MAPPING_REVIEW_REJECTED"),
      )
      .map((event) => event.relatedReviewId),
  );
  return reviews.flatMap((row) => {
    const reviewId = String(row.id);
    if (recordedOriginalReviews.has(reviewId)) return [];
    const eventType: PerseusDocumentEvent["eventType"] =
      row.semantic_field == null
        ? "MAPPING_REVIEW_REJECTED"
        : "MAPPING_REVIEW_APPLIED";
    return [
      {
        id: "legacy-review-" + reviewId,
        documentId,
        eventType,
        eventOrigin: "HISTORICAL_RECONSTRUCTED" as const,
        occurredAt: String(row.created_at),
        actorId: typeof row.created_by === "number" ? row.created_by : null,
        metadata: safePerseusEventMetadata({
          column: row.source_key,
          field: row.semantic_field,
        }),
        historical: true,
      },
    ];
  });
}

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
