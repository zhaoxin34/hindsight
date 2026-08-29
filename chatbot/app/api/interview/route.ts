/**
 * POST /api/interview — persist a list of interview Q/A pairs to Hindsight.
 *
 * The UI accumulates interview exchanges client-side as the user answers
 * each clarifying question. When the user clicks "完成", the client POSTs
 * the accumulated pairs here. We translate each (question, answer) into a
 * Hindsight `RetainItem` (with the question as `context`) and call
 * `retainMemories()` once.
 *
 * Phase 2 v1:
 *   - No user approval step (ROADMAP Phase 5 will add Knowledge Card Editor)
 *   - Stateless: server doesn't keep track of which items have been retained
 *   - Each pair is sent verbatim; the user owns the content they typed
 *
 * Validation: zod for the request shape, with a clear 400 on bad input.
 */
import { z } from "zod";
import { retainMemories, type RetainItem } from "@/lib/hindsight";

// Allow up to 60 seconds for the retain call (Hindsight is async + extraction
// can take a few seconds for a small batch).
export const maxDuration = 60;

const InterviewPairSchema = z.object({
  question: z.string().min(1).max(2000),
  answer: z.string().min(1).max(8000),
});

const InterviewRequestSchema = z.object({
  items: z.array(InterviewPairSchema).min(1).max(50),
});

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON");
  }

  const parsed = InterviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(
      `Invalid request: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  const items: RetainItem[] = parsed.data.items.map((pair) => ({
    // The user's answer is the knowledge; the question is its provenance.
    content: pair.answer,
    context: pair.question,
    timestamp: new Date().toISOString(),
  }));

  try {
    const result = await retainMemories(items);
    return new Response(
      JSON.stringify({
        success: true,
        items_count: result.items_count,
        async: result.async,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Hindsight retain failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
