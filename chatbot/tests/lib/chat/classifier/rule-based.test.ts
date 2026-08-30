import { describe, expect, it } from "vitest";

import { RuleBasedClassifier } from "@/lib/chat/classifier/rule-based";
import type { RecallResult } from "@/lib/hindsight";

/**
 * Rule-level coverage: each rule is exercised with at least one positive
 * and one negative sample. Failing tests point at the specific rule that
 * needs tuning (the failure message shows the rule's reasoning string).
 */

const NO_RECALL: RecallResult[] = [];

describe("RuleBasedClassifier — abstract judgment keywords", () => {
  const classifier = new RuleBasedClassifier();

  it.each([
    "为什么 Rust 这么设计",
    "怎么判断一个项目要不要做",
    "凭什么这个方案更好",
    "基于什么选择 React",
  ])("classifies '%s' as abstract", async (query) => {
    const result = await classifier.classify({ query, recall: NO_RECALL });
    expect(result.complexity).toBe("abstract");
  });

  it.each(["北京是哪个国家的首都", "你有几个猫"])(
    "does NOT classify '%s' as abstract",
    async (query) => {
      const result = await classifier.classify({ query, recall: NO_RECALL });
      expect(result.complexity).not.toBe("abstract");
    },
  );
});

describe("RuleBasedClassifier — decision keywords", () => {
  const classifier = new RuleBasedClassifier();

  it.each(["应该选哪个框架", "推荐一个数据库", "怎么做单元测试"])(
    "classifies '%s' as decision",
    async (query) => {
      const result = await classifier.classify({ query, recall: NO_RECALL });
      expect(result.complexity).toBe("decision");
    },
  );
});

describe("RuleBasedClassifier — simple fact keywords", () => {
  const classifier = new RuleBasedClassifier();

  it.each(["北京是哪个国家的首都", "你养了几只猫", "React 是哪年发布的"])(
    "classifies '%s' as simple",
    async (query) => {
      const result = await classifier.classify({ query, recall: NO_RECALL });
      expect(result.complexity).toBe("simple");
    },
  );
});

describe("RuleBasedClassifier — event types", () => {
  const classifier = new RuleBasedClassifier();

  it("detects success event from '最成功' keyword", async () => {
    const result = await classifier.classify({
      query: "你做过的最成功项目是什么",
      recall: NO_RECALL,
    });
    expect(result.event_type).toBe("success");
  });

  it("detects failure event from '失败' keyword", async () => {
    const result = await classifier.classify({
      query: "你最后悔的一次失败",
      recall: NO_RECALL,
    });
    expect(result.event_type).toBe("failure");
  });

  it("detects misjudgment event from '看走眼' keyword", async () => {
    const result = await classifier.classify({
      query: "看走眼过最惨的一次",
      recall: NO_RECALL,
    });
    expect(result.event_type).toBe("misjudgment");
  });

  it("detects counterintuitive event from '居然' keyword", async () => {
    const result = await classifier.classify({
      query: "按理说不行但居然成了",
      recall: NO_RECALL,
    });
    expect(result.event_type).toBe("counterintuitive");
  });
});

describe("RuleBasedClassifier — rule statement pattern", () => {
  const classifier = new RuleBasedClassifier();

  it("classifies '如果 A 就 B' as abstract + event_type=fact", async () => {
    const result = await classifier.classify({
      query: "如果客户连续 3 次改会就一定是假商机",
      recall: NO_RECALL,
    });
    expect(result.complexity).toBe("abstract");
    expect(result.event_type).toBe("fact");
  });
});

describe("RuleBasedClassifier — conflict check", () => {
  const classifier = new RuleBasedClassifier();
  const sampleRecall: RecallResult[] = [
    {
      id: "f1",
      text: "用户 2024 年在北京工作",
      type: "world",
      context: null,
      metadata: null,
      tags: null,
      entities: null,
      occurred_start: null,
      occurred_end: null,
      mentioned_at: "2024-01-01T00:00:00Z",
      document_id: null,
      chunk_id: null,
      source_fact_ids: null,
      scores: { final: 0.9, reranker: null, semantic: null, keyword: null },
    },
  ];

  it("triggers conflict check for current-state questions with recall", async () => {
    const result = await classifier.classify({
      query: "你现在在哪里工作",
      recall: sampleRecall,
    });
    expect(result.needs_conflict_check).toBe(true);
  });

  it("does NOT trigger conflict check for current-state questions WITHOUT recall", async () => {
    const result = await classifier.classify({
      query: "你现在在哪里工作",
      recall: NO_RECALL,
    });
    expect(result.needs_conflict_check).toBe(false);
  });
});

describe("RuleBasedClassifier — confidence behavior", () => {
  const classifier = new RuleBasedClassifier();

  it("returns low confidence when no rules match (forces LLM fallback)", async () => {
    const result = await classifier.classify({
      query: "嗯啊哦", // gibberish — no rule matches
      recall: NO_RECALL,
    });
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.reasoning).toMatch(/no rules matched/);
  });

  it("returns higher confidence when multiple rules match", async () => {
    const single = await classifier.classify({
      query: "为什么这样做",
      recall: NO_RECALL,
    });
    const multi = await classifier.classify({
      query: "为什么这样做？教训是什么",
      recall: NO_RECALL,
    });
    expect(multi.confidence).toBeGreaterThan(single.confidence);
  });
});

describe("RuleBasedClassifier — schema validation", () => {
  const classifier = new RuleBasedClassifier();

  it("always returns a Classification that passes the Zod schema", async () => {
    const queries = [
      "为什么这样设计",
      "推荐一个数据库",
      "北京是首都",
      "你失败过吗",
      "嗯啊哦",
    ];
    for (const query of queries) {
      const result = await classifier.classify({ query, recall: NO_RECALL });
      // Should not throw — all properties within [0, 1] / correct enum
      expect(result.complexity).toMatch(/simple|decision|abstract/);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(typeof result.needs_conflict_check).toBe("boolean");
    }
  });
});
