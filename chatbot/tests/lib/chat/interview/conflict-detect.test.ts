import { describe, expect, it } from "vitest";

import { detectConflict } from "@/lib/chat/interview/conflict";
import {
  makeInitialState,
  type InterviewSessionState,
} from "@/lib/chat/interview/state";
import type { RecallResult } from "@/lib/hindsight";
import type { Classification } from "@/lib/chat/classifier/types";

const baseClassification: Classification = {
  complexity: "abstract",
  event_type: "success",
  needs_conflict_check: true,
  confidence: 0.85,
};

function makeState(): InterviewSessionState {
  return makeInitialState({
    session_id: "test-session",
    bank_id: "zhangwei",
    query: "你现在在哪里工作",
    classification: baseClassification,
  });
}

const sampleRecall: RecallResult[] = [
  {
    id: "f1",
    text: "用户 2024 年在北京工作",
    type: "world",
    context: null,
    metadata: null,
    tags: null,
    entities: ["用户", "北京"],
    occurred_start: null,
    occurred_end: null,
    mentioned_at: "2024-01-01T00:00:00Z",
    document_id: null,
    chunk_id: null,
    source_fact_ids: null,
    scores: { final: 0.9, reranker: null, semantic: null, keyword: null },
  },
  {
    id: "f2",
    text: "用户 2023 年在深圳实习",
    type: "world",
    context: null,
    metadata: null,
    tags: null,
    entities: ["用户", "深圳"],
    occurred_start: null,
    occurred_end: null,
    mentioned_at: "2023-06-01T00:00:00Z",
    document_id: null,
    chunk_id: null,
    source_fact_ids: null,
    scores: { final: 0.85, reranker: null, semantic: null, keyword: null },
  },
];

describe("detectConflict", () => {
  it("returns no conflicts when answer has no temporal keywords", () => {
    const result = detectConflict(
      makeState(),
      "我之前在北京工作",
      sampleRecall,
    );
    expect(result).toEqual([]);
  });

  it("returns no conflicts when answer is temporal but recall is empty", () => {
    const result = detectConflict(makeState(), "我现在在深圳", []);
    expect(result).toEqual([]);
  });

  it("surfaces all recall facts as conflict candidates when answer is temporal", () => {
    const result = detectConflict(
      makeState(),
      "我现在在深圳工作",
      sampleRecall,
    );
    expect(result).toHaveLength(2);
    expect(result[0].old_fact.id).toBe("f1");
    expect(result[1].old_fact.id).toBe("f2");
    expect(result[0].reason).toMatch(/contradic/i);
  });

  it("truncates long answer in reason field at 60 chars", () => {
    const longAnswer = "我".repeat(100) + "现在在深圳工作";
    const result = detectConflict(makeState(), longAnswer, sampleRecall);
    expect(result[0].reason.length).toBeLessThan(longAnswer.length + 50);
    expect(result[0].reason).toContain("...");
  });

  it("recognizes all temporal keywords", () => {
    const temporalAnswers = [
      "我现在在",
      "我目前做",
      "当前情况",
      "今年刚",
      "刚刚才",
      "现在做",
    ];
    for (const answer of temporalAnswers) {
      const result = detectConflict(makeState(), answer, sampleRecall);
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
