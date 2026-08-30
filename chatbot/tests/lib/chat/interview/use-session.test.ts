// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the useInterviewSession React hook. Mocks global fetch so we
 * can drive the state machine through start → answer → finished without a
 * real backend.
 */

import { useInterviewSession } from "@/lib/chat/interview/use-session";
import type { InterviewSessionState } from "@/lib/chat/interview/state";

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

function makeSession(
  overrides: Partial<InterviewSessionState> = {},
): InterviewSessionState {
  return {
    session_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    bank_id: "zhangwei",
    query: "为什么 Rust 这样设计",
    classification: {
      complexity: "abstract",
      event_type: "success",
      needs_conflict_check: false,
      confidence: 0.85,
    },
    turns: [],
    round: 1,
    maxRounds: 5,
    state: "active",
    started_at: "2026-08-29T00:00:00.000Z",
    updated_at: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("useInterviewSession — start", () => {
  it("transitions to active on successful start", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        session_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        state: makeSession(),
        ui: { kind: "ask_question", question: "第一个问题？" },
      }),
    );

    const { result } = renderHook(() => useInterviewSession());
    await act(async () => {
      await result.current.start("为什么 Rust 这样设计");
    });

    expect(result.current.state.kind).toBe("active");
    if (result.current.state.kind === "active") {
      expect(result.current.state.question).toBe("第一个问题？");
    }
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/interview/session",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("transitions to error when start fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "multi-turn interview is disabled" }, 404),
    );

    const { result } = renderHook(() => useInterviewSession());
    await act(async () => {
      await result.current.start("test");
    });

    expect(result.current.state.kind).toBe("error");
  });
});

describe("useInterviewSession — answer", () => {
  it("advances to next question on ask_question UI", async () => {
    // First mock: POST /api/interview/session (start)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        session_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        state: makeSession(),
        ui: { kind: "ask_question", question: "first" },
      }),
    );
    // Second mock: PATCH /api/interview/session (answer)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        state: makeSession({ round: 2 }),
        ui: { kind: "ask_question", question: "第二个问题？" },
      }),
    );

    const { result } = renderHook(() => useInterviewSession());
    await act(async () => {
      await result.current.start("test");
    });

    await act(async () => {
      await result.current.answer("因为内存安全");
    });

    expect(result.current.state.kind).toBe("active");
    if (result.current.state.kind === "active") {
      expect(result.current.state.question).toBe("第二个问题？");
    }
  });

  it("no-ops when not in active/conflict state", async () => {
    const { result } = renderHook(() => useInterviewSession());
    await act(async () => {
      await result.current.answer("test");
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useInterviewSession — finish", () => {
  it("transitions to finished with items", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        state: makeSession({ round: 3 }),
        ui: {
          kind: "finished",
          items: [{ content: "fact 1", context: "q1" }],
        },
      }),
    );

    const { result } = renderHook(() => useInterviewSession());
    // Bootstrap active state
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        session_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        state: makeSession(),
        ui: { kind: "ask_question", question: "q" },
      }),
    );
    await act(async () => {
      await result.current.start("test");
    });

    await act(async () => {
      await result.current.finish();
    });

    expect(result.current.state.kind).toBe("finished");
  });
});

describe("useInterviewSession — abandon", () => {
  it("transitions to abandoned", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        state: makeSession(),
        ui: { kind: "abandoned" },
      }),
    );

    const { result } = renderHook(() => useInterviewSession());
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        session_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        state: makeSession(),
        ui: { kind: "ask_question", question: "q" },
      }),
    );
    await act(async () => {
      await result.current.start("test");
    });

    await act(async () => {
      await result.current.abandon();
    });

    expect(result.current.state.kind).toBe("abandoned");
  });
});

describe("useInterviewSession — reset", () => {
  it("returns to idle state", async () => {
    const { result } = renderHook(() => useInterviewSession());
    act(() => {
      result.current.reset();
    });
    expect(result.current.state.kind).toBe("idle");
  });
});
