/**
 * HybridClassifier — wraps RuleBasedClassifier + LLMClassifier.
 *
 * Flow:
 *   1. Run rule-based classification.
 *   2. If rule-based confidence >= threshold (default 0.6), return it.
 *   3. Otherwise, record the fallback to the FallbackLog and call the
 *      LLM classifier. Return the LLM result.
 *
 * The threshold is configurable so Phase 6 eval can tune it against a
 * labelled corpus. Default 0.6 was picked to match design.md D2.
 *
 * Fallback log writes are best-effort — a log failure does NOT fail the
 * classify() call (the user is still waiting for an answer).
 */

import type { RecallResult } from "@/lib/hindsight";

import { LLMClassifier } from "./llm";
import { RuleBasedClassifier } from "./rule-based";
import {
  type Classification,
  type ComplexityClassifier,
  type FallbackLog,
  type LLMClientDeps,
} from "./types";

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

export interface HybridClassifierDeps {
  ruleBased: RuleBasedClassifier;
  llm: LLMClientDeps;
  /** Optional — when present, fallback events are persisted for Phase 6 eval. */
  log?: FallbackLog;
  threshold?: number;
}

export class HybridClassifier implements ComplexityClassifier {
  private readonly ruleBased: RuleBasedClassifier;
  private readonly llm: LLMClassifier;
  private readonly log: FallbackLog | undefined;
  private readonly threshold: number;

  constructor(deps: HybridClassifierDeps) {
    this.ruleBased = deps.ruleBased;
    this.llm = new LLMClassifier(deps.llm);
    this.log = deps.log;
    this.threshold = deps.threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  }

  async classify(input: {
    query: string;
    recall: RecallResult[];
  }): Promise<Classification> {
    const ruleResult = await this.ruleBased.classify(input);

    if (ruleResult.confidence >= this.threshold) {
      return ruleResult;
    }

    // Fallback path — call LLM.
    const llmResult = await this.llm.classify(input);

    // Best-effort log write. Never let logging fail the classification.
    if (this.log) {
      try {
        await this.log.record({
          source: "rule-based",
          query: input.query,
          ruleConfidence: ruleResult.confidence,
          llmResult,
        });
      } catch {
        // Swallow — log failures must not break the user-facing flow.
      }
    }

    return llmResult;
  }
}
