/**
 * Interview strategy — prompt templates for the 4 event types + helpers.
 *
 * Borrowed from the matrix project (`extraction-flow.md` §2.1 / §2.2 / §2.3):
 *   - 4 event-type templates (success / failure / misjudgment / counterintuitive)
 *   - Five-element mining (Trigger / Signal / Criterion / Action / Outcome)
 *   - Boundary probing ("如果 A 就 B，那 A 但不是 B 的情况？")
 *
 * These are pure string templates — the state machine fills in the current
 * state and asks the LLM to generate the next question.
 */

import type { InterviewSessionState, InterviewTurn } from "./state";

export const STRATEGY_PROMPTS = {
  success: `回忆一个超预期成功的案例：
1. 当时什么场景？
2. 最关键转折点是什么？
3. 当时你为什么那么做？
4. 如果重来一次会怎么做？`,

  failure: `回忆一个失败案例：
1. 最早哪里出问题？
2. 当时为什么没发现？
3. 后来你怎么看？
4. 当时有反常信号吗？`,

  misjudgment: `回忆一次你判断错误的情况：
1. 你原本怎么判断的？
2. 实际发生了什么？
3. 偏差出在哪个环节？
4. 下次会怎么调整？`,

  counterintuitive: `回忆一个"按理说不行但实际成了"的案例：
1. 当时别人怎么看？
2. 你为什么坚持？
3. 关键变量是什么？
4. 这个变量能复制吗？`,
} as const;

export const FIVE_WHYS_PROMPT = `用五要素挖法深挖这次回答：
1. 触发事件（Trigger）：什么场景下做这个判断？
2. 观察信号（Signal）：看到/听到了什么？
3. 判断标准（Criterion）：凭什么这么判断？
4. 行动方案（Action）：判断后做了什么？
5. 结果验证（Outcome）：结果如何？反例是什么？`;

export const BOUNDARY_PROBE_PROMPT = `你刚才说的规则如果有边界或例外，请主动指出：
- 有没有 A 但不是 B 的情况？
- 有没有不是 A 但也是 B 的情况？
- 边界在哪里？A 加强到什么程度 B 才稳定？`;

export type EventTypeKey = keyof typeof STRATEGY_PROMPTS;

export function selectEventTypePrompt(
  eventType: string | undefined,
): string | null {
  if (!eventType) return null;
  if (eventType in STRATEGY_PROMPTS) {
    return STRATEGY_PROMPTS[eventType as EventTypeKey];
  }
  return null;
}

/**
 * Build a system prompt for the LLM to generate the next interview
 * question. Strategy depends on round number and the event_type.
 */
export function buildInterviewSystemPrompt(
  state: InterviewSessionState,
): string {
  const eventPrompt = selectEventTypePrompt(state.classification.event_type);
  const strategy =
    state.round === 0 ? (eventPrompt ?? FIVE_WHYS_PROMPT) : FIVE_WHYS_PROMPT; // subsequent rounds dig deeper via 5-element

  return `你是一个知识萃取助手，正在向专家做多轮访谈。目标是从专家的回答中萃取出能 recall 命中的高质量事实。

## 当前访谈
- 原始问题：${state.query}
- 复杂度：${state.classification.complexity}
- 事件类型：${state.classification.event_type ?? "无（通用追问）"}
- 当前轮次：${state.round} / ${state.maxRounds}
- 已问轮次：${state.turns.length}

## 追问策略
${strategy}

## 边界探针
${BOUNDARY_PROBE_PROMPT}

## 输出要求
- 只输出下一个要问的问题（一句话，不要分析）
- 不要重复已问过的问题
- 围绕专家最未说清楚的地方追问
- 优先问"为什么/基于什么/有什么例外"`;
}

export function buildInterviewUserPrompt(
  state: InterviewSessionState,
  lastAnswer?: string,
): string {
  const lastTurn: InterviewTurn | undefined =
    state.turns[state.turns.length - 1];
  // For the very first round, the "last question" is the user's original query.
  const lastQ = lastTurn?.q ?? state.query;
  const lastA = lastAnswer ?? lastTurn?.a ?? "(尚未回答)";
  return `上一个问题：${lastQ}
专家回答：${lastA}

请基于以上信息生成下一个追问。`;
}
