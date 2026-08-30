#!/usr/bin/env -S npx tsx
/**
 * Cleanup stale interview sessions.
 *
 * Removes `state='abandoned'` rows whose `updated_at` is older than the
 * configured TTL (default 7 days). Active and finished sessions are
 * untouched — they may be needed for audit or future UI resume.
 *
 * Usage:
 *   npx tsx scripts/cleanup-stale-sessions.ts                # uses default 7d TTL
 *   npx tsx scripts/cleanup-stale-sessions.ts --ttl 14d
 *   npx tsx scripts/cleanup-stale-sessions.ts --dry-run
 *
 * Exit code: 0 on success, 1 on DB error. Logs deleted count to stdout
 * so cron / monitoring can grep for the number.
 */

import { cleanupStale } from "../lib/db/sessions";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const ttlArg = args.find((a) => a.startsWith("--ttl="));
const ttlDays = ttlArg ? Number(ttlArg.split("=")[1]) : 7;

if (Number.isNaN(ttlDays) || ttlDays <= 0) {
  console.error(`Invalid --ttl value: ${ttlArg}`);
  process.exit(1);
}

const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
console.log(
  `[cleanup] Deleting abandoned sessions updated before ${cutoff.toISOString()}`,
);

if (dryRun) {
  console.log("[cleanup] --dry-run set: would delete rows, but skipping");
  process.exit(0);
}

try {
  const deleted = await cleanupStale(cutoff);
  console.log(`[cleanup] Deleted ${deleted} stale session(s)`);
  process.exit(0);
} catch (err) {
  console.error(
    `[cleanup] FAILED: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
