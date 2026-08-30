/**
 * Postgres client singleton for chatbot session storage.
 *
 * Phase 3 introduces a separate `chatbot_interview` schema in the host
 * `postgres` container (see design.md D1). This client connects to that
 * same container but uses the default `postgres` database — Hindsight's own
 * PG is not exposed to the host, so we deliberately decoupled storage.
 *
 * Configuration (env vars):
 *   CHATBOT_DATABASE_URL — defaults to the local dev `postgres` container.
 *
 * The singleton is cached on `globalThis` to survive Next.js dev-mode hot
 * reload, which otherwise creates a new pool per code change and exhausts
 * the database's connection limit.
 */

import postgres from "postgres";

const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/postgres";

declare global {
  var __chatbotSql: ReturnType<typeof postgres> | undefined;
}

function createSql() {
  const url = process.env.CHATBOT_DATABASE_URL ?? DEFAULT_DATABASE_URL;
  return postgres(url, {
    max: 5,
    idle_timeout: 30,
    // Don't throw on connect; fail-fast at first query so the app can log
    // a useful error and the migration tool can show its own error.
    onnotice: () => {},
  });
}

export const sql: ReturnType<typeof postgres> =
  globalThis.__chatbotSql ?? createSql();

if (process.env.NODE_ENV !== "production") {
  globalThis.__chatbotSql = sql;
}
