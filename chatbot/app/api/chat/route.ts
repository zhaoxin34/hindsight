import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { recallMemories } from "@/lib/hindsight";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { composeChat } from "@/lib/chat/composer";
import { composeInterview } from "@/lib/chat/interview/composer";
import { buildInterviewPrompt } from "@/lib/chat/interview/prompts";
import { decideMode } from "@/lib/chat/mode-router";
import { extractUserQuery } from "@/lib/chat/extract-user-query";

// Allow streaming responses up to 60 seconds (Hindsight recall + LLM answer)
export const maxDuration = 60;

const MODEL_NAME = process.env.LLM_MODEL ?? "qwen-plus";
const MODEL_BASE_URL =
  process.env.LLM_BASE_URL ??
  "https://dashscope.aliyuncs.com/compatible-mode/v1";
const MODEL_API_KEY = process.env.BAILIAN_API_KEY;

if (!MODEL_API_KEY) {
  // Surface a clear error at request time rather than failing the build.
  // We don't throw here so that `next build` can succeed in CI environments
  // where the key isn't set.
  console.warn(
    "[chat] BAILIAN_API_KEY is not set — LLM calls will fail until it is.",
  );
}

// AI SDK v5 factory pattern: createOpenAI() returns a provider factory whose
// model functions take just the model name. baseURL + apiKey configure the
// DashScope OpenAI-compatible endpoint.
const openaiProvider = createOpenAI({
  baseURL: MODEL_BASE_URL,
  apiKey: MODEL_API_KEY ?? "",
});
const model = openaiProvider(MODEL_NAME);

function streamDashScopeLLM(system: string, messages: UIMessage[]) {
  // convertToModelMessages is async in current AI SDK v5; await it.
  return (async () => {
    const modelMessages = await convertToModelMessages(messages);
    return streamText({
      model,
      system,
      messages: modelMessages,
    }).toUIMessageStream({ sendStart: false });
  })();
}

/**
 * POST /api/chat — dispatch a user turn to either the main agent or the
 * interview agent. Decision lives in `decideMode(recall)`.
 *
 * Phase 2 v1 flow:
 *   1. Extract the latest user query (pure, no IO).
 *   2. Recall ONCE; the same result drives both the router and the composer.
 *      The composer receives a `recall` dep that returns the cached value.
 *   3. Route based on `decideMode(recall)`.
 *   4. Hand off to the chosen composer; the response stream comes back.
 *
 * Recall failure: router treats it as empty (interview mode); the composer
 * also catches the same failure inside its own recall call. If we cache a
 * failed recall, the composer's recall re-fires — we avoid that by only
 * caching successful recalls.
 */
export async function POST(req: Request): Promise<Response> {
  const { messages } = (await req.json()) as { messages: UIMessage[] };

  const query = extractUserQuery(messages);
  if (!query) {
    return new Response("Empty user message", { status: 400 });
  }

  let recall: Awaited<ReturnType<typeof recallMemories>> | null = null;
  try {
    recall = await recallMemories(query);
  } catch (err) {
    // Routing proceeds with `recall === null`; decideMode treats that as
    // empty, so the interview path is selected. The chosen composer will
    // still attempt its own recall and fall back gracefully.
    console.warn(`[chat] recall failed during routing: ${stringifyErr(err)}`);
  }

  const mode = decideMode(recall);
  const recallDep = recall ? async () => recall! : recallMemories;

  if (mode === "interview") {
    return composeInterview(messages, {
      recall: recallDep,
      buildPrompt: buildInterviewPrompt,
      streamLLM: streamDashScopeLLM,
      writeDataPart: (state) => ({
        type: "data-interview-state",
        id: `interview-${state.askedAt}`,
        data: state,
      }),
    });
  }

  return composeChat(messages, {
    recall: recallDep,
    buildPrompt: buildSystemPrompt,
    streamLLM: streamDashScopeLLM,
    writeDataPart: (r) => ({
      type: "data-recall",
      id: `recall-${Date.now()}`,
      data: r,
    }),
  });
}

function stringifyErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
