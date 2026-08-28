import { describe, expect, it, vi } from "vitest";
import { createUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import {
  composeChat,
  type ChatDeps,
  type LLMStream,
} from "@/lib/chat/composer";
import type { RecallResponse, RecallResult } from "@/lib/hindsight";

/**
 * Composer's job is plumbing: extract → recall → build prompt → stream LLM →
 * wrap with a `data-recall` part. We mock every dep and inspect the resulting
 * UI stream to verify the order of chunks and that the data-recall part is
 * written before the LLM stream is merged.
 *
 * The test uses real `createUIMessageStream` + `readUIMessageStream` so the
 * AI SDK's chunk schema is exercised end-to-end — if a future SDK upgrade
 * changes the contract, these tests catch it.
 */

const FACT: RecallResult = {
  id: "f1",
  text: "张伟在 Datatist 工作",
  type: "observation",
  context: "职业",
  metadata: null,
  tags: null,
  entities: ["张伟"],
  occurred_start: null,
  occurred_end: null,
  mentioned_at: null,
  document_id: null,
  chunk_id: null,
  source_fact_ids: null,
  scores: null,
};

function llmStream(chunks: UIMessageChunk[]): LLMStream {
  // Build a stream that yields the given chunks when consumed.
  return createUIMessageStream({
    execute({ writer }) {
      for (const chunk of chunks) writer.write(chunk);
    },
  });
}

function makeDeps(overrides: Partial<ChatDeps> = {}): ChatDeps {
  const recallMock = vi.fn(async () => ({ results: [FACT] }) as RecallResponse);
  const buildPromptMock = vi.fn(
    (recall: RecallResponse) => `prompt-with-${recall.results.length}-facts`,
  );
  const streamLLMMock = vi.fn(async () =>
    llmStream([
      { type: "start" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "answer" },
      { type: "text-end", id: "t1" },
      { type: "finish" },
    ]),
  );
  const writeDataPartMock = vi.fn(
    (recall: RecallResponse) =>
      ({
        type: "data-recall",
        id: "recall-1",
        data: recall,
      }) as const,
  );
  return {
    recall: recallMock,
    buildPrompt: buildPromptMock,
    streamLLM: streamLLMMock,
    writeDataPart: writeDataPartMock,
    logger: () => {},
    ...overrides,
  };
}

async function readStreamChunks(response: Response): Promise<UIMessageChunk[]> {
  // Read SSE-encoded body. `createUIMessageStreamResponse` writes chunks as
  // `data: <json>\n\n`, terminated by `data: [DONE]\n\n` on finish.
  const text = await response.text();
  const lines = text.split("\n");
  const chunks: UIMessageChunk[] = [];
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice("data: ".length).trim();
    if (payload === "[DONE]") continue;
    if (!payload) continue;
    try {
      chunks.push(JSON.parse(payload) as UIMessageChunk);
    } catch {
      // skip non-JSON noise
    }
  }
  return chunks;
}

const baseMessages: UIMessage[] = [
  {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text: "张伟在哪工作？" }],
  } as unknown as UIMessage,
];

describe("composeChat", () => {
  it("extracts the latest user query and passes it to recall", async () => {
    const deps = makeDeps();
    await composeChat(baseMessages, deps);

    expect(deps.recall).toHaveBeenCalledExactlyOnceWith("张伟在哪工作？");
  });

  it("passes the recall result into buildPrompt", async () => {
    const deps = makeDeps();
    await composeChat(baseMessages, deps);

    const recallArg = (deps.buildPrompt as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as RecallResponse;
    expect(recallArg.results).toEqual([FACT]);
  });

  it("passes (system, messages) to streamLLM", async () => {
    const deps = makeDeps();
    await composeChat(baseMessages, deps);

    expect(deps.streamLLM).toHaveBeenCalledExactlyOnceWith(
      "prompt-with-1-facts",
      baseMessages,
    );
  });

  it("throws on an empty user query", async () => {
    const deps = makeDeps();
    const messages: UIMessage[] = [
      { id: "a1", role: "assistant", parts: [] } as unknown as UIMessage,
    ];

    await expect(composeChat(messages, deps)).rejects.toThrow(
      /empty user message/i,
    );
    expect(deps.recall).not.toHaveBeenCalled();
  });

  it("falls back to empty recall when recall throws", async () => {
    const deps = makeDeps({
      recall: vi.fn(async () => {
        throw new Error("hindsight down");
      }),
    });
    const warn = vi.fn();
    const response = await composeChat(baseMessages, {
      ...deps,
      logger: warn,
    });

    // buildPrompt receives an empty recall and emits the prompt anyway.
    const buildPromptArg = (deps.buildPrompt as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as RecallResponse;
    expect(buildPromptArg.results).toEqual([]);

    // streamLLM still gets called with the fallback prompt.
    expect(deps.streamLLM).toHaveBeenCalledOnce();

    // logger surfaces the failure.
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/recall failed/i));

    // response is still produced (LLM still answers).
    expect(response).toBeInstanceOf(Response);
  });

  it("emits the data-recall part before merging the LLM stream", async () => {
    const deps = makeDeps();
    const response = await composeChat(baseMessages, deps);

    const chunks = await readStreamChunks(response);
    const dataChunkIdx = chunks.findIndex(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: string }).type === "data-recall",
    );
    const textDeltaIdx = chunks.findIndex(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: string }).type === "text-delta",
    );

    expect(dataChunkIdx).toBeGreaterThanOrEqual(0);
    expect(textDeltaIdx).toBeGreaterThanOrEqual(0);
    expect(dataChunkIdx).toBeLessThan(textDeltaIdx);
  });

  it("marks the data-recall part as transient: false so it persists", async () => {
    const deps = makeDeps();
    const response = await composeChat(baseMessages, deps);
    const chunks = await readStreamChunks(response);

    const dataChunk = chunks.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: string }).type === "data-recall",
    ) as { transient?: boolean; data?: unknown } | undefined;

    expect(dataChunk).toBeDefined();
    expect(dataChunk?.transient).toBe(false);
  });

  it("echoes the recall payload into the data-recall part", async () => {
    const deps = makeDeps();
    const response = await composeChat(baseMessages, deps);
    const chunks = await readStreamChunks(response);

    const dataChunk = chunks.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: string }).type === "data-recall",
    ) as { data?: RecallResponse } | undefined;

    expect(dataChunk?.data?.results).toEqual([FACT]);
  });

  it("threads the LLM stream chunks through unchanged", async () => {
    const deps = makeDeps();
    const response = await composeChat(baseMessages, deps);
    const chunks = await readStreamChunks(response);

    const types = chunks.map((c) =>
      typeof c === "object" && c !== null ? (c as { type?: string }).type : "?",
    );
    expect(types).toContain("data-recall");
    expect(types).toContain("text-delta");
    expect(types).toContain("finish");
  });
});
