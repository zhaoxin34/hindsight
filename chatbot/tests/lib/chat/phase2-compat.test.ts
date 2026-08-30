import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 2 backward-compat smoke test: when `ENABLE_MULTI_TURN_INTERVIEW`
 * is false, the new session-based routes return 404, and the mode-router
 * falls back to the binary Phase 2 logic.
 *
 * These checks mirror the "Phase 2 behavior unchanged" Done standard
 * in tasks.md (9.4).
 */

import { decideMode, decideModeWithClassifier } from "@/lib/chat/mode-router";
import { setMultiTurnEnabledForTest } from "@/app/api/interview/_lib/config";
import type { RecallResponse } from "@/lib/hindsight";

beforeEach(() => setMultiTurnEnabledForTest(false));
afterEach(() => setMultiTurnEnabledForTest(null));

const EMPTY_RECALL: RecallResponse = { results: [] };
const NON_EMPTY_RECALL: RecallResponse = {
  results: [
    {
      id: "f1",
      text: "x",
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

describe("Phase 2 compatibility (ENABLE_MULTI_TURN_INTERVIEW=false)", () => {
  it("decideMode: empty recall → interview (Phase 2 binary)", () => {
    expect(decideMode(EMPTY_RECALL)).toBe("interview");
  });

  it("decideMode: non-empty recall → main (Phase 2 binary)", () => {
    expect(decideMode(NON_EMPTY_RECALL)).toBe("main");
  });

  it("decideModeWithClassifier: flag off falls back to Phase 2 binary", async () => {
    const classifier = {
      classify: vi.fn(),
    };
    const decision = await decideModeWithClassifier(
      "why?",
      EMPTY_RECALL,
      classifier,
    );
    expect(decision.mode).toBe("interview");
    // Classifier MUST NOT be called when the flag is off.
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it("decideModeWithClassifier: flag off, recall has facts → main", async () => {
    const classifier = { classify: vi.fn() };
    const decision = await decideModeWithClassifier(
      "why?",
      NON_EMPTY_RECALL,
      classifier,
    );
    expect(decision.mode).toBe("main");
    expect(classifier.classify).not.toHaveBeenCalled();
  });
});
