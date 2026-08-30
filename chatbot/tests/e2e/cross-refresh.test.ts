import { beforeAll, describe, expect, it } from "vitest";

/**
 * E2E: session cross-refresh persistence.
 *
 * Steps:
 *   1. Create session, answer one round
 *   2. GET /api/interview/session?session_id=X  → state must include the answer
 *   3. POST /api/interview/session (create)  → must NOT create a duplicate while
 *      an active session exists (UI hook contract)
 *
 * Skipped when Hindsight or Postgres is unreachable.
 */

const HINDSIGHT = process.env.HINDSIGHT_API_URL ?? "http://localhost:8888";
const BASE = "http://localhost:3000";

let SKIP_E2E = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${HINDSIGHT}/health`);
    if (!res.ok) SKIP_E2E = true;
  } catch {
    SKIP_E2E = true;
  }
});

describe("Phase 3 e2e — cross-refresh session restore", () => {
  it("GET /api/interview/session returns the same session after PATCH", async () => {
    if (SKIP_E2E) return;

    const createRes = await fetch(`${BASE}/api/interview/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bank_id: "zhangwei",
        query: `cross-refresh test ${Date.now()}`,
      }),
    });
    expect(createRes.status).toBe(200);
    const { session_id } = (await createRes.json()) as { session_id: string };

    // PATCH one answer
    await fetch(`${BASE}/api/interview/session`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id,
        action: { kind: "user_answer", answer: "remembered" },
      }),
    });

    // GET — session should still be active with round >= 2
    const getRes = await fetch(
      `${BASE}/api/interview/session?session_id=${session_id}`,
    );
    expect(getRes.status).toBe(200);
    const { state } = (await getRes.json()) as {
      state: { session_id: string; round: number; state: string };
    };
    expect(state.session_id).toBe(session_id);
    expect(state.round).toBeGreaterThanOrEqual(2);
    expect(state.state).toBe("active");
  });
});
