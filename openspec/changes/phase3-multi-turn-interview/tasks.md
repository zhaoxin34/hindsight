# Phase 3 多轮访谈 Agent — 实施任务清单

> 对应 specs：6 份（multi-turn-interview / interview-strategy / complexity-classification / interview-session-persistence / conflict-resolution / expert-active-control）
> 对应 design：8 项决策 + 4 阶段 migration plan

## 1. Schema migration 与 PG 客户端（对应 design D1 / D4）

- [x] 1.1 在 `chatbot/package.json` 加入 `postgres-js` 依赖（倾向选型，编码前最终确认）
- [x] 1.2 写 `chatbot/db/migrations/001_chatbot_interview_schema.sql`：CREATE SCHEMA `chatbot_interview` + CREATE TABLE `interview_sessions` + 2 个索引
- [x] 1.3写 `chatbot/lib/db/client.ts`：postgres-js 连接池单例（复用 Hindsight PG 连接串，独立 schema）
- [x] 1.4写 `chatbot/lib/db/sessions.ts`：`createSession` / `getSession` / `updateSession` / `markAbandoned` / `cleanupStale` 5 个 CRUD 纯函数
- [x] 1.5 跑 migration 脚本验证 schema + table + 索引 正确创建（用 zhangwei bank 之外的测试连接）
- [x] 1.6vitest：写 sessions.ts 5 个 CRUD 的单测（mock postgres-js）

## 2. Complexity Classifier 接口与实现（对应 design D2 / spec complexity-classification）

- [x] 2.1创建 `chatbot/lib/chat/classifier/types.ts`：导出 `ComplexityClassifier` interface + `Classification` Zod schema
- [x] 2.2创建 `chatbot/lib/chat/classifier/rule-based.ts`：`RuleBasedClassifier` 默认实现，10-20 条规则（关键词 + 正则 + 启发式）
- [x] 2.3创建 `chatbot/lib/chat/classifier/llm.ts`：`LLMClassifier` 纯 LLM 实现（复用 chat LLM client）
- [x] 2.4创建 `chatbot/lib/chat/classifier/hybrid.ts`：`HybridClassifier` 包装 RuleBased + LLM fallback @ confidence < 0.6
- [x] 2.5在 `HybridClassifier` 内集成 fallback 日志（写 Postgres `chatbot_interview.classifier_fallback_log` 表）
- [x] 2.6vitest：RuleBasedClassifier 每条规则独立单测（rule-level 覆盖率）
- [x] 2.7vitest：HybridClassifier fallback 触发条件测试（mock LLM）
- [x] 2.8vitest：所有实现的 Zod schema 校验测试（拒绝非法输出）

## 3. Interview State machine（对应 design D3 / spec multi-turn-interview）

- [x] 3.1创建 `chatbot/lib/chat/interview/state.ts`：导出 `InterviewSessionState` / `InterviewAction` / `UIDirective` TypeScript 类型
- [x] 3.2创建 `chatbot/lib/chat/interview/strategies.ts`：4 类事件 prompt 模板 + 五要素挖法 + 边界探针（借鉴 matrix §2）
- [x] 3.3创建 `chatbot/lib/chat/interview/state-machine.ts`：实现 `nextTurn(state, action, deps)` 纯函数
- [x] 3.4nextTurn 支持 4 种 action：`user_answer` / `user_finish` / `user_abandon` / `conflict_decision`
- [x] 3.5nextTurn 返回 4 种 UIDirective：`ask_question` / `show_conflict` / `finished` / `abandoned`
- [x] 3.6vitest：nextTurn 确定性测试（相同输入 → 相同输出，无 IO 副作用）
- [x] 3.7vitest：nextTurn 各 action / directive 路径分支测试
- [x] 3.8vitest：策略模板选择测试（event_type → 模板映射）

## 4. Hindsight Client 扩展（对应 design D6）

- [x] 4.1在 `chatbot/lib/hindsight.ts` 加 `invalidateMemory(memoryId)` 方法（PATCH /memories/{id} {state: "invalidated"}）
- [x] 4.2在 `chatbot/lib/hindsight.ts` 加 `dryRunExtract(content, context)` 方法（POST /memories/dry-run-extract）
- [x] 4.3vitest：两个新方法的 fetch mock 测试（成功 / 失败路径）

## 5. Conflict Resolution 流程（对应 design D6 / spec conflict-resolution）

