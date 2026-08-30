/**
 * POST /api/interview/session/[id]/finish — 专家点「够了」走 retain。
 *
 * The session must already be in `active` state. We call nextTurn with
 * `{ kind: "user_finish" }` which marks the state as `finished` and emits
 * a `finished` UI directive with retain items. The Phase 5 review UI
 * will handle the actual `retainMemories` call (out of scope for Phase 3).
 */

import { isMultiTurnEnabled } from "../../../_lib/config";
import { getSession } from "@/lib/db/sessions";
import { getInterviewDeps, nextTurn } from "../../../_lib/engine";
import { rowToState } from "../../../_lib/mappers";
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
      { kind: "user_finish" } satisfies InterviewAction,
      getInterviewDeps(),
    );
    return new Response(JSON.stringify({ state: next, ui }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return serverError(err instanceof Error ? err.message : "Finish failed");
  }
}
