/**
 * LLMClassifier — uses qwen-plus to classify a query.
 *
 * Used as the fallback path in HybridClassifier. The LLM is told to output
 * strict JSON; the response is validated with `ClassificationSchema` so a
 * malformed answer throws at the boundary rather than silently corrupting
 * downstream state. A throw in classify() bubbles up — the caller (Hybrid)
 * decides whether to retry / abort / fall through.
 */

import type { RecallResult } from "@/lib/hindsight";

import {
  ClassificationSchema,
  type Classification,
  type ComplexityClassifier,
  type LLMClientDeps,
} from "./types";

const SYSTEM_PROMPT = `你是 chatbot 的问题分类助手。给定用户的问题和当前 recall 的相关 facts，按以下 JSON schema 输出分类结果（只输出 JSON，不要其他内容）：

{
  "complexity": "simple" | "decision" | "abstract",
  "event_type": "success" | "failure" | "misjudgment" | "counterintuitive" | "fact" | null,
  "needs_conflict_check": boolean,
  "confidence": 0-1 之间的数字,
  "reasoning": "一句话解释分类依据"
}

字段语义：
- complexity: simple=简单事实查询；decision=决策建议类；abstract=抽象判断/why/how/依据类
- event_type: 当问题涉及特定类型事件时填，否则 null
- needs_conflict_check: 当问题是"现在/目前"等时效性查询、且 recall 里有相关历史 facts 时填 true
- confidence: 你对这次分类的把握（0-1）`;

function buildUserPrompt(query: string, recall: RecallResult[]): string {
  const recallJson = JSON.stringify(
    recall.slice(0, 5).map((r) => ({
      text: r.text,
      type: r.type,
      score: r.scores?.final ?? null,
    })),
    null,
    2,
  );
  return `用户问题：${query}

Recall facts（最多 5 条）：
${recallJson}`;
}

export class LLMClassifier implements ComplexityClassifier {
  constructor(private readonly deps: LLMClientDeps) {}

  async classify(input: {
    query: string;
    recall: RecallResult[];
  }): Promise<Classification> {
    const text = await this.deps.complete({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(input.query, input.recall),
    });

    // The LLM sometimes wraps JSON in ```json ... ``` fences despite
    // instructions. Strip the fences before parsing.
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "");

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new Error(
        `LLMClassifier: LLM returned non-JSON: ${text.slice(0, 200)}`,
        { cause: err },
      );
    }

    // Validate against the Zod schema. Bad shape → throw (caller decides).
    return ClassificationSchema.parse(parsed);
  }
}
