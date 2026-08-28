import {
  streamText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { recallMemories, type RecallResponse } from "@/lib/hindsight";
import { buildSystemPrompt } from "@/lib/system-prompt";

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

function extractUserText(message: UIMessage): string {
  // AI SDK v5 messages use a `parts` array. Older `content` strings still work
  // via the same shim, so we handle both.
  //
  // SAFETY: `UIMessage`'s public type does not expose `parts` directly in all
  // v5 minor versions; the runtime shape is stable. The cast is required to
  // peek into the parts array without re-implementing the message shape.
  const m = message as unknown as {
    parts?: Array<{ type: string; text?: string }>;
    content?: string;
  };
  if (Array.isArray(m.parts)) {
    return m.parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text!)
      .join("");
  }
  if (typeof m.content === "string") return m.content;
  return "";
}

export async function POST(req: Request) {
  const { messages } = (await req.json()) as { messages: UIMessage[] };

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    return new Response("No user message in conversation", { status: 400 });
  }
  const query = extractUserText(lastUser).trim();
  if (!query) {
    return new Response("Empty user message", { status: 400 });
  }

  // === Dual-layer verification: recall first, inject into system prompt ===
  let recall: RecallResponse = { results: [] };
  try {
    recall = await recallMemories(query);
    console.log(
      `[chat] recall returned ${recall.results.length} facts for query: "${query.slice(0, 60)}"`,
    );
  } catch (err) {
    // Fallback gracefully — the LLM still answers, just without memory context.
    console.error("[chat] recall failed, falling back to empty:", err);
  }

  const system = buildSystemPrompt(recall);

  // Wrap the LLM stream with recall metadata as a custom data part, so the UI
  // can render the "📚 参考记忆" collapsible section below the answer.
  const llmStream = streamText({
    model,
    system,
    // convertToModelMessages is async in current AI SDK v5; await it.
    messages: await convertToModelMessages(messages),
  });

  const uiStream = createUIMessageStream({
    execute({ writer }) {
      // SAFETY: AI SDK v5's strict UIMessage data-part typing doesn't accept
      // ad-hoc `data-recall` shapes without a registered UIMessage<DATA_TYPES>.
      // We accept the `any` here; the client reads it back via its own typed
      // reader in app/page.tsx.
      writer.write({
        type: "data-recall",
        id: `recall-${Date.now()}`,
        data: recall,
        // Transient: false so it persists on the message and the UI can read
        // it after the stream finishes.
        transient: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      writer.merge(llmStream.toUIMessageStream({ sendStart: false }));
    },
  });

  return createUIMessageStreamResponse({ stream: uiStream });
}
