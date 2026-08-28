import { describe, expect, it } from "vitest";
import { decideMode } from "@/lib/chat/mode-router";
import type { RecallResponse, RecallResult } from "@/lib/hindsight";

const FACT: RecallResult = {
  id: "f1",
  text: "张伟在 Datatist 工作",
  type: "observation",
  context: null,
  metadata: null,
  tags: null,
  entities: null,
  occurred_start: null,
  occurred_end: null,
  mentioned_at: null,
  document_id: null,
  chunk_id: null,
  source_fact_ids: null,
  scores: null,
};

describe("decideMode", () => {
  it("routes to main when recall has at least one fact", () => {
    expect(decideMode({ results: [FACT] })).toBe("main");
  });

  it("routes to interview when recall is empty", () => {
    expect(decideMode({ results: [] })).toBe("interview");
  });

  it("routes to interview when recall is null", () => {
    expect(decideMode(null)).toBe("interview");
  });

  it("routes to interview when recall is undefined", () => {
    expect(decideMode(undefined)).toBe("interview");
  });

  it("routes to interview when recall.results is missing", () => {
    expect(decideMode({} as RecallResponse)).toBe("interview");
  });

  it("routes to interview when recall.results is not an array", () => {
    expect(
      decideMode({ results: "not an array" } as unknown as RecallResponse),
    ).toBe("interview");
  });

  it("does not consider source_facts when deciding mode", () => {
    // Even if source_facts is populated, only `results` drives the decision.
    expect(decideMode({ results: [], source_facts: { a: FACT } })).toBe(
      "interview",
    );
    expect(decideMode({ results: [FACT], source_facts: {} })).toBe("main");
  });

  it("is a pure function (no mutation of input)", () => {
    const recall: RecallResponse = { results: [FACT] };
    decideMode(recall);
    expect(recall.results).toEqual([FACT]);
  });
});