import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the two new Hindsight client methods introduced in Phase 3:
 *   - invalidateMemory(memoryId) — PATCH /memories/{id} {state: "invalidated"}
 *   - dryRunExtract(content, context) — POST /memories/dry-run-extract
 *
 * Both call `fetch` via the `request()` helper in lib/hindsight.ts. We mock
 * the global `fetch` to assert URL, method, and body without hitting a
 * real Hindsight server.
 */

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("invalidateMemory", () => {
  it("calls PATCH on the right URL with state=invalidated", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    const { invalidateMemory } = await import("@/lib/hindsight");
    await invalidateMemory("00000000-0000-0000-0000-000000000001");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(
      /\/v1\/default\/banks\/zhangwei\/memories\/00000000-0000-0000-0000-000000000001$/,
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ state: "invalidated" });
  });

  it("throws HindsightError on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "not found" }, 404));

    const { invalidateMemory, HindsightError } =
      await import("@/lib/hindsight");
    await expect(invalidateMemory("missing-id")).rejects.toBeInstanceOf(
      HindsightError,
    );
  });

  it("throws HindsightError when fetch rejects (network)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const { invalidateMemory, HindsightError } =
      await import("@/lib/hindsight");
    await expect(invalidateMemory("any-id")).rejects.toBeInstanceOf(
      HindsightError,
    );
  });
});

describe("dryRunExtract", () => {
  it("POSTs content + context to the right URL and returns facts", async () => {
    const mockFacts = [
      {
        text: "赵鑫在深圳做数据科学家",
        fact_type: "world",
        occurred_start: null,
        occurred_end: null,
        entities: ["赵鑫", "深圳"],
      },
      {
        text: "赵鑫业余时间喜欢爬山",
        fact_type: "experience",
        occurred_start: null,
        occurred_end: null,
        entities: ["赵鑫"],
      },
    ];
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        facts: mockFacts,
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    );

    const { dryRunExtract } = await import("@/lib/hindsight");
    const facts = await dryRunExtract(
      "赵鑫说他在深圳做数据科学家，业余时间喜欢爬山",
      "interview_session_004",
    );

    expect(facts).toEqual(mockFacts);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(
      /\/v1\/default\/banks\/zhangwei\/memories\/dry-run-extract$/,
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      content: "赵鑫说他在深圳做数据科学家，业余时间喜欢爬山",
      context: "interview_session_004",
    });
  });

  it("returns [] when Hindsight extracts no facts", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ facts: [] }));

    const { dryRunExtract } = await import("@/lib/hindsight");
    const facts = await dryRunExtract("完全无关的内容", "ctx");
    expect(facts).toEqual([]);
  });

  it("throws HindsightError on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "rate limit" }, 429),
    );

    const { dryRunExtract, HindsightError } = await import("@/lib/hindsight");
    await expect(dryRunExtract("content", "ctx")).rejects.toBeInstanceOf(
      HindsightError,
    );
  });
});
