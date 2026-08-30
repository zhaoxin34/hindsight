import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decideMode, decideModeWithClassifier } from "@/lib/chat/mode-router";
import { setMultiTurnEnabledForTest } from "@/app/api/interview/_lib/config";
import type {
  ComplexityClassifier,
  Classification,
} from "@/lib/chat/classifier/types";
import type { RecallResponse } from "@/lib/hindsight";

const EMPTY_RECALL: RecallResponse = { results: [] };
const NON_EMPTY_RECALL: RecallResponse = {
  results: [
    {
      id: "f1",
      text: "sample fact",
      type: "world",
      context: null,
      metadata: null,
      tags: null,
      entities: null,
      occurred_start: null,
      occurred_end: null,
      mentioned_at: "2026-01-01T00:00:00Z",
      document_id: null,
      chunk_id: null,
      source_fact_ids: null,
      scores: { final: 0.9, reranker: null, semantic: null, keyword: null },
    },
  ],
};

function makeClassifier(
  complexity: Classification["complexity"],
): ComplexityClassifier {
  return {
    classify: vi.fn().mockResolvedValue({
      complexity,
      event_type: "fact",
      needs_conflict_check: false,
      confidence: 0.9,
    }),
  };
}

beforeEach(() => setMultiTurnEnabledForTest(true));
afterEach(() => setMultiTurnEnabledForTest(null));

// ---------------------------------------------------------------------------
// Phase 2 binary decision
// ---------------------------------------------------------------------------

describe("decideMode (Phase 2 binary)", () => {
  it("routes to interview when recall is null", () => {
    expect(decideMode(null)).toBe("interview");
  });

  it("routes to interview when recall is empty", () => {
    expect(decideMode(EMPTY_RECALL)).toBe("interview");
  });

  it("routes to main when recall has facts", () => {
    expect(decideMode(NON_EMPTY_RECALL)).toBe("main");
  });

  it("treats malformed recall (missing results) as empty", () => {
    expect(decideMode({} as RecallResponse)).toBe("interview");
  });
});

// ---------------------------------------------------------------------------
// Phase 3 classifier-aware decision
// ---------------------------------------------------------------------------

describe("decideModeWithClassifier", () => {
  it("routes to main when recall has facts (no classifier call needed)", async () => {
    const classifier = makeClassifier("abstract");
    const decision = await decideModeWithClassifier(
      "why?",
      NON_EMPTY_RECALL,
      classifier,
    );
    expect(decision.mode).toBe("main");
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it("routes to main for simple fact lookups (recall empty)", async () => {
    const classifier = makeClassifier("simple");
    const decision = await decideModeWithClassifier(
      "北京是哪个国家的首都",
      EMPTY_RECALL,
      classifier,
    );
    expect(decision.mode).toBe("main");
    expect(classifier.classify).toHaveBeenCalled();
  });

  it("routes to interview for abstract questions (recall empty)", async () => {
    const classifier = makeClassifier("abstract");
    const decision = await decideModeWithClassifier(
      "为什么 Rust 这样设计",
      EMPTY_RECALL,
      classifier,
    );
    expect(decision.mode).toBe("interview");
    expect(decision.classification?.complexity).toBe("abstract");
  });

  it("routes to interview for decision questions (recall empty)", async () => {
    const classifier = makeClassifier("decision");
    const decision = await decideModeWithClassifier(
      "应该选哪个框架",
      EMPTY_RECALL,
      classifier,
    );
    expect(decision.mode).toBe("interview");
  });

  it("returns the raw classification in the decision (for downstream use)", async () => {
    const classification: Classification = {
      complexity: "abstract",
      event_type: "success",
      needs_conflict_check: true,
      confidence: 0.85,
      reasoning: "deep why question",
    };
    const classifier: ComplexityClassifier = {
      classify: vi.fn().mockResolvedValue(classification),
    };
    const decision = await decideModeWithClassifier(
      "why?",
      EMPTY_RECALL,
      classifier,
    );
    expect(decision.classification).toEqual(classification);
  });

  it("treats null recall as empty and still runs the classifier", async () => {
    const classifier = makeClassifier("abstract");
    const decision = await decideModeWithClassifier("why?", null, classifier);
    expect(decision.mode).toBe("interview");
    expect(classifier.classify).toHaveBeenCalledWith({
      query: "why?",
      recall: [],
    });
  });
});
