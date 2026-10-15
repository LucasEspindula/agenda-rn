import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type PerseusEventOrigin,
  type PerseusEventType,
  safePerseusEventMetadata,
} from "./operational-history";

/** Server-only append helper. Browser clients never receive write access to events. */
export async function appendPerseusDocumentEvent(
  db: SupabaseClient,
  input: {
    documentId: string;
    eventType: PerseusEventType;
    eventOrigin: PerseusEventOrigin;
    actorId?: number | null;
    parserVersion?: string | null;
    semanticVersion?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const result = await db.from("perseus_document_events").insert({
    document_id: input.documentId,
    event_type: input.eventType,
    event_origin: input.eventOrigin,
    actor_id: input.actorId || null,
    parser_version: input.parserVersion || null,
    semantic_version: input.semanticVersion || null,
    event_metadata: safePerseusEventMetadata(input.metadata || {}),
  });
  // Deployments can briefly precede the additive migration. Do not block the
  // existing document workflow while the event ledger is not installed yet.
  if (result.error && !["23505", "42P01"].includes(result.error.code)) {
    throw result.error;
  }
}
