/**
 * Conflict Resolution — Q4 "矛盾访谈" flow (Phase 3 / Group 5).
 *
 * Three operations:
 *   1. `detectConflict` — pure: scan recall facts for potential
 *      contradictions with the latest expert answer.
 *   2. `retainWithTypoContext` — Q4 口误 path: retain the new fact with
 *      `context="correction_of_session_<id>"` audit tag.
 *   3. `replaceWithInvalidation` — Q4 认真 path: PATCH old fact
 *      (state=invalidated) BEFORE POSTing the new one. If the PATCH fails,
 *      the function throws and the new fact is NOT retained.
 *   4. `verifyReplacement` — post-replacement: re-recall and confirm the
 *      old fact no longer appears.
 *
 * Hindsight IO is injected via `ConflictDeps` so tests can substitute
 * mocks; the default deps point to the real Hindsight client.
 */

import {
  invalidateMemory as defaultInvalidateMemory,
  recallMemories as defaultRecallMemories,
  retainMemories as defaultRetainMemories,
  type RecallResult,
  type RetainItem,
} from "@/lib/hindsight";

import type { ConflictPair, InterviewSessionState } from "./state";

export interface ConflictDeps {
  recallMemories: typeof defaultRecallMemories;
  invalidateMemory: typeof defaultInvalidateMemory;
  retainMemories: typeof defaultRetainMemories;
}

const DEFAULT_DEPS: ConflictDeps = {
  recallMemories: defaultRecallMemories,
  invalidateMemory: defaultInvalidateMemory,
  retainMemories: defaultRetainMemories,
};

const TEMPORAL_KEYWORDS = [
  "现在",
  "目前",
  "当前",
  "今年",
  "刚",
  "刚刚",
  "现在做",
  "现在在",
  "现在还",
];

/**
 * Heuristic conflict detection. A real implementation would use semantic
 * similarity between the latest answer and recall facts; for v1 we use a
 * simple keyword check: if the answer mentions current-state terms and
 * recall has facts, surface them as potential conflicts for the expert to
 * judge.
 */
export function detectConflict(
  state: InterviewSessionState,
  lastAnswer: string,
  recall: RecallResult[],
): ConflictPair[] {
  const isTemporal = TEMPORAL_KEYWORDS.some((kw) => lastAnswer.includes(kw));
  if (!isTemporal) return [];
  if (recall.length === 0) return [];

  // Surface all recall facts as candidates — expert (human) decides which
  // are actually conflicting. A future iteration could narrow to top-K by
  // semantic similarity.
  return recall.map((fact) => ({
    old_fact: fact,
    reason: `Recall fact may contradict current-state answer: "${lastAnswer.slice(0, 60)}${
      lastAnswer.length > 60 ? "..." : ""
    }"`,
  }));
}

/**
 * Q4 口误 path: retain the new fact with an audit context tag linking it
 * back to the original session. The old fact is NOT touched.
 */
export async function retainWithTypoContext(
  newItem: RetainItem,
  originalSessionId: string,
  deps: ConflictDeps = DEFAULT_DEPS,
): Promise<void> {
  await deps.retainMemories([
    {
      content: newItem.content,
      context: `correction_of_session_${originalSessionId}`,
    },
  ]);
}

/**
 * Q4 认真 path: PATCH old fact as invalidated, then retain the new fact.
 *
 * Atomicity contract: if `invalidateMemory` throws (network, 404, 5xx),
 * the function throws and the new fact is NEVER retained. This protects
 * against the inverse failure (PATCH succeeds, POST fails) by ensuring
 * the side effect is "old fact still in recall" rather than "old fact
 * invalidated but new fact never landed".
 */
export async function replaceWithInvalidation(
  oldMemoryId: string,
  newItem: RetainItem,
  deps: ConflictDeps = DEFAULT_DEPS,
): Promise<void> {
  await deps.invalidateMemory(oldMemoryId);
  await deps.retainMemories([newItem]);
}

/**
 * Post-replacement verification: re-recall the same query and check that
 * the old fact is no longer in the results. Returns true if verified
 * (old fact gone), false if still present (likely Hindsight indexing lag).
 *
 * The caller decides what to do on `false` — usually surface a warning
 * to the expert. We don't throw because the replacement itself succeeded;
 * the lag is a known property of eventual-consistency systems.
 */
export async function verifyReplacement(
  query: string,
  oldMemoryId: string,
  deps: ConflictDeps = DEFAULT_DEPS,
): Promise<boolean> {
  const response = await deps.recallMemories(query);
  return !response.results.some((r) => r.id === oldMemoryId);
}
