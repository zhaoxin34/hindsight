import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { recallMemories } from "@/lib/hindsight";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { composeChat } from "@/lib/chat/composer";

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

export async function POST(req: Request): Promise<Response> {
  const { messages } = (await req.json()) as { messages: UIMessage[] };

  try {
    return await composeChat(messages, {
      recall: recallMemories,
      buildPrompt: buildSystemPrompt,
      streamLLM: async (system, uiMessages) => {
        // convertToModelMessages is async in current AI SDK v5; await it.
        const modelMessages = await convertToModelMessages(uiMessages);
        return streamText({
          model,
          system,
          messages: modelMessages,
        }).toUIMessageStream({ sendStart: false });
      },
      writeDataPart: (recall) => ({
        type: "data-recall",
        id: `recall-${Date.now()}`,
        data: recall,
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Empty user message") {
      return new Response("Empty user message", { status: 400 });
    }
    throw err;
  }
}
