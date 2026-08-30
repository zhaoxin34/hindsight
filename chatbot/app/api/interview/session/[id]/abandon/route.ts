/**
 * POST /api/interview/session/[id]/abandon — 专家点「放弃」清空 session。
 *
 * Marks the session as `abandoned`; turns are NOT retained. The
 * abandoned row stays in the DB (with a `state='abandoned'` flag) for
 * audit, and is purged by the cleanup job (Group 9) after 7 days.
 */

import { isMultiTurnEnabled } from "@/app/api/interview/_lib/config";
import { getSession } from "@/lib/db/sessions";
import { getInterviewDeps, nextTurn } from "@/app/api/interview/_lib/engine";
import { rowToState } from "@/app/api/interview/_lib/mappers";
import { type InterviewAction } from "@/lib/chat/interview/state";

function notFound(): Response {
  return new Response(
    JSON.stringify({ error: "multi-turn interview is disabled" }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );
}

function notFoundSession(): Response {
  return new Response(JSON.stringify({ error: "session not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

function serverError(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isMultiTurnEnabled()) return notFound();
  const { id } = await ctx.params;
  const bankId = process.env.HINDSIGHT_BANK_ID ?? "zhangwei";
  let row;
  try {
    row = await getSession(id, bankId);
  } catch (err) {
    return serverError(err instanceof Error ? err.message : "DB read failed");
  }
  if (!row) return notFoundSession();
  try {
    const state = rowToState(row);
    const { state: next, ui } = await nextTurn(
      state,
      { kind: "user_abandon" } satisfies InterviewAction,
      getInterviewDeps(),
    );
    return new Response(JSON.stringify({ state: next, ui }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return serverError(err instanceof Error ? err.message : "Abandon failed");
  }
}
