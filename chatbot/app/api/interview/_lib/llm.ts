/**
 * LLM client used by interview routes.
 *
 * Mirrors the main chat agent's LLM setup (qwen-plus via DashScope
 * OpenAI-compatible mode) so interviews use the same model as the rest
 * of the system (per Q2 decision). Reusing `generateText` from the
 * Vercel AI SDK keeps the streaming / non-streaming code paths symmetric.
 */

import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import type { LLMClientDeps } from "@/lib/chat/classifier/types";

const LLM_BASE_URL =
  process.env.LLM_BASE_URL ??
  "https://dashscope.aliyuncs.com/compatible-mode/v1";
const LLM_MODEL = process.env.LLM_MODEL ?? "qwen-plus";

function createLLMClient(): LLMClientDeps {
  const apiKey = process.env.BAILIAN_API_KEY;
  if (!apiKey) {
    throw new Error("BAILIAN_API_KEY is not set");
  }
  const bailian = createOpenAI({ baseURL: LLM_BASE_URL, apiKey });
  const model = bailian(LLM_MODEL);

  return {
    async complete({ system, user }): Promise<string> {
      const { text } = await generateText({
        model,
        system,
        prompt: user,
      });
      return text;
    },
  };
}

let _llm: LLMClientDeps | null = null;
export function getInterviewLLM(): LLMClientDeps {
  if (!_llm) _llm = createLLMClient();
  return _llm;
}

/** Test-only: replace the singleton so tests can inject mocks. */
export function setInterviewLLMForTest(llm: LLMClientDeps | null): void {
  _llm = llm;
}
