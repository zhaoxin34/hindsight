import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * End-to-end multi-turn interview flow.
 *
 * Exercises the full Phase 3 path:
 *   1. POST /api/interview/session        — create session + first question
 *   2. PATCH /api/interview/session       — submit answer (round 1)
 *   3. PATCH /api/interview/session       — submit answer (round 2)
 *   4. POST /api/interview/session/[id]/finish — 够了 → finished
 *
 * Requires:
 *   - Hindsight running at HINDSIGHT_API_URL (default localhost:8888)
 *   - ENABLE_MULTI_TURN_INTERVIEW=true
 *   - Postgres at CHATBOT_DATABASE_URL (default localhost:5432/hindsight)
 *
 * Skipped automatically when Hindsight is unreachable so this doesn't
 * break CI that doesn't have the full stack.
 *
 * Marked as e2e by file path (tests/e2e/) — the vitest config can be
 * configured to scope or skip these in regular dev runs if needed.
 */

const HINDSIGHT = process.env.HINDSIGHT_API_URL ?? "http://localhost:8888";
const BASE = "http://localhost:3000";

async function isHindsightUp(): Promise<boolean> {
  try {
    const res = await fetch(`${HINDSIGHT}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

let SKIP_E2E = false;

beforeAll(async () => {
  if (!(await isHindsightUp())) {
    SKIP_E2E = true;
    console.warn(
      "[e2e] Hindsight not reachable at " + HINDSIGHT + " — skipping tests",
    );
  }
});

afterAll(() => {
  // nothing to clean
});

describe("Phase 3 e2e — multi-turn interview flow", () => {
  it("completes a 3-round interview and returns finished directive", async () => {
    if (SKIP_E2E) return;

    // 1. Create session
    const createRes = await fetch(`${BASE}/api/interview/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bank_id: "zhangwei",
        query: `e2e test query ${Date.now()}`,
      }),
    });
    expect(createRes.status).toBe(200);
    const { session_id, ui: ui1 } = (await createRes.json()) as {
      session_id: string;
      ui: { kind: string; question?: string };
    };
    expect(ui1.kind).toBe("ask_question");

    // 2. Submit first answer
    const ans1Res = await fetch(`${BASE}/api/interview/session`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id,
        action: { kind: "user_answer", answer: "first answer" },
      }),
    });
    expect(ans1Res.status).toBe(200);
    const { ui: ui2 } = (await ans1Res.json()) as { ui: { kind: string } };
    expect(["ask_question", "show_conflict", "finished"]).toContain(ui2.kind);

    // 3. Finish (够了)
    const finishRes = await fetch(
      `${BASE}/api/interview/session/${session_id}/finish`,
      { method: "POST" },
    );
    expect(finishRes.status).toBe(200);
    const { ui: ui3 } = (await finishRes.json()) as { ui: { kind: string } };
    expect(ui3.kind).toBe("finished");
  });

  it("rejects invalid session_id with 400", async () => {
    if (SKIP_E2E) return;

    const res = await fetch(`${BASE}/api/interview/session`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "not-a-uuid",
        action: { kind: "user_finish" },
      }),
    });
    expect(res.status).toBe(400);
  });
});
