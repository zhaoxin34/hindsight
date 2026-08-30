# Phase 3：多轮访谈 Agent

## Why

Hindsight Chatbot Phase 2 已实现单轮访谈（recall 空 → 反问一次 → retain），但抽象判断类问题（"为什么这样设计"）只能挖到第一层就结束，知识萃取质量低。Phase 3 升级为多轮追问（3-5 轮），让 Agent 能像真人访谈一样层层追问背景、判断标准、反例，从而萃取出能真正 recall 命中的高质量知识卡。

## What Changes

- **多轮访谈能力**：抽象判断类问题进 3-5 轮，简单事实类仍保持单轮（Phase 2 行为不变）
- **Interview Strategy**：根据问题类型切换追问模板——借鉴 matrix 项目萃取流程 §2 的 4 类事件模板 + 五要素挖法 + 边界挖掘
- **Complexity Classifier 升级**：从 Phase 2 的"是否进访谈"二态判断，升级为"复杂度（simple/decision/abstract）+ 事件类型 + 是否触发矛盾检查"三维度输出；接口化（Strategy pattern），默认启发式实现，置信度低 fallback 到 LLM
- **多轮 session 持久化**：session 存在 Postgres `chatbot_interview` schema，刷新页面 / 关 tab / 换设备能续上面试
- **Q4 矛盾处理**：recall 命中与新问题矛盾的旧 facts 时，把矛盾内容展示给专家，让他判定"口误/认真"；判定为"认真"走 `PATCH /memories/{id} {state: "invalidated"}` + `POST /memories` 双步替换；判定为"口误"继续访谈不替换
- **专家主动控制**：访谈中任何轮次专家可点「够了」结束（走 retain 流程）或「放弃」取消（不 retain，访谈结果丢弃）——这是 Classifier 的"防作死"机制，确保 Agent 不强行追问
- **dry-run-extract 预览**：IA-4 萃取知识卡前先调 `POST /memories/dry-run-extract` 预览会萃取出什么 facts，避免 retain 后才发现提取不对

## Capabilities

### New Capabilities

- `multi-turn-interview`：多轮访谈 Agent 编排能力（state machine + Composer + 跨 session 续上）。这是 Phase 3 的核心能力，覆盖 nextTurn state machine、IA-1 Trigger 升级、IA-6 Dialogue State 多轮 session
- `interview-strategy`：追问策略生成能力。给定当前对话上下文（已问轮次、专家回答、recall 命中 facts），生成下一轮的反问；支持 4 类事件模板（成功/失败/判断失误/反直觉）+ 五要素挖法 + 反例探针
- `complexity-classification`：问题复杂度判定能力。Strategy pattern 接口化，默认 `RuleBasedClassifier`（关键词 + 正则 + 启发式，10-20 条规则），置信度低 fallback 到 `LLMClassifier`；返回 `{ complexity, event_type?, needs_conflict_check, confidence }`
- `interview-session-persistence`：访谈 session 跨刷新持久化能力。基于 Postgres `chatbot_interview` schema，session 表存 `session_id` / `bank_id` / `turns` JSONB / `round` / `complexity` / `state` / `created_at` / `updated_at`
- `conflict-resolution`：多次访谈矛盾处理能力。recall 命中矛盾 facts 时显式提示专家 → 判定口误/认真 → 认真走 `PATCH + POST` 替换；口误继续访谈并打 `context="correction_of_session_<id>"` 留审计痕迹
- `expert-active-control`：专家在访谈中主动控制能力。UI 提供「够了」/「放弃」两个按钮，贯穿 Phase 3-5；「够了」→ 走 retain 流程；「放弃」→ 访谈结果全部丢弃不 retain

### Modified Capabilities

- （无 — `openspec/specs/` 当前为空，本次 PR 是首次建立规格）

## Impact

**受影响代码**：

- `chatbot/lib/chat/interview/*`（composer.ts / prompts.ts）—— 升级为多轮 + 加 Classifier 注入
- `chatbot/lib/chat/mode-router.ts` —— 升级，集成 Classifier
- `chatbot/app/api/chat/route.ts` —— 接入 session 持久化
- `chatbot/app/api/interview/route.ts` —— 拆分 session 推进 + 最终 retain 两个端点
- `chatbot/app/page.tsx` —— UI 加「够了」/「放弃」按钮 + 跨刷新 resume hook
- `chatbot/lib/hindsight.ts` —— 新增 `invalidateMemory(id)` + `dryRunExtract(content, context)`

**新增依赖**：

- Postgres 客户端（`pg` 或 `postgres-js`）—— 复用 Hindsight 同 PG 实例（不同 schema，不污染 Hindsight 表）

**新增数据库对象**：

- schema `chatbot_interview` + 表 `interview_sessions`（+ 必要的索引 / 约束）

**新增 API 端点**：

- `GET /api/interview/session?session_id=<id>` —— 恢复 session
- `POST /api/interview/session` —— 推进 session（接收用户回答，返回 nextTurn）
- `POST /api/interview/session/[id]/finish` —— 专家点「够了」走 retain
- `POST /api/interview/session/[id]/abandon` —— 专家点「放弃」清空 session
- `POST /api/interview/session/[id]/replace` —— 矛盾处理"认真"分支：PATCH 老 + POST 新

**受影响测试**：

- vitest 需要新增：Classifier 规则测试、state machine 测试、session 持久化测试、Q4 矛盾流程 e2e
- 现有 72 个 vitest 用例保持不变

**暂未影响**（Phase 4-7 后续做）：

- IA-4 Knowledge Extractor（Phase 4）—— 但 dry-run-extract 是 Phase 3 引入的
- IA-5 Knowledge Card Renderer + 用户审核 UI（Phase 5）
- 评估指标（Phase 6）
