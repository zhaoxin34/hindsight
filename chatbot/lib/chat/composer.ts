/**
 * ChatComposer — orchestrates one user turn of the main agent.
 *
 * This module is intentionally a pure orchestration function: no env reads,
 * no direct module-level dependencies on Hindsight or the LLM SDK. All
 * external side effects arrive through the `deps` argument, which the
 * caller (route.ts) wires up. This is the seam that lets the composer be
 * unit-tested with mock dependencies, and that Phase 2 will reuse to plug
 * in interview-agent routing without rewriting route.ts.
 *
 * Pipeline:
 *   1. extract user query from the message list
 *   2. recall (with graceful fallback — recall failure must not break the LLM)
 *   3. build the system prompt from the recall result
 *   4. stream the LLM response
 *   5. wrap the LLM stream with a `data-recall` part so the UI can render
 *      the reference-memory collapsible section
 *
 * The composer returns a `Response` ready to send to the browser. The
 * caller does not need to know about UIMessageStream plumbing.
 */
import {
 createUIMessageStream,
 createUIMessageStreamResponse,
 type UIMessage,
 type UIMessageChunk,
} from "ai";
import { extractUserQuery } from "@/lib/chat/extract-user-query";
import type { RecallResponse } from "@/lib/hindsight";

/**
 * The LLM stream that `streamLLM` produces. AI SDK v5's `toUIMessageStream()`
 * returns a stream of `UIMessageChunk`, which is what `writer.merge()` accepts
 * on the UI stream side.
 */
export type LLMStream = ReadableStream<UIMessageChunk>;

export interface DataPart {
 /** Must start with `data-` per AI SDK v5's chunk schema. */
 type: `data-${string}`;
 id?: string;
 data: unknown;
 transient?: boolean;
}

export interface ChatDeps {
 /** Synchronous recall against Hindsight. */
 recall: (query: string) => Promise<RecallResponse>;
 /** Build the system prompt from a recall response. */
 buildPrompt: (recall: RecallResponse) => string;
 /** Produce the LLM stream given a system prompt and the message history. */
 streamLLM: (
  system: string,
  messages: UIMessage[],
 ) => Promise<LLMStream> | LLMStream;
 /** Build the data part that exposes recall metadata to the UI. */
 writeDataPart: (recall: RecallResponse) => DataPart;
 /** Optional logger — defaults to console.log. Inject `() => {}` in tests. */
 logger?: (message: string) => void;
}

/**
 * Compose one user turn into a streaming HTTP response.
 *
 * Throws if the user query is empty after trimming (caller should map to
 * a 400). Recall failures are swallowed and surfaced through the logger —
 * the LLM still answers, just without memory context.
 */
export async function composeChat(
 messages: UIMessage[],
 deps: ChatDeps,
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
   `[chat] recall returned ${recall.results.length} facts for query: "${query.slice(0, 60)}"`,
  );
 } catch (err) {
  log(`[chat] recall failed, falling back to empty: ${stringifyErr(err)}`);
 }

 const system = deps.buildPrompt(recall);
 const llmStream = await deps.streamLLM(system, messages);

 const uiStream = createUIMessageStream({
  execute({ writer }) {
   // SAFETY: AI SDK v5's strict UIMessage data-part typing rejects ad-hoc
   // `data-recall` shapes without a registered UIMessage<DATA_TYPES>. The
   // composer abstracts that decision behind `writeDataPart` so individual
   // routes don't have to repeat the cast.
   const part = deps.writeDataPart(recall);
   writer.write({ ...part, transient: false });
   writer.merge(llmStream);
  },
 });

 return createUIMessageStreamResponse({ stream: uiStream });
}

function stringifyErr(err: unknown): string {
 return err instanceof Error ? err.message : String(err);
}
