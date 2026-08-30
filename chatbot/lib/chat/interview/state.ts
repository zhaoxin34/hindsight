/**
 * Interview state machine — types for the multi-turn interview.
 *
 * The state machine itself lives in state-machine.ts (`nextTurn`). This
 * file only declares the data shapes so other modules can import them
 * without pulling in the LLM-touching state machine.
 *
 * State is intentionally serializable (no class instances, no methods) so
 * the same shape can be stored in Postgres JSONB and replayed across HTTP
 * requests (refresh, cross-device).
 */

import type { Classification } from "@/lib/chat/classifier/types";
import type { RecallResult, RetainItem } from "@/lib/hindsight";
import type { InterviewTurn } from "@/lib/db/sessions";

/** Re-export so consumers can `import { InterviewTurn } from "./state"`. */
export type { InterviewTurn };

export const MAX_ROUNDS = 5;

/** In-memory state of an active multi-turn interview. Persisted to JSONB. */
export interface InterviewSessionState {
  session_id: string;
  bank_id: string;
  query: string;
  classification: Classification;
  turns: InterviewTurn[];
  round: number; // 0 = not yet started, 1..maxRounds
  maxRounds: number;
  state: "active" | "finished" | "abandoned";
  started_at: string;
  updated_at: string;
}

/** Inputs the user (or conflict resolution flow) can send. */
export type InterviewAction =
  | { kind: "user_answer"; answer: string }
  | { kind: "user_finish" } // 「够了」
  | { kind: "user_abandon" } // 「放弃」
  | {
      kind: "conflict_decision";
      verdict: "typo" | "serious";
      old_fact_id: string;
    };

/** What the UI should render next. */
export type UIDirective =
  | { kind: "ask_question"; question: string }
  | { kind: "show_conflict"; facts: ConflictPair[] }
  | { kind: "finished"; items: RetainItem[] }
  | { kind: "abandoned" };

/** One side of a conflict: an old fact from recall + why it might conflict. */
export interface ConflictPair {
  old_fact: RecallResult;
  reason: string;
}

/** Factory for a brand-new interview session. */
export function makeInitialState(input: {
  session_id: string;
  bank_id: string;
  query: string;
  classification: Classification;
  now?: Date;
}): InterviewSessionState {
  const now = (input.now ?? new Date()).toISOString();
  return {
    session_id: input.session_id,
    bank_id: input.bank_id,
    query: input.query,
    classification: input.classification,
    turns: [],
    round: 0,
    maxRounds: MAX_ROUNDS,
    state: "active",
    started_at: now,
    updated_at: now,
  };
}
