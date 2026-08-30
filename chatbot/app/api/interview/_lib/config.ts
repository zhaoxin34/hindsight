/**
 * Static configuration for interview routes.
 */

export const HINDSIGHT_BANK_ID = process.env.HINDSIGHT_BANK_ID ?? "zhangwei";

/**
 * Feature flag — when `false` (default), the multi-turn state machine is
 * NOT used; the Phase 2 single-turn `composeInterview` path remains
 * authoritative. The new session-based routes return 404 in this mode
 * so the existing UI behavior is unchanged.
 *
 * Read at call time (not module load) so tests can override via
 * `setMultiTurnEnabledForTest` without `vi.mock` leakage.
 */
export function isMultiTurnEnabled(): boolean {
  return process.env.ENABLE_MULTI_TURN_INTERVIEW === "true";
}

/**
 * Backward-compat constant — re-evaluated on every read. Callers that
 * just want a boolean should use `isMultiTurnEnabled()` instead.
 */
export const ENABLE_MULTI_TURN_INTERVIEW = isMultiTurnEnabled();

/** Test-only — set the flag for the duration of one or more tests. */
let _testOverride: boolean | null = null;
export function setMultiTurnEnabledForTest(value: boolean | null): void {
  _testOverride = value;
}

/** Wraps `isMultiTurnEnabled` so test overrides can be applied. */
export function isMultiTurnEnabledLive(): boolean {
  return _testOverride ?? isMultiTurnEnabled();
}
