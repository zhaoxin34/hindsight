/**
 * Recall helper used by the interview routes.
 *
 * Wraps `recallMemories` from `@/lib/hindsight` and unwraps the
 * `RecallResponse` envelope to give callers a flat `RecallResult[]`.
 * Falls back to `[]` on Hindsight errors so the rest of the engine
 * (which only uses recall for conflict detection) keeps working when
 * Hindsight is briefly down.
 */

import { recallMemories, type RecallResult } from "@/lib/hindsight";

const EMPTY: RecallResult[] = [];

export async function recallMemoriesForQuery(
  query: string,
  _bankId: string,
): Promise<RecallResult[]> {
  try {
    const response = await recallMemories(query);
    return response.results;
  } catch {
    return EMPTY;
  }
}
