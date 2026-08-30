# Phase 3 Design：多轮访谈 Agent

## Context

**当前状态**（Phase 2 v1 已上线）：

- 单轮访谈：`recallMemories` 空 → 反问一次 → 用户答 → 一次性 retain
- 服务端**无 session 状态**：多轮完全靠 `app/page.tsx` 的 `interviewPairs` React useState + AI SDK 自动把 messages 数组回传 server；refresh / 关 tab / 换设备 = 全丢
- `data-interview-state` part 不带 session id，仅用于本 tab 内 UI 派生
- Phase 2 萃取的 fact 是"第一层回答"，缺背景 / 判断 / 反例，recall 时容易被错配的 query 召回（高 recall 但低 precision）

**约束**：

- 复用 Hindsight v0.9.2（`localhost:8888` 已跑通）作为 recall / retain 后端；**session 存储改用 host `postgres` 容器（`pgvector/pgvector:pg16`，监听 `localhost:5432`）** —— 2026-08-29 实施时发现 Hindsight 的 PG 不暴露给 host，独立 PG + 独立 schema 更更合适（设计修正，详见 D1）
- 不引入 workflow 框架引擎（Mastra / Vercel Workflow / Inngest 调研后判定净收益为负）
- 不引入 Mastra Memory（避免与 Hindsight 重复）
- 工程文化：纯函数 + DI seam + vitest + TypeScript strict
- 模型：复用主 Agent 的 qwen-plus（Q2 已决策）

**干系人**：

- 用户（"专家"）：被访谈的领域专家
- LLM（qwen-plus）：访谈执行者
- Hindsight：知识存储后端
- Postgres：新增 session 存储（独立 schema）

## Goals / Non-Goals

**Goals**：

- 抽象判断类问题（"为什么这样设计"）进 3-5 轮追问，背景 → 判断 → 依据 → 反例 全覆盖
- 简单事实类问题保持单轮（Phase 2 行为不变）
- session 跨刷新 / 关 tab / 换设备能续上
- 矛盾访谈走 PATCH + POST 显式替换，不静默
- 专家随时可「够了」或「放弃」，Classifier 不强行追问
- 现有 72 个 vitest 用例不受影响；新增 ≥40 个 Phase 3 测试

**Non-Goals**：

- 不做 workflow 引擎 / DurableAgent / 重试幂等（Phase 5/6 后再考虑，触发条件见 ROADMAP §7）
- 不做用户审核 UI（Phase 5 IA-5 Knowledge Card Renderer）
- 不做 Knowledge Extractor 把多轮 Q/A 整理成结构化知识卡（Phase 4 IA-4；Phase 3 只做 dry-run-extract 预览）
- 不做 recall 评估指标 / Phase 6 评测（Phase 6）
- 不做多 bank / 多用户权限（Phase 7）

## Decisions

### D1：Session 持久化方案 — host `postgres` 容器 + 新 schema `chatbot_interview`

**为什么**：

- Host `postgres` 容器（pgvector/pgvector:pg16）已在运行（与 Hindsight / lightrag / paperclip 等共用 host PG）
- 复用现有 PG = 零新基础设施
- 新 schema 隔离，不污染 Hindsight 表
- **2026-08-29 实施修正**：原本计划复用 Hindsight PG，但发现 Hindsight 的 PG 不暴露给 host，所以改为用 host 自己的 `postgres` 数据库 + `chatbot_interview` schema。这个调整反而**更干净**——彻底隔离 Hindsight 与 chatbot 状态，避免未来 Hindsight 升级影响 chatbot

**替代方案考虑**：

- ❌ SQLite：单文件部署麻烦、并发弱
- ❌ 存 Hindsight 本身（用 recall 反查 session）：Hindsight 是向量库，不是 KV 库，schema 不匹配
- ❌ Vercel KV / Upstash Redis：引入新 SaaS + 新账单，违反"零新基础设施"
- ✅ **host PG 新 schema**——胜出

**PG 客户端选型**：

