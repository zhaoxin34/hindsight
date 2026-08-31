/**
 * Postgres client singleton for chatbot session storage.
 *
 * Phase 3 introduces a `chatbot_interview` schema in the host `hindsight`
 * database (see design.md D1). Hindsight also lives in the same container
 * but uses its own `public` schema, so the two are isolated at the schema
 * level inside a single database.
 *
 * Configuration (env vars):
 *   CHATBOT_DATABASE_URL — defaults to the local dev `hindsight` database.
 *
 * The singleton is cached on `globalThis` to survive Next.js dev-mode hot
 * reload, which otherwise creates a new pool per code change and exhausts
 * the database's connection limit.
 */

import postgres from "postgres";

const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/hindsight";

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
