import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LLMClientDeps } from "@/lib/chat/classifier/types";
import {
  nextTurn,
  startInterview,
  type NextTurnDeps,
} from "@/lib/chat/interview/state-machine";
import {
  makeInitialState,
  type InterviewSessionState,
} from "@/lib/chat/interview/state";
import type { Classification } from "@/lib/chat/classifier/types";
import type { RecallResult, RetainItem } from "@/lib/hindsight";

const baseClassification: Classification = {
  complexity: "abstract",
  event_type: "success",
  needs_conflict_check: false,
  confidence: 0.85,
};

function makeState(
  overrides: Partial<InterviewSessionState> = {},
): InterviewSessionState {
  return {
    ...makeInitialState({
      session_id: "test-session",
      bank_id: "zhangwei",
      query: "为什么 Rust 这样设计",
      classification: baseClassification,
    }),
    ...overrides,
  };
}

function makeLLM(response: string): LLMClientDeps {
  return { complete: vi.fn().mockResolvedValue(response) };
}

function makeDeps(overrides: Partial<NextTurnDeps> = {}): NextTurnDeps {
  return {
    llm: makeLLM("下一个问题？"),
    persist: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Determinism (3.6): same input → same output. We achieve this by mocking
// the LLM and persist so IO is fully controlled.
// ---------------------------------------------------------------------------

describe("nextTurn — determinism", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("is deterministic: same state + same action → same ui", async () => {
    const state = makeState();
    const deps = makeDeps();

    const a = await nextTurn(state, { kind: "user_finish" }, deps);
    const b = await nextTurn(state, { kind: "user_finish" }, deps);
    expect(a.ui).toEqual(b.ui);
    expect(a.state.state).toBe("finished");
    expect(b.state.state).toBe("finished");
  });
});

// ---------------------------------------------------------------------------
// Action → Directive path coverage (3.7)
// ---------------------------------------------------------------------------

describe("nextTurn — user_answer path", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("appends turn and asks next question when no conflict", async () => {
    const state = makeState({ round: 1 });
    const deps = makeDeps({ llm: makeLLM("下一个问题是什么？") });

    const result = await nextTurn(
      state,
      { kind: "user_answer", answer: "因为内存安全" },
      deps,
    );

    expect(result.state.turns).toHaveLength(1);
    expect(result.state.turns[0].a).toBe("因为内存安全");
    expect(result.state.round).toBe(2);
    expect(result.ui).toEqual({
      kind: "ask_question",
      question: "下一个问题是什么？",
    });
  });

  it("shows conflict when detectConflict returns facts", async () => {
    const state = makeState({ round: 1 });
    const conflictFacts = [
      {
        old_fact: { id: "f1", text: "old fact" } as RecallResult,
        reason: "contradicts",
      },
    ];
    const deps = makeDeps({
      detectConflict: vi.fn().mockReturnValue(conflictFacts),
      recall: vi.fn().mockResolvedValue([]),
    });

    const result = await nextTurn(
      state,
      { kind: "user_answer", answer: "新答案" },
      deps,
    );

    expect(result.ui).toEqual({
      kind: "show_conflict",
      facts: conflictFacts,
    });
    // round should NOT advance until conflict is resolved
    expect(result.state.round).toBe(1);
  });

  it("finishes when round reaches maxRounds", async () => {
    const state = makeState({ round: 4, maxRounds: 5 });
    const deps = makeDeps();

    const result = await nextTurn(
      state,
      { kind: "user_answer", answer: "最后一个回答" },
      deps,
    );

    expect(result.ui.kind).toBe("finished");
    expect(result.state.state).toBe("finished");
    expect(result.state.round).toBe(5);
  });
});

describe("nextTurn — user_finish path", () => {
  it("marks state as finished and emits RetainItems from turns", async () => {
    const state = makeState({
      turns: [
        { q: "q1", a: "a1", dimension: "general", ts: "2026-08-29T12:00:00Z" },
        { q: "q2", a: "a2", dimension: "general", ts: "2026-08-29T12:01:00Z" },
      ],
    });
    const deps = makeDeps();

    const result = await nextTurn(state, { kind: "user_finish" }, deps);

    expect(result.state.state).toBe("finished");
    expect(result.ui.kind).toBe("finished");
    if (result.ui.kind === "finished") {
      expect(result.ui.items).toEqual([
        { content: "a1", context: "q1" },
        { content: "a2", context: "q2" },
      ]);
    }
  });

  it("respects custom buildRetainItems", async () => {
    const state = makeState({
      turns: [{ q: "q1", a: "a1", dimension: "d", ts: "2026-08-29" }],
    });
    const customItems: RetainItem[] = [{ content: "custom", context: "ctx" }];
    const deps = makeDeps({
      buildRetainItems: vi.fn().mockReturnValue(customItems),
    });

    const result = await nextTurn(state, { kind: "user_finish" }, deps);

    if (result.ui.kind === "finished") {
      expect(result.ui.items).toEqual(customItems);
    }
  });
});

describe("nextTurn — user_abandon path", () => {
  it("marks state as abandoned with no retain items", async () => {
    const state = makeState({
      turns: [{ q: "q1", a: "a1", dimension: "d", ts: "2026-08-29" }],
    });
    const deps = makeDeps();

    const result = await nextTurn(state, { kind: "user_abandon" }, deps);

    expect(result.state.state).toBe("abandoned");
    expect(result.ui).toEqual({ kind: "abandoned" });
  });
});

describe("nextTurn — conflict_decision path", () => {
  it("typo: continues interview with next question", async () => {
    const state = makeState({ round: 1 });
    const deps = makeDeps({ llm: makeLLM("继续追问？") });

    const result = await nextTurn(
      state,
      { kind: "conflict_decision", verdict: "typo", old_fact_id: "f1" },
      deps,
    );

    expect(result.state.round).toBe(2);
    expect(result.ui).toEqual({ kind: "ask_question", question: "继续追问？" });
  });

  it("serious: finishes so caller can run PATCH + POST", async () => {
    const state = makeState({
      turns: [{ q: "q1", a: "new answer", dimension: "d", ts: "2026-08-29" }],
    });
    const deps = makeDeps();

    const result = await nextTurn(
      state,
      { kind: "conflict_decision", verdict: "serious", old_fact_id: "f1" },
      deps,
    );

    expect(result.state.state).toBe("finished");
    expect(result.ui.kind).toBe("finished");
  });
});

// ---------------------------------------------------------------------------
// startInterview
// ---------------------------------------------------------------------------

describe("startInterview", () => {
  it("generates the first question and bumps round to 1", async () => {
    const state = makeState({ round: 0 });
    const deps = makeDeps({ llm: makeLLM("第一个问题？") });

    const result = await startInterview(state, deps);

    expect(result.state.round).toBe(1);
    expect(result.ui).toEqual({
      kind: "ask_question",
      question: "第一个问题？",
    });
  });

  it("persists the new state", async () => {
    const state = makeState();
    const persist = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ persist, llm: makeLLM("q") });

    await startInterview(state, deps);
    expect(persist).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("nextTurn — error handling", () => {
  it("falls back to a question when LLM returns empty string", async () => {
    const state = makeState({ round: 1 });
    const deps = makeDeps({ llm: makeLLM("") });

    const result = await nextTurn(
      state,
      { kind: "user_answer", answer: "x" },
      deps,
    );

    // Should not throw; should use fallback question
    expect(result.ui.kind).toBe("ask_question");
    if (result.ui.kind === "ask_question") {
      expect(result.ui.question.length).toBeGreaterThan(0);
    }
  });
});
