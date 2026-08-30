import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  replaceWithInvalidation,
  retainWithTypoContext,
  verifyReplacement,
  type ConflictDeps,
} from "@/lib/chat/interview/conflict";
import { HindsightError } from "@/lib/hindsight";
import type { RecallResult, RetainItem } from "@/lib/hindsight";

/**
 * Q4 path tests — covers typo retention, serious replacement, and
 * post-replacement verification. Uses mocked ConflictDeps to keep the
 * tests independent of any real Hindsight instance.
 */

function makeMockDeps(overrides: Partial<ConflictDeps> = {}): {
  deps: ConflictDeps;
  retain: ReturnType<typeof vi.fn>;
  invalidate: ReturnType<typeof vi.fn>;
  recall: ReturnType<typeof vi.fn>;
} {
  const retain = vi.fn().mockResolvedValue({ success: true });
  const invalidate = vi.fn().mockResolvedValue(undefined);
  const recall = vi.fn().mockResolvedValue([]);
  const deps: ConflictDeps = {
    retainMemories: retain as unknown as ConflictDeps["retainMemories"],
    invalidateMemory: invalidate as unknown as ConflictDeps["invalidateMemory"],
    recallMemories: recall as unknown as ConflictDeps["recallMemories"],
    ...overrides,
  };
  return { deps, retain, invalidate, recall };
}

const newItem: RetainItem = {
  content: "用户 2026 年在深圳工作",
  context: "interview_session_replace_test",
};

describe("retainWithTypoContext (Q4 typo path)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retains the new fact with correction_of_session_<id> context tag", async () => {
    const { deps, retain } = makeMockDeps();

    await retainWithTypoContext(newItem, "session-abc", deps);

    expect(retain).toHaveBeenCalledTimes(1);
    expect(retain).toHaveBeenCalledWith([
      {
        content: newItem.content,
        context: "correction_of_session_session-abc",
      },
    ]);
  });

  it("does NOT call invalidateMemory (old fact untouched)", async () => {
    const { deps, invalidate } = makeMockDeps();
    await retainWithTypoContext(newItem, "session-abc", deps);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("replaceWithInvalidation (Q4 serious path)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls invalidate BEFORE retain (atomicity order)", async () => {
    const { deps, retain, invalidate } = makeMockDeps();

    await replaceWithInvalidation("old-fact-id", newItem, deps);

    expect(invalidate).toHaveBeenCalledWith("old-fact-id");
    expect(retain).toHaveBeenCalledWith([newItem]);

    // Verify ordering: invalidate was called before retain.
    const invalidateOrder = invalidate.mock.invocationCallOrder[0];
    const retainOrder = retain.mock.invocationCallOrder[0];
    expect(invalidateOrder).toBeLessThan(retainOrder);
  });

  it("throws and does NOT retain when invalidate fails", async () => {
    const { deps, retain, invalidate } = makeMockDeps({
      invalidateMemory: vi
        .fn()
        .mockRejectedValue(
          new HindsightError(404, "memory not found"),
        ) as unknown as ConflictDeps["invalidateMemory"],
    });

    await expect(
      replaceWithInvalidation("missing-id", newItem, deps),
    ).rejects.toThrow(/memory not found/);

    expect(retain).not.toHaveBeenCalled();
  });

  it("propagates retain failures (PATCH succeeded, POST failed) — caller decides", async () => {
    const { deps, retain, invalidate } = makeMockDeps({
      retainMemories: vi
        .fn()
        .mockRejectedValue(
          new HindsightError(500, "internal"),
        ) as unknown as ConflictDeps["retainMemories"],
    });

    await expect(
      replaceWithInvalidation("old-id", newItem, deps),
    ).rejects.toThrow(/internal/);

    // Invalidate WAS called (it succeeded) — this is the "PATCH ok / POST fail"
    // partial state the caller must reconcile.
    expect(invalidate).toHaveBeenCalledWith("old-id");
  });
});

describe("verifyReplacement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when old fact is NOT in recall results", async () => {
    const recallFn = vi.fn().mockResolvedValue({
      results: [{ id: "other-fact", text: "something else" } as RecallResult],
    });
    const { deps } = makeMockDeps({
      recallMemories: recallFn as unknown as ConflictDeps["recallMemories"],
    });

    const ok = await verifyReplacement("用户在哪里工作", "old-id", deps);
    expect(ok).toBe(true);
    expect(recallFn).toHaveBeenCalledWith("用户在哪里工作");
  });

  it("returns false when old fact IS still in recall (eventual consistency lag)", async () => {
    const recallFn = vi.fn().mockResolvedValue({
      results: [{ id: "old-id", text: "old fact" } as RecallResult],
    });
    const { deps } = makeMockDeps({
      recallMemories: recallFn as unknown as ConflictDeps["recallMemories"],
    });

    const ok = await verifyReplacement("用户在哪里工作", "old-id", deps);
    expect(ok).toBe(false);
    expect(recallFn).toHaveBeenCalledWith("用户在哪里工作");
  });
});
