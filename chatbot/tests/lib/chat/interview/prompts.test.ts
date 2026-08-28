import { describe, expect, it } from "vitest";
import { buildInterviewPrompt } from "@/lib/chat/interview/prompts";
import type { RecallResponse, RecallResult } from "@/lib/hindsight";

const FACT: RecallResult = {
  id: "f1",
  text: "张伟在 Datatist 工作",
  type: "observation",
  context: null,
  metadata: null,
  tags: null,
  entities: null,
  occurred_start: null,
  occurred_end: null,
  mentioned_at: null,
  document_id: null,
  chunk_id: null,
  source_fact_ids: null,
  scores: null,
};

describe("buildInterviewPrompt", () => {
  it("echoes the user query verbatim", () => {
    const prompt = buildInterviewPrompt({
      query: "张伟为什么离开 Datatist？",
      recall: { results: [] },
    });
    expect(prompt).toContain("张伟为什么离开 Datatist？");
  });

  it("includes the interview persona header", () => {
    const prompt = buildInterviewPrompt({
      query: "what",
      recall: { results: [] },
    });
    expect(prompt).toMatch(/访谈模块/);
    expect(prompt).toMatch(/反问一次/);
  });

  it("renders the empty-memory branch with an explicit explanation", () => {
    const prompt = buildInterviewPrompt({
      query: "what",
      recall: { results: [] },
    });
    expect(prompt).toMatch(/暂无.*与该问题相关的事实/);
    expect(prompt).toMatch(/这是为什么你被触发/);
  });

  it("falls back to empty-memory wording when recall is null", () => {
    const prompt = buildInterviewPrompt({
      query: "what",
      recall: null,
    });
    expect(prompt).toMatch(/暂无.*与该问题相关的事实/);
  });

  it("renders present facts with their type labels when recall has data", () => {
    const prompt = buildInterviewPrompt({
      query: "what",
      recall: { results: [FACT] },
    });
    expect(prompt).toContain("1. [提炼事实] 张伟在 Datatist 工作");
  });

  it("inverts the task description vs main agent", () => {
    const prompt = buildInterviewPrompt({
      query: "what",
      recall: { results: [] },
    });
    // Main agent says "基于这些事实回答"; interview says 反问, not 回答.
    expect(prompt).toMatch(/你的工作不是回答/);
    expect(prompt).not.toMatch(/基于这些事实回答/);
  });

  it("gives concrete strategies for fact / cause / preference queries", () => {
    const prompt = buildInterviewPrompt({
      query: "what",
      recall: { results: [] },
    });
    expect(prompt).toMatch(/事实类/);
    expect(prompt).toMatch(/因果类/);
    expect(prompt).toMatch(/偏好类/);
  });

  it("carries over the no-fabrication rule from main agent", () => {
    const prompt = buildInterviewPrompt({
      query: "what",
      recall: { results: [] },
    });
    expect(prompt).toMatch(/不要编造或猜测/);
    expect(prompt).toMatch(/不要向用户暴露具体的 fact ID/);
  });

  it("tells the LLM to stop after one question (no self-answering)", () => {
    const prompt = buildInterviewPrompt({
      query: "what",
      recall: { results: [] },
    });
    expect(prompt).toMatch(/反问后.*停止/);
    expect(prompt).toMatch(/不要替用户回答/);
  });

  it("does not depend on the recall.results field being well-formed", () => {
    const prompt = buildInterviewPrompt({
      query: "what",
      recall: { results: undefined } as unknown as RecallResponse,
    });
    expect(prompt).toMatch(/暂无.*与该问题相关的事实/);
  });
});