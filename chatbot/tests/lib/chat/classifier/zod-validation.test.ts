import { describe, expect, it } from "vitest";

import { ClassificationSchema } from "@/lib/chat/classifier/types";

/**
 * Tests the Zod boundary: any Classification that crosses the boundary
 * (whether from rule-based, LLM, or future implementations) must pass
 * these invariants. If a test fails, the orchestrator is at risk of
 * feeding malformed data into the state machine.
 */

describe("ClassificationSchema — accepts valid shapes", () => {
  it("accepts minimal valid Classification", () => {
    const result = ClassificationSchema.parse({
      complexity: "abstract",
      needs_conflict_check: false,
      confidence: 0.85,
    });
    expect(result.complexity).toBe("abstract");
    expect(result.confidence).toBe(0.85);
  });

  it("accepts full Classification with all optional fields", () => {
    const result = ClassificationSchema.parse({
      complexity: "abstract",
      event_type: "success",
      needs_conflict_check: true,
      confidence: 0.7,
      reasoning: "matched 3 rules",
    });
    expect(result.event_type).toBe("success");
    expect(result.reasoning).toBe("matched 3 rules");
  });

  it("accepts boundary confidence values", () => {
    expect(
      ClassificationSchema.parse({
        complexity: "simple",
        needs_conflict_check: false,
        confidence: 0,
      }).confidence,
    ).toBe(0);
    expect(
      ClassificationSchema.parse({
        complexity: "simple",
        needs_conflict_check: false,
        confidence: 1,
      }).confidence,
    ).toBe(1);
  });
});

describe("ClassificationSchema — rejects invalid shapes", () => {
  it("rejects missing required complexity", () => {
    expect(() =>
      ClassificationSchema.parse({
        needs_conflict_check: false,
        confidence: 0.5,
      }),
    ).toThrow();
  });

  it("rejects missing required needs_conflict_check", () => {
    expect(() =>
      ClassificationSchema.parse({ complexity: "abstract", confidence: 0.5 }),
    ).toThrow();
  });

  it("rejects missing required confidence", () => {
    expect(() =>
      ClassificationSchema.parse({
        complexity: "abstract",
        needs_conflict_check: false,
      }),
    ).toThrow();
  });

  it("rejects unknown complexity values", () => {
    expect(() =>
      ClassificationSchema.parse({
        complexity: "TRICKY",
        needs_conflict_check: false,
        confidence: 0.5,
      }),
    ).toThrow();
  });

  it("rejects confidence > 1", () => {
    expect(() =>
      ClassificationSchema.parse({
        complexity: "abstract",
        needs_conflict_check: false,
        confidence: 1.5,
      }),
    ).toThrow();
  });

  it("rejects confidence < 0", () => {
    expect(() =>
      ClassificationSchema.parse({
        complexity: "abstract",
        needs_conflict_check: false,
        confidence: -0.1,
      }),
    ).toThrow();
  });

  it("rejects non-boolean needs_conflict_check", () => {
    expect(() =>
      ClassificationSchema.parse({
        complexity: "abstract",
        needs_conflict_check: "yes",
        confidence: 0.5,
      }),
    ).toThrow();
  });
});
