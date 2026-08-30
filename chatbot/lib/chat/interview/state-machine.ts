/**
 * Interview state machine — `nextTurn(state, action, deps)`.
 *
 * Pure-ish: all IO is in `deps`, so the function is unit-testable with
 * mock LLM / mock persist. The state itself is the same JSONB-serializable
 * shape stored in Postgres, so the function works for both fresh requests
 * (state loaded from DB) and follow-up requests.
 *
 * Action → UI directive mapping (per spec multi-turn-interview):
 *   - user_answer + round < maxRounds + no conflict → ask_question
 *   - user_answer + conflict detected → show_conflict (UI shows 口误/认真)
 *   - conflict_decision(typo) → continue interview (ask_question)
 *   - conflict_decision(serious) → finished (caller will run PATCH+POST)
 *   - user_answer + round >= maxRounds → finished
 *   - user_finish → finished
 *   - user_abandon → abandoned
 *
 * Conflict detection is intentionally NOT built into nextTurn — it's a
 * separate `conflictDetector` dep that the caller provides. This keeps
 * this module small and lets Group 5 (Conflict Resolution) own the
 * detection logic.
 */

import type { LLMClientDeps } from "@/lib/chat/classifier/types";
import type { RecallResult, RetainItem } from "@/lib/hindsight";

import {
  buildInterviewSystemPrompt,
  buildInterviewUserPrompt,
} from "./strategies";
import {
  type ConflictPair,
  type InterviewAction,
  type InterviewSessionState,
  type InterviewTurn,
  type UIDirective,
} from "./state";

export interface NextTurnDeps {
  llm: LLMClientDeps;
  /** Persist the new state to Postgres. Called at the end of nextTurn. */
  persist: (state: InterviewSessionState) => Promise<void>;
  /**
   * Optional — when provided, called after user_answer to detect if the
   * latest turn contradicts any recall fact. Return [] when no conflict.
   */
  detectConflict?: (
    state: InterviewSessionState,
    lastAnswer: string,
    recall: RecallResult[],
  ) => ConflictPair[];
  /**
   * Optional — recall results to pass to detectConflict. When absent,
   * conflict detection is skipped (e.g. for testing).
   */
  recall?: () => Promise<RecallResult[]>;
  /**
   * Optional — build the list of RetainItems from turns when finishing.
   * Default implementation flattens each turn's answer as a fact.
   */
  buildRetainItems?: (state: InterviewSessionState) => RetainItem[];
}

function defaultBuildRetainItems(state: InterviewSessionState): RetainItem[] {
  return state.turns.map((t) => ({
    content: t.a,
    context: t.q,
  }));
}

/**
 * Generate the next interview question via the LLM. Trims and sanity-checks
 * the response — if the LLM returns empty / unparseable, returns a fallback
 * question so the interview doesn't get stuck.
 */
async function generateNextQuestion(
  state: InterviewSessionState,
  deps: NextTurnDeps,
): Promise<string> {
  const system = buildInterviewSystemPrompt(state);
  const user = buildInterviewUserPrompt(state);
  const text = await deps.llm.complete({ system, user });
  const trimmed = text.trim().replace(/^["「]|["」]$/g, "");
  if (trimmed.length === 0) {
    // Defensive fallback — LLM should never return empty, but if it does
    // we keep the interview going rather than silently terminating.
    return "能再展开讲讲吗？";
  }
  return trimmed;
}

/**
 * Pure-ish state transition. Returns the new state and what the UI should
 * do next. Side effects (LLM call, persist) are isolated in `deps`.
 */
export async function nextTurn(
  state: InterviewSessionState,
  action: InterviewAction,
  deps: NextTurnDeps,
): Promise<{ state: InterviewSessionState; ui: UIDirective }> {
  const now = new Date().toISOString();
  const buildItems = deps.buildRetainItems ?? defaultBuildRetainItems;

  switch (action.kind) {
    case "user_abandon": {
      const newState: InterviewSessionState = {
        ...state,
        state: "abandoned",
        updated_at: now,
      };
      await deps.persist(newState);
      return { state: newState, ui: { kind: "abandoned" } };
    }

    case "user_finish": {
      const newState: InterviewSessionState = {
        ...state,
        state: "finished",
        updated_at: now,
      };
      await deps.persist(newState);
      return {
        state: newState,
        ui: { kind: "finished", items: buildItems(newState) },
      };
    }

    case "conflict_decision": {
      if (action.verdict === "typo") {
        // Continue interview; do NOT replace any facts.
        const nextQuestion = await generateNextQuestion(state, deps);
        const newRound = state.round + 1;
        const newState: InterviewSessionState = {
          ...state,
          round: newRound,
          updated_at: now,
        };
        await deps.persist(newState);
        return {
          state: newState,
          ui: { kind: "ask_question", question: nextQuestion },
        };
      }
      // verdict === "serious" — finished; caller (Group 5 Conflict) will
      // run PATCH + POST replacement using buildItems(newState).
      const newState: InterviewSessionState = {
        ...state,
        state: "finished",
        updated_at: now,
      };
      await deps.persist(newState);
      return {
        state: newState,
        ui: { kind: "finished", items: buildItems(newState) },
      };
    }

    case "user_answer": {
      const lastTurn: InterviewTurn | undefined =
        state.turns[state.turns.length - 1];
      const newTurn: InterviewTurn = {
        q: lastTurn?.q ?? state.query,
        a: action.answer,
        dimension: state.classification.event_type ?? "general",
        ts: now,
      };
      const stateWithAnswer: InterviewSessionState = {
        ...state,
        turns: [...state.turns, newTurn],
        updated_at: now,
      };

      // Conflict check (optional)
      if (deps.detectConflict && deps.recall) {
        const recall = await deps.recall();
        const conflicts = deps.detectConflict(
          stateWithAnswer,
          action.answer,
          recall,
        );
        if (conflicts.length > 0) {
          // Do NOT increment round yet — wait for conflict resolution
          await deps.persist(stateWithAnswer);
          return {
            state: stateWithAnswer,
            ui: { kind: "show_conflict", facts: conflicts },
          };
        }
      }

      // Round limit
      const nextRound = stateWithAnswer.round + 1;
      if (nextRound >= stateWithAnswer.maxRounds) {
        const finishedState: InterviewSessionState = {
          ...stateWithAnswer,
          round: nextRound,
          state: "finished",
        };
        await deps.persist(finishedState);
        return {
          state: finishedState,
          ui: { kind: "finished", items: buildItems(finishedState) },
        };
      }

      // Continue: generate next question
      const intermediate: InterviewSessionState = {
        ...stateWithAnswer,
        round: nextRound,
      };
      const nextQuestion = await generateNextQuestion(intermediate, deps);
      await deps.persist(intermediate);
      return {
        state: intermediate,
        ui: { kind: "ask_question", question: nextQuestion },
      };
    }

    default: {
      // Exhaustiveness check — TS will flag this if a new action kind is added.
      const _exhaustive: never = action;
      throw new Error(`Unknown action: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Initial round helper: generate the first question. */
export async function startInterview(
  state: InterviewSessionState,
  deps: NextTurnDeps,
): Promise<{ state: InterviewSessionState; ui: UIDirective }> {
  const now = new Date().toISOString();
  const firstQuestion = await generateNextQuestion(state, deps);
  const newState: InterviewSessionState = {
    ...state,
    round: 1,
    updated_at: now,
  };
  await deps.persist(newState);
  return {
    state: newState,
    ui: { kind: "ask_question", question: firstQuestion },
  };
}