- [x] 5.1创建 `chatbot/lib/chat/interview/conflict.ts`：矛盾检测函数（对比当前会话 context 与 recall facts）
- [x] 5.2实现 Q4 认真分支：先 invalidateMemory(oldId) → 成功才 retainMemories(newItem)
- [x] 5.3实现 Q4 口误分支：retain 时 tag `context="correction_of_session_<id>"`
- [x] 5.4实现 post-replacement verification：再 recall 一次验证老 fact 不在结果里
- [x] 5.5vitest：矛盾检测函数测试（一致 / 矛盾 query 样本）
- [x] 5.6vitest：Q4 双路径测试（mock fetch）
- [x] 5.7vitest：PATCH 失败时的回滚测试（不应 POST 新 fact）

## 6. API 端点（对应 design D5）

- [x] 6.1创建 `chatbot/app/api/interview/session/route.ts`：POST 创建 + GET 恢复
- [x] 6.2创建 `chatbot/app/api/interview/session/route.ts`：PATCH 推进（含 conflict_decision 分支）
- [x] 6.3创建 `chatbot/app/api/interview/session/[id]/finish/route.ts`：POST 走 retain 流程
- [x] 6.4创建 `chatbot/app/api/interview/session/[id]/abandon/route.ts`：POST 标 abandoned + UI 重置
- [x] 6.5所有端点加 Zod 校验 + 错误处理（400/403/404/500）
- [x] 6.6保留旧 `/api/interview` 端点（Phase 2 兼容，feature flag 控制可达性）
- [x] 6.7vitest：每个端点的 happy path + error path 测试（mock DB）

## 7. Mode Router 升级（对应 spec multi-turn-interview）

- [x] 7.1升级 `chatbot/lib/chat/mode-router.ts`：集成 ComplexityClassifier（注入 DI）
- [x] 7.2加 feature flag `ENABLE_MULTI_TURN_INTERVIEW`：false 时走 Phase 2 逻辑
- [x] 7.3升级 `chatbot/lib/chat/composer.ts`：把 Classifier 注入 interview composer
- [x] 7.4vitest：mode-router 单测（flag off / on 两路径 + Classifier mock）

## 8. UI 改造（对应 spec expert-active-control）

- [x] 8.1升级 `chatbot/app/page.tsx`：interview header 加 「够了」/「放弃」 两个按钮
- [x] 8.2升级 `app/page.tsx`：处理 4 种 UIDirective 的渲染分支
- [x] 8.3加「放弃」二次确认对话框（"确认放弃本次访谈？所有回答都不会保留"）
- [x] 8.4加 session resume hook：UI 启动时检查 active session，存在则恢复
- [x] 8.5加冲突提示 UI：side-by-side 显示旧 fact + 口误/认真双按钮
- [x] 8.6加 turn summary 显示（够了 后显示所有 Q/A 对，可编辑）
- [x] 8.7vitest：UI 组件测试（按钮存在性、UIDirective 渲染分支）

## 9. 基础设施与运维

- [x] 9.1加 cleanup cron / 手动脚本：清理 `state='abandoned'` 且 `updated_at < NOW() - 7 days` 的 sessions
- [x] 9.2加 `chatbot_interview.classifier_fallback_log` 表 + 写入逻辑
- [x] 9.3加 `ENABLE_MULTI_TURN_INTERVIEW` env var 处理（dotenv 兼容）
- [x] 9.4验证 Phase 2 行为：feature flag off 时单轮流程完全不变（72 个现有测试不需修改即可通过）
- [x] 9.5更新 `chatbot/AGENTS.md`：Phase 3 模块说明 + 新依赖 + 新测试

## 10. 集成测试与文档

- [x] 10.1e2e：完整 multi-turn 流程（用户问抽象题 → 3-5 轮 → 够了 → retain）
- [x] 10.2e2e：session 跨刷新恢复
- [x] 10.3e2e：Q4 矛盾流程（recall 命中矛盾 → 专家判定认真 → PATCH + POST）
- [x] 10.4e2e：够了/放弃 UI 交互
- [x] 10.5更新 `chatbot/README.md`：新 API 端点 + feature flag 说明
- [x] 10.6在 ROADMAP.md 变更日志追加 Phase 3 完成记录

---

## 完成定义（DoD）

- 全部 10 组任务 ✅
- 现有 72 个 vitest 用例 + 新增 ≥40 个 Phase 3 用例全部通过
- Phase 2 行为：feature flag off 时完全不变
- `chatbot_interview` schema 创建成功
- 多轮访谈端到端可走通（含跨刷新恢复 + Q4 矛盾处理 + 够了/放弃）
- ROADMAP.md Phase 3 Done 标准全部勾选
