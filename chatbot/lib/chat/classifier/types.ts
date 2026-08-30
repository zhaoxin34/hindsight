/**
 * Complexity Classifier — Strategy pattern contract.
 *
 * Three independent classifier implementations live in this folder:
 *   - rule-based.ts  (default, no LLM cost)
 *   - llm.ts         (qwen-plus, used as fallback)
 *   - hybrid.ts      (rule-based first, falls back to llm at confidence < 0.6)
 *
 * The orchestrator (chatbot/lib/chat/mode-router.ts) injects whichever
 * classifier it wants via DI. To swap implementations (e.g. a fine-tuned
 * model later), change the binding in the route — no other code changes.
 */

import { z } from "zod";

import type { RecallResult } from "@/lib/hindsight";

/** Question complexity — drives interview round count. */
export const ComplexityEnum = z.enum(["simple", "decision", "abstract"]);
export type Complexity = z.infer<typeof ComplexityEnum>;

/** Interview event type — drives which prompt template to use. */
export const EventTypeEnum = z.enum([
  "success",
  "failure",
  "misjudgment",
  "counterintuitive",
  "fact",
]);
export type EventType = z.infer<typeof EventTypeEnum>;

/**
 * The classifier's output. Validated by Zod so a buggy LLM response
 * doesn't poison the orchestrator — invalid outputs throw at the boundary
 * instead of silently corrupting state.
 */
export const ClassificationSchema = z.object({
  complexity: ComplexityEnum,
  event_type: EventTypeEnum.optional(),
  needs_conflict_check: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export interface ComplexityClassifier {
  classify(input: {
    query: string;
    recall: RecallResult[];
  }): Promise<Classification>;
}

/** Shared deps for LLM-backed classifiers (rule-based doesn't need these). */
export interface LLMClientDeps {
  /** Returns raw text from qwen-plus given a system+user prompt. */
  complete(prompt: { system: string; user: string }): Promise<string>;
}

/** Fallback log writes — kept abstract so tests can inject an in-memory fake. */
export interface FallbackLog {
  record(entry: FallbackLogEntry): Promise<void>;
}

export interface FallbackLogEntry {
  /** Which classifier triggered fallback (e.g. "rule-based"). */
  source: string;
  query: string;
  /** Confidence the rule-based classifier returned (what failed the threshold). */
  ruleConfidence: number;
  /** What the LLM classifier returned (post-fallback). */
  llmResult: Classification;
}
