/**
 * Mode router — decides whether a user turn should be served by the main
 * agent or routed to the interview agent.
 *
 * Phase 2 v1 policy (`decideMode`):
 *   - recall has at least one fact  → 'main'  (LLM answers with memory context)
 *   - recall is empty               → 'interview' (no facts to draw from, ask)
 *
 * Phase 3 policy (`decideModeWithClassifier`):
 *   - recall has facts                → 'main' (we have context, use it)
 *   - recall empty + complexity simple → 'main' (LLM will say "I don't
 *                                         know"; no need to start a multi-
 *                                         turn interview for a fact lookup)
 *   - recall empty + complexity decision / abstract → 'interview'
 *
 * Feature flag: when `multiTurnEnabled` is false, the async function
 * falls back to the Phase 2 binary logic. The flag is read at call time
 * (not module load) via `isMultiTurnEnabledLive()` so tests can override
 * it via `setMultiTurnEnabledForTest` without `vi.mock` leakage.
 */

import type { ComplexityClassifier } from "@/lib/chat/classifier/types";
import type { RecallResponse } from "@/lib/hindsight";
import { isMultiTurnEnabledLive } from "@/app/api/interview/_lib/config";

export type ChatMode = "main" | "interview";

/** Phase 2 binary logic — pure function, no IO. */
export function decideMode(
  recall: RecallResponse | null | undefined,
): ChatMode {
  // Defensive: a malformed recall (missing `results`) is treated as empty.
  // Recall failures already produce { results: [] } upstream, but third-party
  // callers may pass partial shapes.
  if (!recall || !Array.isArray(recall.results)) return "interview";
  if (recall.results.length === 0) return "interview";
  return "main";
}

export interface ModeDecision {
  mode: ChatMode;
  /** Optional — when the classifier ran, the raw classification. */
  classification?: import("@/lib/chat/classifier/types").Classification;
}

/**
 * Phase 3 smarter routing. Uses the ComplexityClassifier to avoid
 * triggering a multi-turn interview for trivial fact lookups that the
 * LLM can honestly answer "I don't know" to.
 *
 * Returns a `ModeDecision` so the route can also pass the classification
 * downstream (e.g., to the state machine for multi-round planning).
 */
export async function decideModeWithClassifier(
  query: string,
  recall: RecallResponse | null | undefined,
  classifier: ComplexityClassifier,
  enabled: boolean = isMultiTurnEnabledLive(),
): Promise<ModeDecision> {
  // Flag off: behave like Phase 2.
  if (!enabled) {
    return { mode: decideMode(recall) };
  }

  // Recall has facts → main (use the context).
  if (recall && Array.isArray(recall.results) && recall.results.length > 0) {
    return { mode: "main" };
  }

  // Recall empty: classify to decide whether to start an interview.
  const classification = await classifier.classify({ query, recall: [] });

  // Simple fact lookup → LLM will honestly say "I don't know"; no need
  // to start a multi-turn interview. Decision/abstract questions benefit
  // from the interview flow.
  if (classification.complexity === "simple") {
    return { mode: "main", classification };
  }
  return { mode: "interview", classification };
}