- `pg`（node-postgres）：官方、低层、控制力强
- `postgres-js`（实际 npm 包名是 `postgres`）：现代 API、Promise-first、bundle 小
- Prisma / Drizzle：ORM 层，杀鸡用牛刀 + 增加学习成本
- → **`postgres`（postgres-js）**（与项目"轻量 + 现代"风格一致）

### D2：Complexity Classifier 接口化（Strategy pattern）

**为什么**：

- 启发式规则的覆盖率有限，灰区需要 LLM fallback
- 未来可能换专用分类模型（微调小模型）
- 接口化后任何实现可 A/B 替换，不影响上游
- 单测友好（mock Classifier 测 state machine）

**架构**：

```typescript
interface ComplexityClassifier {
  classify(input: { query: string; recall: RecallResult[] }): Promise<Classification>;
}

interface Classification {
  complexity: 'simple' | 'decision' | 'abstract';
  event_type?: 'success' | 'failure' | 'misjudgment' | 'counterintuitive' | 'fact';
  needs_conflict_check: boolean;
  reasoning?: string;
  confidence: number;  // < 0.6 触发 LLM fallback
}
```

**实现顺序**：

1. `RuleBasedClassifier`（默认）：10-20 条关键词 + 正则 + 启发式
2. `HybridClassifier`（fallback）：先规则，confidence < 0.6 发 LLM 调用
3. `LLMClassifier`（纯 LLM）：Phase 6 评估后看是否值得保留
4. 专用分类模型（未来）

**防"作死"原则**：

- 规则宁少勿多，每条都要单测
- 灰区默认走更深的追问（prefer 多轮）—— 与"宁多问不漏挖"哲学一致
- LLM fallback 触发要记日志，Phase 6 调优

### D3：State machine = 纯函数 `nextTurn(state, action)`

**为什么**：

- 与现有 `extractUserQuery` / `mode-router` 风格一致
- 单测友好（给定 state + action → nextState，无 IO 副作用）
- DI seam 复用现有 `composeInterview` 的依赖注入模式

**API**：

```typescript
type InterviewAction =
  | { kind: 'user_answer'; answer: string }
  | { kind: 'user_finish' }       // 「够了」
  | { kind: 'user_abandon' }      // 「放弃」
  | { kind: 'conflict_decision'; verdict: 'typo' | 'serious' };

function nextTurn(
  state: InterviewSessionState,
  action: InterviewAction,
  deps: { llm: LLMClient; recall: RecallFn; persist: PersistFn; invalidate: InvalidateFn },
): Promise<{ state: InterviewSessionState; ui: UIDirective }>;
```

**UI directive 类型**：

- `{ kind: 'ask_question'; question: string }` —— 让用户回答
- `{ kind: 'show_conflict'; facts: ConflictPair[] }` —— 让用户判定
- `{ kind: 'finished'; items: RetainItem[] }` —— 让 UI 跳转审核（Phase 5）
- `{ kind: 'abandoned' }` —— 让 UI 重置

### D4：Session 表设计

```sql
CREATE SCHEMA IF NOT EXISTS chatbot_interview;

CREATE TABLE chatbot_interview.interview_sessions (
  session_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id      TEXT NOT NULL,
  query        TEXT NOT NULL,                       -- 用户最初问的问题
  classification JSONB NOT NULL,                   -- Classifier 输出
  turns        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{q, a, dimension, ts}] 多轮累积
  round        INTEGER NOT NULL DEFAULT 0,
  state        TEXT NOT NULL DEFAULT 'active',     -- active | finished | abandoned
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interview_sessions_bank_state ON chatbot_interview.interview_sessions(bank_id, state);
CREATE INDEX idx_interview_sessions_updated_at ON chatbot_interview.interview_sessions(updated_at);
```

**为什么不用 document_id / tags**：Hindsight retain 时才用 document_id / tags 把同一访谈的多个 fact 串起来；session 表本身就是访谈来源的 source of truth，不需要重复。

### D5：API 端点拆分（5 个）

