/**
 * useInterviewSession — React hook for the Phase 3 multi-turn interview flow.
 *
 * Encapsulates the lifecycle of a multi-turn interview session against
 * `/api/interview/session/*`. The hook returns a stable shape the UI
 * can render:
 *
 *   - `session`  — the current InterviewSessionState (null when no session)
 *   - `question` — the latest pending question (or null)
 *   - `conflict` — the conflict to surface for the expert (or null)
 *   - `finished` / `abandoned` — terminal state flags
 *   - `error`    — last error message
 *   - actions: `start(query)`, `answer(text)`, `finish()`, `abandon()`,
 *     `resolveConflict(verdict, oldFactId)`, `reset()`
 *
 * All fetch calls are wrapped in try/catch and surface a string error so
 * the UI can render it directly.
 */

import { useCallback, useState } from "react";

import type { RetainItem } from "@/lib/hindsight";
import type {
  InterviewSessionState,
  UIDirective,
  ConflictPair,
} from "@/lib/chat/interview/state";

export type InterviewHookState =
  | { kind: "idle" }
  | { kind: "active"; session: InterviewSessionState; question: string | null }
  | {
      kind: "conflict";
      session: InterviewSessionState;
      conflict: ConflictPair[];
    }
  | { kind: "finished"; session: InterviewSessionState; items: RetainItem[] }
  | { kind: "abandoned" }
  | { kind: "error"; message: string };

const BANK_ID = "zhangwei";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function applyUi(
  state: InterviewSessionState,
  ui: UIDirective,
): InterviewHookState {
  switch (ui.kind) {
    case "ask_question":
      return { kind: "active", session: state, question: ui.question };
    case "show_conflict":
      return { kind: "conflict", session: state, conflict: ui.facts };
    case "finished":
      return { kind: "finished", session: state, items: ui.items };
    case "abandoned":
      return { kind: "abandoned" };
    default: {
      // Exhaustiveness check — TS will flag this if a new UI directive
      // kind is added. Throwing here also ensures an impossible state
      // doesn't silently fall through to "abandoned" (which would lie to
      // the user about session status).
      const _exhaustive: never = ui;
      throw new Error(`Unknown UI directive: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export interface UseInterviewSession {
  state: InterviewHookState;
  start: (query: string) => Promise<void>;
  answer: (text: string) => Promise<void>;
  finish: () => Promise<void>;
  abandon: () => Promise<void>;
  resolveConflict: (
    verdict: "typo" | "serious",
    oldFactId: string,
  ) => Promise<void>;
  reset: () => void;
}

export function useInterviewSession(): UseInterviewSession {
  const [state, setState] = useState<InterviewHookState>({ kind: "idle" });

  const handleError = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    setState({ kind: "error", message });
  }, []);

  const start = useCallback(
    async (query: string) => {
      try {
        const {
          session_id,
          state: session,
          ui,
        } = await postJson<{
          session_id: string;
          state: InterviewSessionState;
          ui: UIDirective;
        }>("/api/interview/session", { bank_id: BANK_ID, query });
        setState(applyUi({ ...session, session_id }, ui));
      } catch (err) {
        handleError(err);
      }
    },
    [handleError],
  );

  const answer = useCallback(
    async (text: string) => {
      if (state.kind !== "active" && state.kind !== "conflict") return;
      const session = state.session;
      try {
        const { state: next, ui } = await patchJson<{
          state: InterviewSessionState;
          ui: UIDirective;
        }>("/api/interview/session", {
          session_id: session.session_id,
          action: { kind: "user_answer", answer: text },
        });
        setState(applyUi(next, ui));
      } catch (err) {
        handleError(err);
      }
    },
    [state, handleError],
  );

  const finish = useCallback(async () => {
    if (state.kind !== "active" && state.kind !== "conflict") return;
    const sessionId = state.session.session_id;
    try {
      const { state: next, ui } = await postJson<{
        state: InterviewSessionState;
        ui: UIDirective;
      }>(`/api/interview/session/${sessionId}/finish`, {});
      setState(applyUi(next, ui));
    } catch (err) {
      handleError(err);
    }
  }, [state, handleError]);

  const abandon = useCallback(async () => {
    if (state.kind !== "active" && state.kind !== "conflict") return;
    const sessionId = state.session.session_id;
    try {
      const { state: next, ui } = await postJson<{
        state: InterviewSessionState;
        ui: UIDirective;
      }>(`/api/interview/session/${sessionId}/abandon`, {});
      setState(applyUi(next, ui));
    } catch (err) {
      handleError(err);
    }
  }, [state, handleError]);

  const resolveConflict = useCallback(
    async (verdict: "typo" | "serious", oldFactId: string) => {
      if (state.kind !== "conflict") return;
      try {
        const { state: next, ui } = await patchJson<{
          state: InterviewSessionState;
          ui: UIDirective;
        }>("/api/interview/session", {
          session_id: state.session.session_id,
          action: {
            kind: "conflict_decision",
            verdict,
            old_fact_id: oldFactId,
          },
        });
        setState(applyUi(next, ui));
      } catch (err) {
        handleError(err);
      }
    },
    [state, handleError],
  );

  const reset = useCallback(() => {
    setState({ kind: "idle" });
  }, []);

  return { state, start, answer, finish, abandon, resolveConflict, reset };
}
