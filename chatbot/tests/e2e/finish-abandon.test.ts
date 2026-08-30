import { beforeAll, describe, expect, it } from "vitest";

/**
 * E2E: 够了/放弃 UI interaction.
 *
 * Verifies that:
 *   1. POST /api/interview/session/[id]/finish marks state as finished.
 *   2. POST /api/interview/session/[id]/abandon marks state as abandoned.
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

async function createSession(query: string): Promise<string> {
  const res = await fetch(`${BASE}/api/interview/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bank_id: "zhangwei", query }),
  });
  if (!res.ok) throw new Error(`create session failed: ${res.status}`);
  const { session_id } = (await res.json()) as { session_id: string };
  return session_id;
}

describe("Phase 3 e2e — 够了 / 放弃", () => {
  it("finish marks session as finished", async () => {
    if (SKIP_E2E) return;
    const sessionId = await createSession(`finish test ${Date.now()}`);

    const res = await fetch(
      `${BASE}/api/interview/session/${sessionId}/finish`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const { state, ui } = (await res.json()) as {
      state: { state: string };
      ui: { kind: string };
    };
    expect(state.state).toBe("finished");
    expect(ui.kind).toBe("finished");
  });

  it("abandon marks session as abandoned", async () => {
    if (SKIP_E2E) return;
    const sessionId = await createSession(`abandon test ${Date.now()}`);

    const res = await fetch(
      `${BASE}/api/interview/session/${sessionId}/abandon`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const { state, ui } = (await res.json()) as {
      state: { state: string };
      ui: { kind: string };
    };
    expect(state.state).toBe("abandoned");
    expect(ui.kind).toBe("abandoned");
  });

  it("returns 404 for non-existent session", async () => {
    if (SKIP_E2E) return;
    const fakeId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const res = await fetch(`${BASE}/api/interview/session/${fakeId}/finish`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});
