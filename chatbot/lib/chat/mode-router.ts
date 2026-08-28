/**
 * Mode router — decides whether a user turn should be served by the main
 * agent or routed to the interview agent.
 *
 * Phase 2 v1 policy:
 *   - recall has at least one fact  → 'main'  (LLM answers with memory context)
 *   - recall is empty               → 'interview' (no facts to draw from, ask)
 *
 * Future phases may extend this with:
 *   - LLM confidence check (main agent reports its own certainty)
 *   - complexity classifier (ROADMAP IA-2)
 *   - cost control (skip interview if user opted out)
 *
 * Pure function — no IO, no env reads. Test surface is small and stable.
 */
import type { RecallResponse } from "@/lib/hindsight";

export type ChatMode = "main" | "interview";

export function decideMode(recall: RecallResponse | null | undefined): ChatMode {
  // Defensive: a malformed recall (missing `results`) is treated as empty.
  // Recall failures already produce { results: [] } upstream, but third-party
  // callers may pass partial shapes.
  if (!recall || !Array.isArray(recall.results)) return "interview";
  if (recall.results.length === 0) return "interview";
  return "main";
}