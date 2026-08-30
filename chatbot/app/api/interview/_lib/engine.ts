/**
 * Wires the nextTurn state machine to the rest of the app: Hindsight
 * (recall/retain/invalidate), Postgres session storage, and the LLM.
 *
 * Each route handler builds a deps object by calling `getInterviewDeps`
 * once per request, so tests can replace the singleton via the
 * `setInterviewDepsForTest` hook.
 */

import {
  nextTurn,
  startInterview,
  type NextTurnDeps,
} from "@/lib/chat/interview/state-machine";
import { getInterviewLLM, setInterviewLLMForTest } from "./llm";
import { updateSession, getSession, createSession } from "@/lib/db/sessions";
import {
  detectConflict,
  type ConflictDeps,
} from "@/lib/chat/interview/conflict";
import {
  recallMemories,
  type RecallResult,
  type RetainItem,
} from "@/lib/hindsight";
import { rowToState } from "./mappers";
import type { InterviewSessionState } from "@/lib/chat/interview/state";
import { HINDSIGHT_BANK_ID } from "./config";

const NO_RECALL: RecallResult[] = [];

function buildDefaultDeps(): NextTurnDeps {
  return {
    llm: getInterviewLLM(),
    persist: async (state: InterviewSessionState) => {
      await updateSession({
        session_id: state.session_id,
        bank_id: state.bank_id,
        turns: state.turns,
        round: state.round,
        classification: state.classification,
      });
    },
    recall: async () => {
      // For the engine, we use a generic recall based on the original
      // query. Routes that need a different recall can override.
      try {
        const response = await recallMemories("");
        return response.results;
      } catch {
        return NO_RECALL;
      }
    },
    detectConflict: (state, lastAnswer, recall) =>
      detectConflict(state, lastAnswer, recall),
    buildRetainItems: (state): RetainItem[] =>
      state.turns.map((t) => ({
        content: t.a,
        context: `interview_session_${state.session_id}:${t.dimension}`,
      })),
  };
}

let _deps: NextTurnDeps = buildDefaultDeps();

export function getInterviewDeps(): NextTurnDeps {
  return _deps;
}

export function setInterviewDepsForTest(deps: NextTurnDeps | null): void {
  _deps = deps ?? buildDefaultDeps();
  if (deps === null) {
    setInterviewLLMForTest(null);
  }
}

// Re-export helpers used by routes
export { startInterview, nextTurn, getInterviewLLM };
export {
  getSession,
  createSession,
  rowToState,
  HINDSIGHT_BANK_ID,
  ConflictDeps,
};
