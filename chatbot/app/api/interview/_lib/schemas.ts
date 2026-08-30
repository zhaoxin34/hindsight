/**
 * Zod request/response schemas for the interview API routes.
 *
 * Centralized here so every route file imports the same shapes — drift
 * between routes is the most common API bug and Zod gives us free
 * 400-on-invalid-input semantics.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/** POST /api/interview/session — start a new interview */
export const createSessionSchema = z.object({
  bank_id: z.string().min(1),
  query: z.string().min(1).max(2000),
  classification: z
    .object({
      complexity: z.enum(["simple", "decision", "abstract"]),
      event_type: z
        .enum(["success", "failure", "misjudgment", "counterintuitive", "fact"])
        .optional(),
      needs_conflict_check: z.boolean(),
      confidence: z.number().min(0).max(1),
      reasoning: z.string().optional(),
    })
    .optional(), // server will re-classify if absent
});

/** PATCH /api/interview/session — advance session with a user action */
export const advanceSessionSchema = z.object({
  session_id: z.string().uuid(),
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("user_answer"), answer: z.string().min(1) }),
    z.object({ kind: z.literal("user_finish") }),
    z.object({ kind: z.literal("user_abandon") }),
    z.object({
      kind: z.literal("conflict_decision"),
      verdict: z.enum(["typo", "serious"]),
      old_fact_id: z.string().uuid(),
    }),
  ]),
});
