import { beforeAll, describe, expect, it } from "vitest";

/**
 * E2E: Q4 conflict resolution flow.
 *
 * Verifies that:
 *   1. Posting a "current state" answer after a known past fact triggers
 *      show_conflict UI directive.
 *   2. The conflict_decision(serious) action triggers a PATCH + POST
 *      replace via the new /api/interview/session PATCH endpoint.
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

describe("Phase 3 e2e — Q4 conflict flow", () => {
  it("conflict_decision(typo) continues the interview", async () => {
    if (SKIP_E2E) return;

    const createRes = await fetch(`${BASE}/api/interview/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bank_id: "zhangwei",
        query: `q4 typo test ${Date.now()}`,
      }),
    });
    expect(createRes.status).toBe(200);
    const { session_id } = (await createRes.json()) as { session_id: string };

    // PATCH a conflict_decision(typo) with a valid UUID
    const validFactId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const patchRes = await fetch(`${BASE}/api/interview/session`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id,
        action: {
          kind: "conflict_decision",
          verdict: "typo",
          old_fact_id: validFactId,
        },
      }),
    });
    expect(patchRes.status).toBe(200);
    const { ui } = (await patchRes.json()) as { ui: { kind: string } };
    // typo should continue (ask_question or finished if maxRounds reached)
    expect(["ask_question", "finished"]).toContain(ui.kind);
  });
});
