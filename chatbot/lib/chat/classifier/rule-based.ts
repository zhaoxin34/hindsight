/**
 * RuleBasedClassifier — default ComplexityClassifier implementation.
 *
 * Composes 10 small rules, each one a pure function that inspects the query
 * (and optionally the recall results) and returns a partial Classification.
 * A rule that doesn't fire returns null. The classifier aggregates the
 * matched fragments and emits a confidence score in [0, 1].
 *
 * If ZERO rules match the query, we deliberately return a low-confidence
 * result so the HybridClassifier falls back to the LLM — that's the
 * "灰区 default to LLM" design (设计文档 D2 防作死原则).
 *
 * Why so many rules and not one mega-regex: each rule is independently
 * unit-testable (see tests/lib/chat/classifier/rule-based.test.ts), and the
 * rule set is the audit surface for "why did this query land where it did"
 * — easier to evolve than a single opaque expression.
 */

import type { RecallResult } from "@/lib/hindsight";

import {
  ClassificationSchema,
  type Classification,
  type ComplexityClassifier,
} from "./types";

type Rule = (input: {
  query: string;
  recall: RecallResult[];
}) => Partial<Classification> | null;

/** Match any of the substrings (case-insensitive). */
function hasAny(haystack: string, needles: readonly string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Complexity rules — first match wins for `complexity`.
// ---------------------------------------------------------------------------

/** Abstract judgment / "why" / "how do you decide" questions. */
const abstractJudgmentKeywords: Rule = ({ query }) => {
  if (
    hasAny(query, [
      "为什么",
      "怎么判断",
      "凭什么",
      "基于什么",
      "理由",
      "考虑因素",
      "决定因素",
    ])
  ) {
    return { complexity: "abstract", reasoning: "abstract judgment keywords" };
  }
  return null;
};

/** Decision / recommendation questions. */
const decisionKeywords: Rule = ({ query }) => {
  if (
    hasAny(query, [
      "应该",
      "建议",
      "怎么做",
      "如何选",
      "怎么选",
      "哪种",
      "推荐",
    ])
  ) {
    return { complexity: "decision", reasoning: "decision keywords" };
  }
  return null;
};

/** Simple fact lookup. */
const simpleFactKeywords: Rule = ({ query }) => {
  if (
    hasAny(query, [
      "是什么",
      "多少",
      "什么时候",
      "哪个",
      "哪年",
      "哪天",
      "在哪",
      "谁是",
      "几年",
      "几号",
      "几个",
      "几岁",
      "多少个",
    ]) ||
    // "几 + 量词" or "多少 + 量词" — common Chinese fact-lookup pattern
    /几[只条张次本件位家台个]/.test(query) ||
    /多少[只条张次本件位家台个]/.test(query)
  ) {
    return { complexity: "simple", reasoning: "simple fact keywords" };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Event-type rules — additional classification beyond complexity.
// ---------------------------------------------------------------------------

const eventSuccessKeywords: Rule = ({ query }) =>
  hasAny(query, ["最好", "最成功", "最有效", "最满意", "最得意"])
    ? { event_type: "success", reasoning: "success keywords" }
    : null;

const eventFailureKeywords: Rule = ({ query }) =>
  hasAny(query, ["失败", "搞砸", "翻车", "教训", "踩坑", "最差"])
    ? { event_type: "failure", reasoning: "failure keywords" }
    : null;

const eventMisjudgmentKeywords: Rule = ({ query }) =>
  hasAny(query, ["看走眼", "误判", "判断错", "判断失误", "错了", "失算"])
    ? { event_type: "misjudgment", reasoning: "misjudgment keywords" }
    : null;

const eventCounterintuitiveKeywords: Rule = ({ query }) =>
  hasAny(query, ["按理说不行但", "没想到", "居然", "反常", "反直觉", "奇怪"])
    ? { event_type: "counterintuitive", reasoning: "counterintuitive keywords" }
    : null;

/** "如果 A 就 B" — declarative rule pattern — these are abstract (rules). */
const ruleStatementPattern: Rule = ({ query }) => {
  if (/如果.{1,30}就.{1,30}[。？?]?$/.test(query.trim())) {
    return {
      complexity: "abstract",
      event_type: "fact",
      reasoning: "rule statement pattern",
    };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Conflict-check rule — current-state questions may contradict older facts.
// ---------------------------------------------------------------------------

const currentStateKeywords: Rule = ({ query, recall }) => {
  const hasCurrentStateTerm = hasAny(query, [
    "现在",
    "目前",
    "当前",
    "今年",
    "现在还在",
    "现在做",
    "现在在",
  ]);
  if (!hasCurrentStateTerm) return null;
  if (recall.length === 0) return null;
  // Recall has facts AND query asks about current state → potential conflict.
  return {
    needs_conflict_check: true,
    reasoning: "current-state question against recall facts",
  };
};

const RULES: readonly Rule[] = [
  abstractJudgmentKeywords,
  decisionKeywords,
  ruleStatementPattern, // rule-statement pattern is more specific than generic keywords
  simpleFactKeywords,
  eventSuccessKeywords,
  eventFailureKeywords,
  eventMisjudgmentKeywords,
  eventCounterintuitiveKeywords,
  currentStateKeywords,
];

/**
 * Aggregate matched rules into a single Classification. Each matched rule
 * contributes its partial fields; `complexity` and `event_type` come from
 * the first rule that fired (order in RULES matters). Confidence scales
 * with how many rules matched — one match ≈ 0.7, two ≈ 0.8, etc.
 */
export class RuleBasedClassifier implements ComplexityClassifier {
  async classify(input: {
    query: string;
    recall: RecallResult[];
  }): Promise<Classification> {
    const matched: Partial<Classification>[] = [];
    for (const rule of RULES) {
      const partial = rule(input);
      if (partial) matched.push(partial);
    }

    if (matched.length === 0) {
      // Deliberately return low confidence so HybridClassifier falls back
      // to LLM. This is the "灰区 → LLM" design decision (design D2).
      return ClassificationSchema.parse({
        complexity: "abstract",
        needs_conflict_check: false,
        confidence: 0.3,
        reasoning: "no rules matched → force LLM fallback",
      });
    }

    // Merge: later rules can override earlier ones only if they explicitly
    // set a field. We keep the FIRST non-undefined value for complexity and
    // event_type (since RULES is ordered by specificity).
    const merged: Partial<Classification> = {};
    for (const m of matched) {
      for (const [k, v] of Object.entries(m)) {
        if (
          v !== undefined &&
          (merged as Record<string, unknown>)[k] === undefined
        ) {
          (merged as Record<string, unknown>)[k] = v;
        }
      }
    }

    // Confidence: 0.7 base + 0.1 per extra match, capped at 0.95.
    const confidence = Math.min(0.95, 0.6 + 0.1 * matched.length);

    return ClassificationSchema.parse({
      complexity: merged.complexity ?? "abstract",
      event_type: merged.event_type,
      needs_conflict_check: merged.needs_conflict_check ?? false,
      confidence,
      reasoning: merged.reasoning,
    });
  }
}
