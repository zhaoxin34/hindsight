import { describe, expect, it, vi } from "vitest";
import {
  createUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import {
  composeInterview,
  type InterviewDeps,
  type InterviewState,
  type LLMStream,
} from "@/lib/chat/interview/composer";
import type { RecallResponse } from "@/lib/hindsight";

/**
 * Mirrors `tests/lib/chat/composer.test.ts` but with the interview protocol:
 *   - emits `data-interview-state` (not `data-recall`)
 *   - falls through to interview mode even when recall has data (defensive)
 *   - state includes the original query and a timestamp
 */

function llmStream(chunks: UIMessageChunk[]): LLMStream {
  return createUIMessageStream({
    execute({ writer }) {
      for (const chunk of chunks) writer.write(chunk);
    },
  });
}

function makeDeps(overrides: Partial<InterviewDeps> = {}): InterviewDeps {
  const recallMock = vi.fn(async () => ({ results: [] }) as RecallResponse);
  const buildPromptMock = vi.fn(
    ({ query }: { query: string }) => `interview-prompt-for:${query}`,
  );
  const streamLLMMock = vi.fn(
    async () =>
      llmStream([
        { type: "start" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "你是主动离职吗？" },
        { type: "text-end", id: "t1" },
        { type: "finish" },
      ]),
  );
  const writeDataPartMock = vi.fn((state: InterviewState) => ({
    type: "data-interview-state" as const,
    id: `interview-${state.askedAt}`,
    data: state,
  }));
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
  const text = await response.text();
  const lines = text.split("\n");
  const chunks: UIMessageChunk[] = [];
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice("data: ".length).trim();
    if (payload === "[DONE]" || !payload) continue;
    try {
      chunks.push(JSON.parse(payload) as UIMessageChunk);
    } catch {
      // skip
    }
  }
  return chunks;
}

const baseMessages: UIMessage[] = [
  {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text: "为什么离开 Datatist？" }],
  } as unknown as UIMessage,
];

describe("composeInterview", () => {
  it("extracts the latest user query and passes it to recall and prompt", async () => {
    const deps = makeDeps();
    await composeInterview(baseMessages, deps);

    expect(deps.recall).toHaveBeenCalledExactlyOnceWith("为什么离开 Datatist？");
    expect(deps.buildPrompt).toHaveBeenCalledExactlyOnceWith({
      query: "为什么离开 Datatist？",
      recall: { results: [] },
    });
  });

  it("passes (system, messages) to streamLLM", async () => {
    const deps = makeDeps();
    await composeInterview(baseMessages, deps);

    expect(deps.streamLLM).toHaveBeenCalledExactlyOnceWith(
      "interview-prompt-for:为什么离开 Datatist？",
      baseMessages,
    );
  });

  it("throws on an empty user query", async () => {
    const deps = makeDeps();
    const messages: UIMessage[] = [
      { id: "a1", role: "assistant", parts: [] } as unknown as UIMessage,
    ];

    await expect(composeInterview(messages, deps)).rejects.toThrow(
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

    const response = await composeInterview(baseMessages, {
      ...deps,
      logger: warn,
    });

    const buildPromptArg = (deps.buildPrompt as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { recall: RecallResponse };
    expect(buildPromptArg.recall.results).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/recall failed/i));
    expect(response).toBeInstanceOf(Response);
  });

  it("emits data-interview-state before merging the LLM stream", async () => {
    const deps = makeDeps();
    const response = await composeInterview(baseMessages, deps);
    const chunks = await readStreamChunks(response);

    const stateIdx = chunks.findIndex(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: string }).type === "data-interview-state",
    );
    const textDeltaIdx = chunks.findIndex(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: string }).type === "text-delta",
    );

    expect(stateIdx).toBeGreaterThanOrEqual(0);
    expect(textDeltaIdx).toBeGreaterThanOrEqual(0);
    expect(stateIdx).toBeLessThan(textDeltaIdx);
  });

  it("marks the interview-state part as transient: false so it persists", async () => {
    const deps = makeDeps();
    const response = await composeInterview(baseMessages, deps);
    const chunks = await readStreamChunks(response);

    const part = chunks.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: string }).type === "data-interview-state",
    ) as { transient?: boolean; data?: InterviewState } | undefined;

    expect(part).toBeDefined();
    expect(part?.transient).toBe(false);
  });

  it("echoes the original query and a timestamp into the interview state", async () => {
    const deps = makeDeps();
    const response = await composeInterview(baseMessages, deps);
    const chunks = await readStreamChunks(response);

    const part = chunks.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        (c as { type?: string }).type === "data-interview-state",
    ) as { data?: InterviewState } | undefined;

    expect(part?.data?.awaitingAnswer).toBe(true);
    expect(part?.data?.query).toBe("为什么离开 Datatist？");
    expect(typeof part?.data?.askedAt).toBe("number");
    expect(part?.data?.askedAt).toBeGreaterThan(0);
  });

  it("threads the LLM stream chunks through unchanged", async () => {
    const deps = makeDeps();
    const response = await composeInterview(baseMessages, deps);
    const chunks = await readStreamChunks(response);

    const types = chunks.map((c) =>
      typeof c === "object" && c !== null
        ? (c as { type?: string }).type
        : "?",
    );
    expect(types).toContain("data-interview-state");
    expect(types).toContain("text-delta");
    expect(types).toContain("finish");
  });
});