import { describe, expect, it } from "vitest";

/**
 * Schema-level tests for the interview API request shapes.
 *
 * The full HTTP integration tests are intentionally limited — Next.js
 * route handlers require significant mocking infrastructure (NextRequest,
 * Hindsight, Postgres) and the integration paths are better covered by
 * e2e tests in Group 10. Here we test the Zod boundary that every request
 * must cross.
 */

import {
  advanceSessionSchema,
  createSessionSchema,
} from "@/app/api/interview/_lib/schemas";

// Valid UUID v4 used in tests (all-zero UUIDs fail the version-digit check
// in zod's `z.string().uuid()`).
const VALID_UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const OTHER_UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d480";

describe("createSessionSchema", () => {
  it("accepts minimal valid request", () => {
    const result = createSessionSchema.safeParse({
      bank_id: "zhangwei",
      query: "为什么 Rust 这样设计",
    });
    expect(result.success).toBe(true);
  });

  it("accepts request with explicit classification", () => {
    const result = createSessionSchema.safeParse({
      bank_id: "zhangwei",
      query: "q",
      classification: {
        complexity: "abstract",
        event_type: "success",
        needs_conflict_check: false,
        confidence: 0.85,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty bank_id", () => {
    const result = createSessionSchema.safeParse({ bank_id: "", query: "q" });
    expect(result.success).toBe(false);
  });

  it("rejects empty query", () => {
    const result = createSessionSchema.safeParse({ bank_id: "x", query: "" });
    expect(result.success).toBe(false);
  });

  it("rejects query over 2000 chars", () => {
    const result = createSessionSchema.safeParse({
      bank_id: "x",
      query: "a".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown complexity value", () => {
    const result = createSessionSchema.safeParse({
      bank_id: "x",
      query: "q",
      classification: {
        complexity: "TRICKY",
        needs_conflict_check: false,
        confidence: 0.5,
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence out of [0, 1]", () => {
    const result = createSessionSchema.safeParse({
      bank_id: "x",
      query: "q",
      classification: {
        complexity: "abstract",
        needs_conflict_check: false,
        confidence: 1.5,
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("advanceSessionSchema", () => {
  it("accepts user_answer action", () => {
    const result = advanceSessionSchema.safeParse({
      session_id: VALID_UUID,
      action: { kind: "user_answer", answer: "因为内存安全" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts user_finish action", () => {
    const result = advanceSessionSchema.safeParse({
      session_id: VALID_UUID,
      action: { kind: "user_finish" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts user_abandon action", () => {
    const result = advanceSessionSchema.safeParse({
      session_id: VALID_UUID,
      action: { kind: "user_abandon" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts conflict_decision(typo)", () => {
    const result = advanceSessionSchema.safeParse({
      session_id: VALID_UUID,
      action: {
        kind: "conflict_decision",
        verdict: "typo",
        old_fact_id: OTHER_UUID,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts conflict_decision(serious)", () => {
    const result = advanceSessionSchema.safeParse({
      session_id: VALID_UUID,
      action: {
        kind: "conflict_decision",
        verdict: "serious",
        old_fact_id: OTHER_UUID,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID session_id", () => {
    const result = advanceSessionSchema.safeParse({
      session_id: "not-a-uuid",
      action: { kind: "user_finish" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects user_answer without answer field", () => {
    const result = advanceSessionSchema.safeParse({
      session_id: VALID_UUID,
      action: { kind: "user_answer" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects conflict_decision without old_fact_id", () => {
    const result = advanceSessionSchema.safeParse({
      session_id: VALID_UUID,
      action: { kind: "conflict_decision", verdict: "typo" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects conflict_decision with invalid verdict", () => {
    const result = advanceSessionSchema.safeParse({
      session_id: VALID_UUID,
      action: {
        kind: "conflict_decision",
        verdict: "MAYBE",
        old_fact_id: OTHER_UUID,
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown action kind", () => {
    const result = advanceSessionSchema.safeParse({
      session_id: VALID_UUID,
      action: { kind: "user_pretend" },
    });
    expect(result.success).toBe(false);
  });
});
