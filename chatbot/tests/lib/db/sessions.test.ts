import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the chatbot_interview session CRUD. Mocks the postgres-js
 * tagged-template client so the SQL strings and parameter shapes are the
 * contract under test — these tests fail loudly if a query is rewritten
 * with the wrong table name, wrong WHERE clause, or wrong number of
 * placeholders.
 *
 * `vi.hoisted` ensures the mock fn exists before ESM imports run — without
 * it, `import { ... } from "@/lib/db/sessions"` (hoisted above this file's
 * body) would load the real client and the `vi.mock(...)` call below would
 * be too late.
 */
const { sqlMock } = vi.hoisted(() => {
  // `sql.json(value)` is a property on the `sql` template function in
  // postgres-js. The mock passes through the value so call-arg assertions
  // can inspect what was actually JSON-encoded.
  const json = vi.fn((value: unknown) => value);
  const fn = Object.assign(vi.fn(), { json });
  return { sqlMock: fn };
});

vi.mock("@/lib/db/client", () => ({
  sql: sqlMock,
}));

import {
  cleanupStale,
  createSession,
  getSession,
  markAbandoned,
  markFinished,
  updateSession,
  type InterviewSessionRow,
  type StoredClassification,
} from "@/lib/db/sessions";

const sampleClassification: StoredClassification = {
  complexity: "abstract",
  event_type: "success",
  needs_conflict_check: true,
  confidence: 0.85,
  reasoning: "abstract judgment question",
};

const sampleRow: InterviewSessionRow = {
  session_id: "00000000-0000-0000-0000-000000000001",
  bank_id: "zhangwei",
  query: "为什么 Python 比 Java 更适合写 ETL",
  classification: sampleClassification,
  turns: [],
  round: 0,
  state: "active",
  created_at: new Date("2026-08-29T12:00:00Z"),
  updated_at: new Date("2026-08-29T12:00:00Z"),
};

function makeRow(
  overrides: Partial<InterviewSessionRow> = {},
): InterviewSessionRow {
  return { ...sampleRow, ...overrides };
}

/**
 * postgres-js's tagged-template literal passes the SQL pieces as
 * `TemplateStringsArray` (index 0), followed by parameter values. Stitch
 * the pieces back into a single string so we can assert against it.
 */
function sqlString(callIndex = 0): string {
  const strings = sqlMock.mock.calls[callIndex]?.[0] as
    TemplateStringsArray | undefined;
  return strings ? Array.from(strings).join("") : "";
}

describe("createSession", () => {
  beforeEach(() => sqlMock.mockReset());

  it("INSERTs into chatbot_interview.interview_sessions and returns the row", async () => {
    sqlMock.mockResolvedValueOnce([makeRow()]);

    const row = await createSession({
      bank_id: "zhangwei",
      query: "为什么 Python 比 Java 更适合写 ETL",
      classification: sampleClassification,
    });

    expect(row).toEqual(makeRow());

    // Inspect the SQL: must target the right table and return all columns.
    const sql = sqlString();
    expect(sql).toMatch(/INSERT INTO chatbot_interview\.interview_sessions/);
    expect(sql).toMatch(/RETURNING \*/);
  });

  it("passes bank_id, query, and json-encoded classification", async () => {
    sqlMock.mockResolvedValueOnce([makeRow()]);

    await createSession({
      bank_id: "zhangwei",
      query: "Q",
      classification: sampleClassification,
    });

    // 3 placeholders: bank_id, query, sql.json(classification).
    expect(sqlMock.mock.calls[0]).toHaveLength(4);
  });
});

describe("getSession", () => {
  beforeEach(() => sqlMock.mockReset());

  it("SELECTs by session_id AND bank_id (bank isolation)", async () => {
    sqlMock.mockResolvedValueOnce([makeRow()]);

    const row = await getSession(sampleRow.session_id, "zhangwei");
    expect(row).toEqual(makeRow());

    const sql = sqlString();
    expect(sql).toMatch(/SELECT \*/);
    expect(sql).toMatch(/FROM chatbot_interview\.interview_sessions/);
    expect(sql).toMatch(/WHERE session_id =/);
    expect(sql).toMatch(/AND bank_id =/);
  });

  it("returns null when no row matches", async () => {
    sqlMock.mockResolvedValueOnce([]);

    const row = await getSession("missing-id", "zhangwei");
    expect(row).toBeNull();
  });
});

