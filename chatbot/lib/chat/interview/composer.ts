/**
 * Interview agent composer.
 *
 * Mirrors the structure of `lib/chat/composer.ts` (main agent) but emits a
 * different data-part protocol — `data-interview-state` instead of
 * `data-recall` — so the UI can distinguish interview turns from normal
 * answers and surface a "完成" button.
 *
 * Pipeline (same shape as main, different semantics at each step):
 *   1. extract user query
 *   2. recall (typically empty — that's why we're here)
 *   3. build the interview prompt (asks the LLM to ask ONE question)
 *   4. stream the LLM's question
 *   5. wrap with `data-interview-state` so the UI knows it's in interview mode
 *
 * Phase 2 v1: stateless. The composer emits one question per request; the
 * UI accumulates Q/A pairs and calls `/api/interview` to retain them.
 * Phase 3 will add session state, complexity classifier, and multi-round.
 */
import {
 createUIMessageStream,
 createUIMessageStreamResponse,
 type UIMessage,
 type UIMessageChunk,
} from "ai";
import { extractUserQuery } from "@/lib/chat/extract-user-query";
import type { RecallResponse } from "@/lib/hindsight";
import type { InterviewPromptInput } from "@/lib/chat/interview/prompts";

export type LLMStream = ReadableStream<UIMessageChunk>;

/**
 * Payload attached to the `data-interview-state` part. Phase 2 v1 only needs
 * `awaitingAnswer` + the original query so the UI can render a "完成" button
 * and accumulate the Q/A pair list.
 */
export interface InterviewState {
 awaitingAnswer: true;
 query: string;
 askedAt: number;
}

export interface DataPart {
 /** Must start with `data-` per AI SDK v5's chunk schema. */
 type: `data-${string}`;
 id?: string;
 data: unknown;
 transient?: boolean;
}

export interface InterviewDeps {
 /** Synchronous recall against Hindsight (typically returns no results). */
 recall: (query: string) => Promise<RecallResponse>;
 /** Build the interview prompt from the query + recall. */
 buildPrompt: (input: InterviewPromptInput) => string;
 /** Produce the LLM stream given the interview prompt + message history. */
 streamLLM: (
  system: string,
  messages: UIMessage[],
 ) => Promise<LLMStream> | LLMStream;
 /** Build the data part that tells the UI we are in interview mode. */
 writeDataPart: (state: InterviewState) => DataPart;
 /** Optional logger — defaults to console.log. Inject `() => {}` in tests. */
 logger?: (message: string) => void;
}

export async function composeInterview(
 messages: UIMessage[],
 deps: InterviewDeps,
): Promise<Response> {
 const log = deps.logger ?? ((msg: string) => console.log(msg));

 const query = extractUserQuery(messages);
 if (!query) {
  throw new Error("Empty user message");
 }

 let recall: RecallResponse = { results: [] };
 try {
  recall = await deps.recall(query);
  log(
   `[interview] recall returned ${recall.results.length} facts (typically empty)`,
  );
 } catch (err) {
  log(`[interview] recall failed, falling back to empty: ${stringifyErr(err)}`);
 }

 const system = deps.buildPrompt({ query, recall });
 const llmStream = await deps.streamLLM(system, messages);

 const state: InterviewState = {
  awaitingAnswer: true,
  query,
  askedAt: Date.now(),
 };

 const uiStream = createUIMessageStream({
  execute({ writer }) {
   const part = deps.writeDataPart(state);
   writer.write({ ...part, transient: false });
   writer.merge(llmStream);
  },
 });

 return createUIMessageStreamResponse({ stream: uiStream });
}

function stringifyErr(err: unknown): string {
 return err instanceof Error ? err.message : String(err);
}
