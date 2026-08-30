/**
 * CRUD operations for chatbot_interview.interview_sessions.
 *
 * Pure data-access functions — the state machine and route handlers consume
 * these via DI seams. Bank-scoped access is enforced by passing bank_id
 * alongside the session_id; cross-bank reads return null (callers should
 * treat as 403/404).
 *
 * Schema reference: chatbot/db/migrations/001_chatbot_interview_schema.sql
 */

import { type JSONValue } from "postgres";

import { sql } from "./client";

export type SessionState = "active" | "finished" | "abandoned";

/** JSON-serializable turn (matches design D4 `turns JSONB`). */
export interface InterviewTurn {
  q: string;
  a: string;
  dimension: string;
  ts: string; // ISO 8601
}

/** JSON-serializable Classification output (matches spec complexity-classification). */
export interface StoredClassification {
  complexity: "simple" | "decision" | "abstract";
  event_type?: string;
  needs_conflict_check: boolean;
  confidence: number;
  reasoning?: string;
}

/** DB row shape (snake_case fields come straight from Postgres). */
export interface InterviewSessionRow {
  session_id: string;
  bank_id: string;
  query: string;
  classification: StoredClassification;
  turns: InterviewTurn[];
  round: number;
  state: SessionState;
  created_at: Date;
  updated_at: Date;
}

/** Input for createSession — only the fields the client supplies. */
export interface CreateSessionInput {
  bank_id: string;
  query: string;
  classification: StoredClassification;
}

/**
 * Cast typed JSON values to `JSONValue` for `sql.json()`. SAFETY: our
 * `StoredClassification` / `InterviewTurn[]` types only contain primitives
 * and JSON-serializable structures, so this cast loses nothing — `sql.json()`
 * encodes the object correctly at runtime. We can't prove that to TypeScript
 * without an index signature, which we deliberately omit to keep the public
 * types narrow for callers.
 */
function asJson<T>(value: T): JSONValue {
  // SAFETY: see function doc — value is structurally JSON-serializable.
  return value as unknown as JSONValue;
}

export async function createSession(
  input: CreateSessionInput,
): Promise<InterviewSessionRow> {
  const result = await sql<InterviewSessionRow[]>`
      INSERT INTO chatbot_interview.interview_sessions
        (bank_id, query, classification)
      VALUES
        (${input.bank_id}, ${input.query}, ${sql.json(asJson(input.classification))})
      RETURNING *
    `;
  return result[0];
}

export async function getSession(
  sessionId: string,
  bankId: string,
): Promise<InterviewSessionRow | null> {
  const result = await sql<InterviewSessionRow[]>`
      SELECT *
      FROM chatbot_interview.interview_sessions
      WHERE session_id = ${sessionId}
        AND bank_id = ${bankId}
    `;
  return result[0] ?? null;
}

export interface UpdateSessionInput {
  session_id: string;
  bank_id: string;
  turns?: InterviewTurn[];
  round?: number;
  classification?: StoredClassification;
}

/**
 * For optional fields we pass `null` and let SQL `COALESCE` keep the
 * existing column value. This avoids the need for dynamic fragment
 * assembly (postgres-js exposes `join` directly, not `sql.join`).
 */
export async function updateSession(
  input: UpdateSessionInput,
): Promise<InterviewSessionRow | null> {
  const turnsParam =
    input.turns === undefined ? null : sql.json(asJson(input.turns));
  const roundParam = input.round ?? null;
  const classParam =
    input.classification === undefined
      ? null
      : sql.json(asJson(input.classification));

  const result = await sql<InterviewSessionRow[]>`
      UPDATE chatbot_interview.interview_sessions
      SET
        turns = COALESCE(${turnsParam}, turns),
        round = COALESCE(${roundParam}, round),
        classification = COALESCE(${classParam}, classification),
        updated_at = NOW()
      WHERE session_id = ${input.session_id}
        AND bank_id = ${input.bank_id}
      RETURNING *
    `;
  return result[0] ?? null;
}

export async function markAbandoned(
  sessionId: string,
  bankId: string,
): Promise<InterviewSessionRow | null> {
  const result = await sql<InterviewSessionRow[]>`
      UPDATE chatbot_interview.interview_sessions
      SET state = 'abandoned',
          updated_at = NOW()
      WHERE session_id = ${sessionId}
        AND bank_id = ${bankId}
      RETURNING *
    `;
  return result[0] ?? null;
}

export async function markFinished(
  sessionId: string,
  bankId: string,
): Promise<InterviewSessionRow | null> {
  const result = await sql<InterviewSessionRow[]>`
      UPDATE chatbot_interview.interview_sessions
      SET state = 'finished',
          updated_at = NOW()
      WHERE session_id = ${sessionId}
        AND bank_id = ${bankId}
      RETURNING *
    `;
  return result[0] ?? null;
}

/**
 * Delete abandoned sessions older than `beforeDate`. Returns the number of
 * rows deleted so the cron / cleanup script can log progress.
 */
export async function cleanupStale(beforeDate: Date): Promise<number> {
  const result = await sql<{ count: number }[]>`
      WITH deleted AS (
        DELETE FROM chatbot_interview.interview_sessions
        WHERE state = 'abandoned'
          AND updated_at < ${beforeDate.toISOString()}
        RETURNING 1
      )
      SELECT COUNT(*)::int AS count FROM deleted
    `;
  return result[0]?.count ?? 0;
}