| 端点 | 方法 | 用途 | 谁调 |
|---|---|---|---|
| `/api/interview/session` | POST | 创建新 session + 第一轮反问 | UI 首次进 interview mode |
| `/api/interview/session?session_id=X` | GET | 恢复 session（refresh 后） | UI 启动时 |
| `/api/interview/session` | PATCH | 推进 session（用户回答 / 矛盾判定） | UI 每轮交互 |
| `/api/interview/session/[id]/finish` | POST | 「够了」走 retain | UI 按钮 |
| `/api/interview/session/[id]/abandon` | POST | 「放弃」清空 | UI 按钮 |

> 注：proposal 里的 `/session/[id]/replace` 合并到 PATCH（用 `conflict_decision` action 区分），更 RESTful

**为什么不沿用 Phase 2 的 `/api/interview`**：Phase 2 是"批处理"接口（items: [Q,A] 一次性提交），Phase 3 是"会话"接口（每轮 PATCH 推进），两者语义不兼容；新接口用 `/api/interview/session/*` 前缀明确区分

### D6：Hindsight API 集成（基于 2026-08-29 实测）

**新增 2 个 client 方法**（在 `chatbot/lib/hindsight.ts`）：

```typescript
// 用于 Q4 认真分支
async function invalidateMemory(memoryId: string): Promise<void> {
  await fetch(`${API}/v1/default/banks/${BANK}/memories/${memoryId}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'invalidated' }),
  });
}

// 用于 IA-4 预览
async function dryRunExtract(content: string, context: string): Promise<ExtractedFact[]> {
  const res = await fetch(`${API}/v1/default/banks/${BANK}/memories/dry-run-extract`, {
    method: 'POST',
    body: JSON.stringify({ content, context }),
  });
  return (await res.json()).facts;
}
```

**关键发现**：Hindsight 不做自然 dedup，同样内容两次 retain → 2 个独立 facts——所以 Q4 "认真 → 替换"必须主动 PATCH + POST，**不能依赖 API 自动行为**

### D7：专家主动控制（UI 双按钮）

- 「够了」：调 `/finish` → 走 retain 流程（Phase 4/5 接管）
- 「放弃」：调 `/abandon` → session 状态置 `abandoned`，UI 重置 chat mode
- 按钮在 interview mode header 右侧，与现有「完成」按钮位置一致
- 视觉：「够了」用绿（保留）、「放弃」用灰（中性，不红避免误点击）

**为什么不放"取消"**：与现有 chat 模式 escape 冲突；专家用「放弃」语义清晰

### D8：Interview Strategy prompt 模板

借鉴 matrix 项目萃取流程 §2，每个事件类型一套 prompt 模板：

```typescript
// lib/chat/interview/strategies.ts

