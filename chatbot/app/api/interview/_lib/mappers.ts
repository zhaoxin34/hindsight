/**
 * Mappers between DB row shape (snake_case from Postgres) and in-memory
 * state shape (camelCase, JSONB-serializable). Kept in one place so the
 * conversion is auditable.
 *
 * `row.classification` is validated with `ClassificationSchema.parse` because
 * the JSONB column can contain anything written by older code paths or
 * manual SQL edits. A bad row throws at the boundary instead of silently
 * corrupting downstream state — caller should treat 5xx as "bad data".
 */

import type { InterviewSessionRow } from "@/lib/db/sessions";
import { ClassificationSchema } from "@/lib/chat/classifier/types";
import {
  MAX_ROUNDS,
  type InterviewSessionState,
} from "@/lib/chat/interview/state";

export function rowToState(row: InterviewSessionRow): InterviewSessionState {
  return {
    session_id: row.session_id,
    bank_id: row.bank_id,
    query: row.query,
    classification: ClassificationSchema.parse(row.classification),
    turns: row.turns,
    round: row.round,
    maxRounds: MAX_ROUNDS,
    state: row.state,
    started_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
