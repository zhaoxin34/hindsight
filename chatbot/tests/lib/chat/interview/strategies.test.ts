import { describe, expect, it } from "vitest";

import {
  STRATEGY_PROMPTS,
  buildInterviewSystemPrompt,
  buildInterviewUserPrompt,
  selectEventTypePrompt,
} from "@/lib/chat/interview/strategies";
import {
  makeInitialState,
  type InterviewSessionState,
} from "@/lib/chat/interview/state";
import type { Classification } from "@/lib/chat/classifier/types";

const baseClassification: Classification = {
  complexity: "abstract",
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

describe("selectEventTypePrompt", () => {
  it("returns the matching strategy for known event_types", () => {
    expect(selectEventTypePrompt("success")).toBe(STRATEGY_PROMPTS.success);
    expect(selectEventTypePrompt("failure")).toBe(STRATEGY_PROMPTS.failure);
    expect(selectEventTypePrompt("misjudgment")).toBe(
      STRATEGY_PROMPTS.misjudgment,
    );
    expect(selectEventTypePrompt("counterintuitive")).toBe(
      STRATEGY_PROMPTS.counterintuitive,
    );
  });

  it("returns null for undefined / unknown event_type", () => {
    expect(selectEventTypePrompt(undefined)).toBeNull();
    expect(selectEventTypePrompt("unknown_type")).toBeNull();
  });
});

describe("buildInterviewSystemPrompt", () => {
  it("includes the original query", () => {
    const state = makeState({ query: "如何设计一个好的 API" });
    const prompt = buildInterviewSystemPrompt(state);
    expect(prompt).toContain("如何设计一个好的 API");
  });

  it("includes round count and maxRounds", () => {
    const state = makeState({ round: 3, maxRounds: 5 });
    const prompt = buildInterviewSystemPrompt(state);
    expect(prompt).toContain("3 / 5");
  });

  it("uses the event_type-specific strategy on round 0", () => {
    const state = makeState({
      round: 0,
      classification: { ...baseClassification, event_type: "failure" },
    });
    const prompt = buildInterviewSystemPrompt(state);
    expect(prompt).toContain("失败案例");
  });

  it("falls back to FIVE_WHYS strategy when event_type is missing", () => {
    const state = makeState({
      round: 0,
      classification: { ...baseClassification, event_type: undefined },
    });
    const prompt = buildInterviewSystemPrompt(state);
    expect(prompt).toContain("五要素");
  });

  it("uses FIVE_WHYS strategy on subsequent rounds regardless of event_type", () => {
    const state = makeState({
      round: 2,
      classification: { ...baseClassification, event_type: "success" },
    });
    const prompt = buildInterviewSystemPrompt(state);
    expect(prompt).toContain("五要素");
  });
});

describe("buildInterviewUserPrompt", () => {
  it("shows the original query as the last question when no turns yet", () => {
    const state = makeState({ query: "你的设计哲学是什么" });
    const prompt = buildInterviewUserPrompt(state);
    expect(prompt).toContain("你的设计哲学是什么");
    expect(prompt).toContain("尚未回答");
  });

  it("shows last turn's Q and A when turns exist", () => {
    const state = makeState({
      turns: [
        {
          q: "first question",
          a: "first answer",
          dimension: "general",
          ts: "2026-08-29T12:00:00Z",
        },
      ],
    });
    const prompt = buildInterviewUserPrompt(state);
    expect(prompt).toContain("first question");
    expect(prompt).toContain("first answer");
  });
});
