import type { RecallResponse } from "./hindsight";

const BASE_PERSONA = `你是一个拥有长期记忆的智能助手，能够综合利用你自己的知识和用户的长期记忆库来回答问题。`;

const INSTRUCTIONS = `回答时请遵循以下规则：
1. 如果长期记忆中包含与问题相关的事实，请基于这些事实回答。
2. 如果长期记忆中的信息与你自身的知识存在矛盾，优先以**最新保留的事实**为准（记忆反映了用户的最新偏好或决定）。
3. 如果长期记忆中**没有**相关信息，请如实告知用户，不要编造或猜测。
4. 不要向用户暴露具体的 fact ID 或记忆系统内部细节，但可以自然地说"根据你的历史记忆..."或"你之前提到过..."。`;

function formatFacts(recall: RecallResponse): string {
  if (!recall.results || recall.results.length === 0) {
    return "（用户的长期记忆中暂无与该问题相关的事实）";
  }

  return recall.results
    .map((r, i) => {
      const typeLabel =
        r.type === "observation"
          ? "提炼事实"
          : r.type === "world"
            ? "客观事实"
            : "经历";
      const contextPart = r.context ? ` [${r.context}]` : "";
      const entitiesPart =
        r.entities && r.entities.length > 0
          ? `（相关实体：${r.entities.join("、")}）`
          : "";
      return `${i + 1}. [${typeLabel}${contextPart}] ${r.text}${entitiesPart}`;
    })
    .join("\n");
}

/**
 * Build the system prompt for the main agent. Injects recalled memories as
 * a structured "long-term memory" section so the LLM can use them naturally.
 */
export function buildSystemPrompt(recall: RecallResponse): string {
  return `${BASE_PERSONA}

# 用户的长期记忆（来自 Hindsight）

${formatFacts(recall)}

${INSTRUCTIONS}`;
}