const STRATEGY_PROMPTS = {
  success: `回忆一个超预期成功...`,
  failure: `回忆一个失败案例...`,
  misjudgment: `回忆一次判断错误...`,
  counterintuitive: `回忆一个"按理不行但实际成了"...`,
  fiveWhys: `用五要素挖法：触发事件 → 观察信号 → 判断标准 → 行动方案 → 结果验证...`,
  boundaryProbe: `你刚才说"如果 A 就 B"，有没有 A 但不是 B 的情况？...`,
};
```

LLM 选 strategy → 生成 question → 用户答 → nextTurn 推 state

## Risks / Trade-offs

| # | Risk | Mitigation |
|---|---|---|
| R1 | Vercel serverless 函数超时（Hobby 10s / Pro 60s）打断多轮 LLM 调用 | Phase 3 多轮每轮 LLM 调用平均 <5s，预留 buffer；监控 P95 调用时长，超 80% 上限就警告 |
| R2 | PG 连接池耗尽（多用户并发） | 用 `postgres-js` 自带 pool；Phase 3 demo 阶段 1 用户够用；监控 `pool.totalCount` / `pool.waitingCount` |
| R3 | abandoned session 长期堆积 | 加 `updated_at` 索引；cron 每日清理 `state='abandoned'` 且 `updated_at < NOW() - 7 days` 的 session |
| R4 | LLM fallback 成本爆炸（Classifier 误判率高 → fallback 频繁） | fallback 触发记日志（type、confidence、query）；Phase 6 评估后调优规则；规则宁少勿多减少误判 |
| R5 | Classifier 灰区误判（简单问题被分到多轮 / 复杂问题被分到单轮） | "宁多问不漏挖" 哲学：prefer 多轮；专家可主动「够了」提前结束 |
| R6 | 同用户并发多 session 状态错乱 | `session_id` 唯一 + Postgres 行级锁 + UI 端禁用"同时开两个访谈"按钮 |
| R7 | Q4 矛盾判定后 PATCH 失败（网络抖动） | 两步走，PATCH 失败时不 retain 新 fact，给用户 retry；PATCH 成功但 POST 失败 → 下次访谈 recall 命中矛盾再处理 |
| R8 | 「放弃」session 审计缺失 | abandoned session 仍保留行（不删），加 `state='abandoned'` 标记；`audit_log` 表（Phase 6）记录放弃事件 |
| R9 | PG schema 迁移与 Hindsight 升级冲突 | schema 名 `chatbot_interview` 加项目前缀；Hindsight 升级时确保不破坏其他 schema |
| R10 | Classifier 接口化后默认实现 vs LLM fallback 行为不一致 | 统一 `Classification` schema（Zod 校验）；每个实现都单测 |

## Migration Plan

**Phase A — Schema migration**（最先做，零功能风险）：

1. 写 SQL DDL：CREATE SCHEMA + CREATE TABLE + INDEX
2. 跑迁移脚本验证（用测试 bank）
3. 不影响现有 Hindsight 表

**Phase B — Feature flag 暗启动**：

1. 在 `chatbot/lib/chat/mode-router.ts` 加 feature flag `ENABLE_MULTI_TURN_INTERVIEW`（默认 off）
2. flag off 时走 Phase 2 行为（单轮）
3. flag on 时走新 state machine
4. 部署后可立即 rollback（关 flag）

**Phase C — Classifier + state machine 上线**：

1. 部署 `ComplexityClassifier` 接口 + `RuleBasedClassifier` 默认实现
2. 部署 `nextTurn` 纯函数
3. 部署新 API 端点
4. flag on，灰度 1 用户（zhangwei bank）

**Phase D — Conflict resolution + 主动控制**：

1. 部署 Q4 PATCH + POST 双步流程
2. 部署 UI 「够了」/「放弃」按钮
3. 全量开放

**回滚策略**：

- feature flag 立即关（Phase 2 行为完全保留）
- 不删 schema（数据保留，回滚可继续用）
- 不删代码（feature flag 控制可达性）

**数据迁移**：无（Phase 2 无 session 数据）

## Open Questions

| # | 问题 | 触发时机 | 状态 |
|---|---|---|---|
| Q-Phase3-1 | PG 客户端：`pg` vs `postgres-js`？ | 编码前 | ✅ **定 `postgres-js`**（npm 包名 `postgres`，现代 API）） |
| Q-Phase3-2 | abandoned session 保留多久？cron 清理周期？ | Phase A 编码前 | 默认 7 天（占位，Phase 6 调） |
| Q-Phase3-3 | Classifier fallback 日志存哪？Postgres / 本地文件 / 外部服务？ | Phase 6 之前 | 默认 Postgres（同一 PG 实例） |
| Q-Phase3-4 | UI 「够了」/「放弃」按钮：放 header 还是放 footer？移动端响应式？ | UI 设计时 | 倾向 header（与「完成」按钮位置一致） |
| Q-Phase3-5 | 同用户多 session 是否要支持？demo 阶段可以禁用？ | 编码前 | 倾向 Phase 3 禁用（1 用户 1 session），Phase 7 放开 |
| Q-Phase3-6 | Interview Strategy prompt 是否要支持多语言（中英）？ | 编码前 | 倾向 Phase 3 只做中文（与目标用户一致） |