describe("updateSession", () => {
  beforeEach(() => sqlMock.mockReset());

  it("UPDATEs with COALESCE for optional fields and bumps updated_at", async () => {
    sqlMock.mockResolvedValueOnce([
      makeRow({
        round: 2,
        turns: [
          { q: "q", a: "a", dimension: "trigger", ts: "2026-08-29T12:01:00Z" },
        ],
      }),
    ]);

    await updateSession({
      session_id: sampleRow.session_id,
      bank_id: "zhangwei",
      turns: [
        { q: "q", a: "a", dimension: "trigger", ts: "2026-08-29T12:01:00Z" },
      ],
      round: 2,
    });

    const sql = sqlString();
    expect(sql).toMatch(/UPDATE chatbot_interview\.interview_sessions/);
    expect(sql).toMatch(/SET/);
    expect(sql).toMatch(/turns = COALESCE/);
    expect(sql).toMatch(/round = COALESCE/);
    expect(sql).toMatch(/updated_at = NOW\(\)/);
    expect(sql).toMatch(/WHERE session_id =/);
    expect(sql).toMatch(/AND bank_id =/);
  });

  it("uses null for omitted optional fields (so COALESCE keeps existing value)", async () => {
    sqlMock.mockResolvedValueOnce([makeRow()]);

    await updateSession({
      session_id: sampleRow.session_id,
      bank_id: "zhangwei",
      // turns and classification omitted
      round: 3,
    });

    // placeholders: turns(null), round(3), classification(null), session_id, bank_id
    const callArgs = sqlMock.mock.calls[0];
    expect(callArgs).toHaveLength(6);
    // turns placeholder should be null (no sql.json wrapper)
    expect(callArgs[1]).toBeNull();
    // round placeholder should be 3
    expect(callArgs[2]).toBe(3);
  });
});

describe("markAbandoned", () => {
  beforeEach(() => sqlMock.mockReset());

  it("sets state = 'abandoned' and bumps updated_at", async () => {
    sqlMock.mockResolvedValueOnce([makeRow({ state: "abandoned" })]);

    const row = await markAbandoned(sampleRow.session_id, "zhangwei");
    expect(row?.state).toBe("abandoned");

    const sql = sqlString();
    expect(sql).toMatch(/SET state = 'abandoned'/);
    expect(sql).toMatch(/updated_at = NOW\(\)/);
  });
});

describe("markFinished", () => {
  beforeEach(() => sqlMock.mockReset());

  it("sets state = 'finished' and bumps updated_at", async () => {
    sqlMock.mockResolvedValueOnce([makeRow({ state: "finished" })]);

    const row = await markFinished(sampleRow.session_id, "zhangwei");
    expect(row?.state).toBe("finished");

    const sql = sqlString();
    expect(sql).toMatch(/SET state = 'finished'/);
  });
});

describe("cleanupStale", () => {
  beforeEach(() => sqlMock.mockReset());

  it("DELETEs abandoned sessions older than the cutoff and returns count", async () => {
    sqlMock.mockResolvedValueOnce([{ count: 7 }]);

    const count = await cleanupStale(new Date("2026-08-22T00:00:00Z"));
    expect(count).toBe(7);

    const sql = sqlString();
    expect(sql).toMatch(/DELETE FROM chatbot_interview\.interview_sessions/);
    expect(sql).toMatch(/WHERE state = 'abandoned'/);
    expect(sql).toMatch(/AND updated_at </);
    expect(sql).toMatch(/SELECT COUNT\(/);
  });

  it("returns 0 when nothing was deleted", async () => {
    sqlMock.mockResolvedValueOnce([{ count: 0 }]);
    const count = await cleanupStale(new Date());
    expect(count).toBe(0);
  });
});
