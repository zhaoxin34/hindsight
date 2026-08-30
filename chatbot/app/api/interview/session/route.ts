/**
 * /api/interview/session — multi-turn interview session endpoints.
 *
 *   POST   — create a new session + return first question
 *   GET    — restore an existing session by session_id query param
 *   PATCH  — advance the session with a user action (user_answer, user_finish, …)
 *
 * All endpoints gate on `ENABLE_MULTI_TURN_INTERVIEW` (config.ts) — when the
 * feature flag is off, every method returns 404 so the Phase 2 UI is
 * untouched. The legacy POST /api/interview (batch interface) keeps
 * working for any client that hasn't migrated yet.
 */

import { z } from "zod";

import { HybridClassifier } from "@/lib/chat/classifier/hybrid";
import { RuleBasedClassifier } from "@/lib/chat/classifier/rule-based";
import {
  getInterviewDeps,
  getInterviewLLM,
  startInterview,
  nextTurn,
} from "../_lib/engine";
import { rowToState } from "../_lib/mappers";
import { createSessionSchema, advanceSessionSchema } from "../_lib/schemas";
import { createSession, getSession } from "@/lib/db/sessions";
import { isMultiTurnEnabled } from "../_lib/config";
import { type RecallResult } from "@/lib/hindsight";
import { recallMemoriesForQuery } from "../_lib/recall";
import { type InterviewAction } from "@/lib/chat/interview/state";
import { ClassificationSchema } from "@/lib/chat/classifier/types";

function notFound(): Response {
  return new Response(
    JSON.stringify({ error: "multi-turn interview is disabled" }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );
}

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

function serverError(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

async function classifyOrFallback(
  query: string,
  bankId: string,
  provided?: unknown,
) {
  if (provided) {
    return ClassificationSchema.parse(provided);
  }
  // Server-side classification: recall + rule-based + LLM fallback
  let recall: RecallResult[] = [];
  try {
    const r = await recallMemoriesForQuery(query, bankId);
    recall = r;
  } catch {
    recall = [];
  }
  const classifier = new HybridClassifier({
    ruleBased: new RuleBasedClassifier(),
    llm: getInterviewLLM(),
  });
  return classifier.classify({ query, recall });
}

// ---------------------------------------------------------------------------
// POST: create a new session
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  if (!isMultiTurnEnabled()) return notFound();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  const parsed = createSessionSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(
      `Invalid request: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const { bank_id, query, classification: providedClass } = parsed.data;
  let classification;
  try {
    classification = await classifyOrFallback(query, bank_id, providedClass);
  } catch (err) {
    return serverError(
      `Classification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    const row = await createSession({
      bank_id,
      query,
      classification,
    });
    const state = rowToState(row);
    const { state: next, ui } = await startInterview(state, getInterviewDeps());
    return new Response(
      JSON.stringify({ session_id: row.session_id, state: next, ui }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return serverError(
      err instanceof Error ? err.message : "Failed to start interview",
    );
  }
}

// ---------------------------------------------------------------------------
// GET: restore a session by id
// ---------------------------------------------------------------------------

export async function GET(req: Request): Promise<Response> {
  if (!isMultiTurnEnabled()) return notFound();
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return badRequest("Invalid request URL");
  }
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) return badRequest("session_id query param is required");
  let row;
  try {
    row = await getSession(
      sessionId,
      process.env.HINDSIGHT_BANK_ID ?? "zhangwei",
    );
  } catch (err) {
    return serverError(err instanceof Error ? err.message : "DB read failed");
  }
  if (!row) {
    return new Response(JSON.stringify({ error: "session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ state: rowToState(row) }), {
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// PATCH: advance session with a user action
// ---------------------------------------------------------------------------

export async function PATCH(req: Request): Promise<Response> {
  if (!isMultiTurnEnabled()) return notFound();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }
  const parsed = advanceSessionSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(
      `Invalid request: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const { session_id, action } = parsed.data;
  const bankId = process.env.HINDSIGHT_BANK_ID ?? "zhangwei";
  let row;
  try {
    row = await getSession(session_id, bankId);
  } catch (err) {
    return serverError(err instanceof Error ? err.message : "DB read failed");
  }
  if (!row) {
    return new Response(JSON.stringify({ error: "session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const state = rowToState(row);
    // Build deps with a recall function bound to the current query, so
    // conflict detection is grounded in the same recall context.
    const baseDeps = getInterviewDeps();
    const deps = {
      ...baseDeps,
      recall: async () => {
        const r = await recallMemoriesForQuery(state.query, state.bank_id);
        return r;
      },
    };
    const { state: next, ui } = await nextTurn(
      state,
      action as InterviewAction,
      deps,
    );
    return new Response(JSON.stringify({ state: next, ui }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return serverError(
      err instanceof Error ? err.message : "State transition failed",
    );
  }
}
