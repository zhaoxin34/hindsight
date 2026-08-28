import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/system-prompt";
import type { RecallResponse, RecallResult } from "@/lib/hindsight";

/**
 * system-prompt is a pure function: a stable persona + a templated
 * "long-term memory" section + invariant instructions. We snapshot the
 * output to lock the format so that prompt regressions are caught in CI.
 *
 * Snapshots are intentional: the prompt shape is part of the contract with
 * the LLM. If you change the format, regenerate snapshots after reviewing
 * the diff carefully.
 */

const FACT_BASE: RecallResult = {
  id: "fact-1",
  text: "张伟在 Datatist 工作",
  type: "observation",
  context: "职业",
  metadata: null,
  tags: null,
  entities: ["张伟", "Datatist"],
  occurred_start: null,
  occurred_end: null,
  mentioned_at: null,
  document_id: null,
  chunk_id: null,
  source_fact_ids: null,
  scores: null,
};

describe("buildSystemPrompt", () => {
  it("renders the empty-memory branch with the standard placeholder", () => {
    const prompt = buildSystemPrompt({ results: [] });

    expect(prompt).toMatch(/长期记忆/);
    expect(prompt).toMatch(/暂无与该问题相关的事实/);
    expect(prompt).toMatch(/不要编造或猜测/);
  });

  it("includes the persona header in every output", () => {
    const withRecall = buildSystemPrompt({
      results: [FACT_BASE],
    });
    const withoutRecall = buildSystemPrompt({ results: [] });

    for (const prompt of [withRecall, withoutRecall]) {
      expect(prompt).toMatch(/你是一个拥有长期记忆的智能助手/);
    }
  });

  it("formats fact with observation/world/experience labels", () => {
    const observation = { ...FACT_BASE, id: "a", type: "observation" as const };
    const world = { ...FACT_BASE, id: "b", type: "world" as const };
    const experience = { ...FACT_BASE, id: "c", type: "experience" as const };

    const prompt = buildSystemPrompt({
      results: [observation, world, experience],
    });

    expect(prompt).toContain("1. [提炼事实 [职业]] 张伟在 Datatist 工作");
    expect(prompt).toContain("2. [客观事实 [职业]] 张伟在 Datatist 工作");
    expect(prompt).toContain("3. [经历 [职业]] 张伟在 Datatist 工作");
  });

  it("appends the entities clause when entities are present", () => {
    const prompt = buildSystemPrompt({ results: [FACT_BASE] });
    expect(prompt).toMatch(/相关实体：张伟、Datatist/);
  });

  it("omits the entities clause when entities are empty or null", () => {
    const noEntities = { ...FACT_BASE, id: "x", entities: null };
    const emptyEntities = { ...FACT_BASE, id: "y", entities: [] };

    for (const recall of [
      { results: [noEntities] },
      { results: [emptyEntities] },
    ]) {
      const prompt = buildSystemPrompt(recall);
      expect(prompt).not.toMatch(/相关实体/);
    }
  });

  it("omits the context bracket when context is null", () => {
    const noContext = { ...FACT_BASE, id: "nc", context: null };
    const prompt = buildSystemPrompt({ results: [noContext] });
    expect(prompt).toContain("1. [提炼事实] 张伟在 Datatist 工作");
    expect(prompt).not.toMatch(/提炼事实\s*null/);
  });

  it("numbers facts consecutively starting at 1", () => {
    const f1 = { ...FACT_BASE, id: "1", text: "第一" };
    const f2 = { ...FACT_BASE, id: "2", text: "第二" };
    const f3 = { ...FACT_BASE, id: "3", text: "第三" };

    const prompt = buildSystemPrompt({ results: [f1, f2, f3] });
    expect(prompt).toMatch(/1\.\s.*第一/);
    expect(prompt).toMatch(/2\.\s.*第二/);
    expect(prompt).toMatch(/3\.\s.*第三/);
  });

  it("tolerates a recall response where results is undefined", () => {
    const prompt = buildSystemPrompt({} as RecallResponse);
    expect(prompt).toMatch(/暂无与该问题相关的事实/);
  });

  it("inlines all four invariant instructions on every output", () => {
    const prompt = buildSystemPrompt({ results: [] });
    expect(prompt).toMatch(/1\.\s.*基于这些事实回答/);
    expect(prompt).toMatch(/2\.\s.*优先以.*最新保留的事实/);
    expect(prompt).toMatch(/3\.\s.*如实告知用户/);
    expect(prompt).toMatch(/4\.\s.*不要向用户暴露/);
  });
});
