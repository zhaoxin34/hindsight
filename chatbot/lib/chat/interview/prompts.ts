/**
 * Interview agent prompts.
 *
 * The interview agent's job is the inverse of the main agent: instead of
 * answering, it asks ONE clarifying question to extract tacit knowledge.
 * Phase 2 v1 is single-turn — we don't yet plan multi-round interviews
 * (that lands in Phase 3 with the complexity classifier and session state).
 *
 * This module is intentionally pure — same shape as `system-prompt.ts` so
 * snapshot-style tests can lock the prompt format.
 */
import type { RecallResponse } from "@/lib/hindsight";

const BASE_PERSONA = `你是一个拥有长期记忆的智能助手的**访谈模块**。当主模块无法从长期记忆中召回相关事实时，你会被触发，目的是通过一次精准的反问，把用户**隐性知识**萃取出来，存入长期记忆。`;

const CITATION_RULES = `回答时请遵循以下规则：
1. 不要编造或猜测——你的工作不是回答，是**反问**。
2. 不要向用户暴露具体的 fact ID 或记忆系统内部细节。
3. 不要泛泛地说"你能详细说说吗"——反问要聚焦、最有歧义的一个点。`;

const TASK_INSTRUCTIONS = `# 你的任务

由于长期记忆中没有与用户问题相关的事实，你需要**反问一次**。反问后**停止**，等用户回答（不要替用户回答）。

## 反问策略

- 聚焦在用户原问题中**最有歧义**的一个点（背景？判断？依据？反例？）。
- 用用户能直接接话的具体措辞，不要抽象。
- 如果用户问题是事实类（如"张伟在哪工作？"），反问"你之前在哪工作？"或"现在呢？"——把时间维度逼出来。
- 如果是因果类（如"为什么离开 Datatist？"），反问"是主动的还是被动的？"——把归因逼出来。
- 如果是偏好类（如"你喜欢什么框架？"），反问"在什么场景下？"——把上下文逼出来。`;

function formatFacts(recall: RecallResponse | null | undefined): string {
  if (
    !recall ||
    !Array.isArray(recall.results) ||
    recall.results.length === 0
  ) {
    return "（用户的长期记忆中**暂无**与该问题相关的事实 —— 这是为什么你被触发）";
  }
  // Edge case: recall actually returned something. The router chose interview
  // (e.g. user explicitly asked to be interviewed). Honour the facts anyway.
  return recall.results
    .map(
      (r, i) =>
        `${i + 1}. [${r.type === "observation" ? "提炼事实" : r.type === "world" ? "客观事实" : "经历"}] ${r.text}`,
    )
    .join("\n");
}

export interface InterviewPromptInput {
  query: string;
  recall: RecallResponse | null | undefined;
}

export function buildInterviewPrompt(input: InterviewPromptInput): string {
  return `${BASE_PERSONA}

# 用户当前的提问

${input.query.trim()}

# 当前长期记忆状态

${formatFacts(input.recall)}

${TASK_INSTRUCTIONS}

${CITATION_RULES}`;
}
