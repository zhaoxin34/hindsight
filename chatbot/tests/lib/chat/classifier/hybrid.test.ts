import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HybridClassifier tests — exercise the rule-based / LLM fallback decision
 * and verify the FallbackLog is invoked on fallback.
 *
 * Both RuleBasedClassifier and LLMClassifier are real (no mocking) so we
 * exercise the real interaction; the LLMClientDeps is a small mock that
 * just returns a pre-canned JSON response.
 */

import { HybridClassifier } from "@/lib/chat/classifier/hybrid";
import { RuleBasedClassifier } from "@/lib/chat/classifier/rule-based";
import type {
  FallbackLog,
  FallbackLogEntry,
  LLMClientDeps,
} from "@/lib/chat/classifier/types";
import type { RecallResult } from "@/lib/hindsight";

const NO_RECALL: RecallResult[] = [];

function makeMockLLM(response: unknown): LLMClientDeps {
  return {
    complete: vi.fn().mockResolvedValue(JSON.stringify(response)),
  };
}

function makeMockLog(): FallbackLog & { entries: FallbackLogEntry[] } {
  const entries: FallbackLogEntry[] = [];
  return {
    entries,
    record: vi.fn(async (e: FallbackLogEntry) => {
      entries.push(e);
    }),
  };
}

describe("HybridClassifier — threshold logic", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("skips LLM when rule-based confidence >= 0.6 (default threshold)", async () => {
    const llm = makeMockLLM({ complexity: "abstract" });
    const log = makeMockLog();
    const classifier = new HybridClassifier({
      ruleBased: new RuleBasedClassifier(),
      llm,
      log,
    });

    // "为什么" 触发 abstractJudgmentKeywords (单条规则 confidence ≈ 0.7)
    const result = await classifier.classify({
      query: "为什么 Rust 这样设计",
      recall: NO_RECALL,
    });

    expect(result.complexity).toBe("abstract");
    expect(llm.complete).not.toHaveBeenCalled();
    expect(log.entries).toHaveLength(0);
  });

  it("calls LLM when rule-based confidence < 0.6", async () => {
    const llm = makeMockLLM({
      complexity: "decision",
      needs_conflict_check: false,
      confidence: 0.9,
      reasoning: "llm says decision",
    });
    const log = makeMockLog();
    const classifier = new HybridClassifier({
      ruleBased: new RuleBasedClassifier(),
      llm,
      log,
    });

    // "嗯啊哦" 触发 no rules matched (confidence = 0.3) → fallback
    const result = await classifier.classify({
      query: "嗯啊哦",
      recall: NO_RECALL,
    });

    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(result.reasoning).toBe("llm says decision");
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({
      source: "rule-based",
      query: "嗯啊哦",
      ruleConfidence: 0.3,
    });
  });

  it("respects custom threshold", async () => {
    const llm = makeMockLLM({
      complexity: "abstract",
      needs_conflict_check: false,
      confidence: 0.8,
    });
    const log = makeMockLog();
    const classifier = new HybridClassifier({
      ruleBased: new RuleBasedClassifier(),
      llm,
      log,
      threshold: 0.5, // lower threshold — more likely to skip LLM
    });

    // Confidence 0.7 >= 0.5, so should NOT call LLM
    const result = await classifier.classify({
      query: "为什么 Rust 这样设计",
      recall: NO_RECALL,
    });

    expect(llm.complete).not.toHaveBeenCalled();
    expect(result.complexity).toBe("abstract");
  });
});

describe("HybridClassifier — log failure tolerance", () => {
  it("does NOT fail classify() when log.record() throws", async () => {
    const llm = makeMockLLM({
      complexity: "decision",
      needs_conflict_check: false,
      confidence: 0.9,
    });
    const failingLog: FallbackLog = {
      record: vi.fn().mockRejectedValue(new Error("DB down")),
    };
    const classifier = new HybridClassifier({
      ruleBased: new RuleBasedClassifier(),
      llm,
      log: failingLog,
    });

    // Should not throw even though log fails
    const result = await classifier.classify({
      query: "嗯啊哦",
      recall: NO_RECALL,
    });
    expect(result.complexity).toBe("decision");
  });
});

describe("HybridClassifier — LLM JSON sanitization", () => {
  it("strips ```json fences from LLM response", async () => {
    const llm: LLMClientDeps = {
      complete: vi
        .fn()
        .mockResolvedValue(
          '```json\n{"complexity":"abstract","needs_conflict_check":false,"confidence":0.85,"reasoning":"stripped"}\n```',
        ),
    };
    const classifier = new HybridClassifier({
      ruleBased: new RuleBasedClassifier(),
      llm,
    });

    const result = await classifier.classify({
      query: "嗯啊哦",
      recall: NO_RECALL,
    });

    expect(result.complexity).toBe("abstract");
    expect(result.reasoning).toBe("stripped");
  });

  it("throws when LLM returns non-JSON", async () => {
    const llm: LLMClientDeps = {
      complete: vi.fn().mockResolvedValue("not json at all"),
    };
    const classifier = new HybridClassifier({
      ruleBased: new RuleBasedClassifier(),
      llm,
    });

    await expect(
      classifier.classify({ query: "嗯啊哦", recall: NO_RECALL }),
    ).rejects.toThrow(/non-JSON/);
  });

  it("throws when LLM returns JSON with wrong shape", async () => {
    const llm: LLMClientDeps = {
      complete: vi.fn().mockResolvedValue('{"complexity":"WRONG"}'),
    };
    const classifier = new HybridClassifier({
      ruleBased: new RuleBasedClassifier(),
      llm,
    });

    await expect(
      classifier.classify({ query: "嗯啊哦", recall: NO_RECALL }),
    ).rejects.toThrow();
  });
});
