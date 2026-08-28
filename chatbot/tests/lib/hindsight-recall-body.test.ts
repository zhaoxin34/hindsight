import { describe, expect, it } from "vitest";
import { buildRecallRequestBody } from "@/lib/hindsight";

/**
 * Tests for the pure request-body builder. Locks the default-merging logic
 * so that product decisions (which options default to what) are explicit
 * and reviewable in CI.
 *
 * The shallow fetch wrapper `recallMemories()` is not unit-tested here —
 * testing it requires mocking `fetch` and gets little leverage over these
 * tests; integration coverage belongs at the route layer (Phase 2).
 */

describe("buildRecallRequestBody — defaults", () => {
  it("uses observation+world fact types by default", () => {
    const body = buildRecallRequestBody("query");
    expect(body.types).toEqual(["observation", "world"]);
  });

  it("prefers observations over raw facts by default", () => {
    const body = buildRecallRequestBody("query");
    expect(body.prefer_observations).toBe(true);
  });

  it("uses mid budget by default", () => {
    const body = buildRecallRequestBody("query");
    expect(body.budget).toBe("mid");
  });

  it("uses 2048 max_tokens by default", () => {
    const body = buildRecallRequestBody("query");
    expect(body.max_tokens).toBe(2048);
  });

  it("includes entities with max_tokens 500 by default", () => {
    const body = buildRecallRequestBody("query");
    expect(body.include.entities).toEqual({ max_tokens: 500 });
  });

  it("applies the reranker floor of 0.3 by default", () => {
    const body = buildRecallRequestBody("query");
    expect(body.min_scores).toEqual({ reranker: 0.3 });
  });

  it("does not include query_timestamp by default", () => {
    const body = buildRecallRequestBody("query");
    expect(body).not.toHaveProperty("query_timestamp");
  });
});

describe("buildRecallRequestBody — overrides", () => {
  it("honors a custom types array", () => {
    const body = buildRecallRequestBody("query", {
      types: ["experience"],
    });
    expect(body.types).toEqual(["experience"]);
  });

  it("honors preferObservations: false", () => {
    const body = buildRecallRequestBody("query", { preferObservations: false });
    expect(body.prefer_observations).toBe(false);
  });

  it("honors a custom budget", () => {
    expect(buildRecallRequestBody("query", { budget: "low" }).budget).toBe(
      "low",
    );
    expect(buildRecallRequestBody("query", { budget: "high" }).budget).toBe(
      "high",
    );
  });

  it("honors a custom maxTokens", () => {
    const body = buildRecallRequestBody("query", { maxTokens: 8192 });
    expect(body.max_tokens).toBe(8192);
  });

  it("turns off entity inclusion when includeEntities is explicitly false", () => {
    const body = buildRecallRequestBody("query", { includeEntities: false });
    expect(body.include.entities).toBe(false);
  });

  it("keeps entity inclusion when includeEntities is true", () => {
    const body = buildRecallRequestBody("query", { includeEntities: true });
    expect(body.include.entities).toEqual({ max_tokens: 500 });
  });

  it("disables the reranker floor when minScores is empty", () => {
    const body = buildRecallRequestBody("query", { minScores: {} });
    expect(body.min_scores).toEqual({});
  });

  it("lets a caller set per-stage floors individually", () => {
    const body = buildRecallRequestBody("query", {
      minScores: { semantic: 0.5, reranker: 0.7 },
    });
    expect(body.min_scores).toEqual({ semantic: 0.5, reranker: 0.7 });
  });

  it("includes query_timestamp when provided", () => {
    const body = buildRecallRequestBody("query", {
      queryTimestamp: "2026-08-28T12:00:00Z",
    });
    expect(body.query_timestamp).toBe("2026-08-28T12:00:00Z");
  });
});

describe("buildRecallRequestBody — payload integrity", () => {
  it("always echoes the query verbatim", () => {
    const body = buildRecallRequestBody("张伟在哪里工作？");
    expect(body.query).toBe("张伟在哪里工作？");
  });

  it("does not mutate the caller's options object", () => {
    const options: { types: ("world" | "experience" | "observation")[] } = {
      types: ["experience"],
    };
    buildRecallRequestBody("query", options);
    expect(options).toEqual({ types: ["experience"] });
  });

  it("does not leak other defaults into the body", () => {
    const body = buildRecallRequestBody("query");
    expect(Object.keys(body).sort()).toEqual(
      [
        "budget",
        "include",
        "max_tokens",
        "min_scores",
        "prefer_observations",
        "query",
        "types",
      ].sort(),
    );
  });
});
