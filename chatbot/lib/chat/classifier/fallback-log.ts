/**
 * Postgres-backed FallbackLog for HybridClassifier.
 *
 * Persists every fallback (rule-based → LLM) so Phase 6 can analyse:
 *   - which queries fall through (rule coverage gaps)
 *   - which fallbacks produce low LLM confidence (hard samples)
 *
 * The implementation is intentionally minimal: one INSERT per fallback.
 * Phase 6 may add batching / sampling, but YAGNI for v1.
 */

import { sql } from "@/lib/db/client";

import type { FallbackLog, FallbackLogEntry } from "./types";

export class PostgresFallbackLog implements FallbackLog {
  async record(entry: FallbackLogEntry): Promise<void> {
    await sql`
      INSERT INTO chatbot_interview.classifier_fallback_log
        (source, query, rule_confidence, llm_result)
      VALUES
        (${entry.source}, ${entry.query}, ${entry.ruleConfidence}, ${sql.json(entry.llmResult)})
    `;
  }
}

/** Convenience: no-op log for tests / dev mode. */
export const noopFallbackLog: FallbackLog = {
  record: async () => {},
};
