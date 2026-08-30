# Phase 3 后续 TODO（2026-08-29 实施后）

> Phase 3 多轮访谈 Agent 已完成 61/61 任务，197 个单元测试通过。
> 本文档记录**已知问题 + Phase 4-7 衔接待办**。

---

## 🔴 P0 — 阻塞项（Phase 4 开工前必修）

### 1. 测试 isolation 问题

**症状**：`npx vitest run` 全量运行时，约 5 个 test 文件 fail；但单独跑每个文件都 pass。

**根因**：

- `vi.mock("@/app/api/interview/_lib/config", ...)` 在多个 test 文件中使用，跨文件泄漏
- `setMultiTurnEnabledForTest` 修改的模块级 mutable state 在不同 test 文件间不隔离
- `vi.hoisted` + `vi.mock` 在 use-session.test.ts 里的 client mock 与 sessions.test.ts 冲突

**影响**：CI 全量测试会 fail，但功能本身正常（单独跑通过）。

**修复方向**（任选一种）：

1. 每个 test 文件的 top-level `vi.mock` 改用 `vi.doMock` + `vi.resetModules`（作用域明确）
2. 加 `clearMocks: true, restoreMocks: true, mockReset: true` 到 `vitest.config.mts`
3. 把 config 模块改成 immutable — `setMultiTurnEnabledForTest` 改为返回新值而非修改全局
4. 把 ENABLE_MULTI_TURN_INTERVIEW 改成 vi.doMock + dynamic import 模式

**预计工作量**：1-2 小时

---

### 2. e2e 测试未跑过

**症状**：`tests/e2e/*.test.ts`（4 个文件：multi-turn-flow / cross-refresh / q4-conflict / finish-abandon）从未实际跑过，因为它们需要：

- Hindsight 在 `localhost:8888` 运行
- Next.js dev server 在 `localhost:3000` 运行
- `ENABLE_MULTI_TURN_INTERVIEW=true` 环境变量
- Postgres 在 `localhost:5432` 运行

**影响**：e2e 测试可能因为 URL 拼写、route handler 集成等问题 fail 而没发现。

**修复方向**：

1. 加 `package.json` 脚本：`"test:e2e": "ENABLE_MULTI_TURN_INTERVIEW=true concurrently npm:dev npm:docker:up vitest tests/e2e"`
2. 在 CI 中加 e2e job（需要 Postgres + Hindsight services）
3. 或改为 Playwright 真实浏览器 e2e

**预计工作量**：2-3 小时（Playwright 集成）或 1 小时（仅加 npm script）

---

## 🟡 P1 — Phase 4 开工前建议

### 3. Knowledge Extractor（IA-4）

**当前状态**：Group 5 已实现 `dryRunExtract` Hindsight 端点（只是工具，没接业务逻辑）。

**待做**：

- 把多轮访谈的 `turns[]` → `RetainItem[]` → 调 `retainMemories` 落库
- 在 `finished` UI directive 时机自动落库
- 处理用户中途点「够了」的场景（已经是 finished 状态，但 retain 没执行）

**预计工作量**：2-3 小时

### 4. Classifier fallback 日志接入

**当前状态**：表 `chatbot_interview.classifier_fallback_log` 已建好，`PostgresFallbackLog` 类已写，但**没在 route 里注入**（hybrid classifier 还在用默认 `noopFallbackLog`）。

**待做**：

- 在 `app/api/interview/_lib/engine.ts` 注入 `PostgresFallbackLog`
- 添加 `classifier_fallback_log` 查询端点（供 Phase 6 评估使用）

**预计工作量**：1 小时

### 5. Hindsight config trait 注入

**当前状态**：`app/api/interview/_lib/llm.ts` 用 hardcoded `qwen-plus`。

**待做**：

- 通过 env var 允许切换 model（Phase 6 A/B test 用）
- 加 Hindsight bank_id 通过 header 传入（Phase 7 多用户用）

**预计工作量**：0.5 小时

---

## 🟢 P2 — Phase 5 / 6 开工前

### 6. 知识卡审核 UI（IA-5 / UI-2）

**当前状态**：Phase 5 done 标准在 ROADMAP，但**完全没实施**。

**待做**：

- 在 `MultiTurnPanel.FinishedPanel` 加 "编辑" 入口
- 单卡编辑 UI（content + context + tags）
- 批量审核（接受/拒绝）
- 调 `retainMemories` / `invalidateMemory` 落库

**预计工作量**：4-6 小时

### 7. Phase 6 评估指标

**待做**：

- 建立 recall 测试集（人工标注 50+ 问题 + 期望命中）
- 实现 recall 命中率统计脚本
- 跑 Classifier 在 100+ query 上的准确率评估
- 用 fallback 日志找规则覆盖盲区

**预计工作量**：1-2 天（含测试集标注）

### 8. 监控 / 可观测性

**待做**：

- LLM 调用 P95 时长监控
- PG 连接池使用率
- Session 增长率 / abandonment 率
- 接入 Prometheus（基于 Hindsight 自带 `/metrics`）

**预计工作量**：1 天

---

## 🔵 P3 — Phase 7（生产化）

### 9. 多用户 / 鉴权

**待做**：

- API key / OAuth 鉴权
- Bank 隔离（Q6 决议）
- rate limiting

### 10. 部署

**待做**：

- Dockerfile + Vercel deploy config
- 环境变量管理（密钥）
- DB 备份（Hindsight PG + chatbot_interview schema）
- README 加 5 分钟复现部署指南

---

## 📋 Open ROADMAP Questions（待讨论）

| 编号 | 问题 | 触发时机 |
|---|---|---|
| Q2 | 访谈 Agent model 选型 | ✅ 已解决（复用 qwen-plus） |
| Q3 | 知识卡 schema | ✅ 已解决（借鉴 matrix §6.6） |
| Q4 | 矛盾访谈处理 | ✅ 已解决（API + PATCH/POST 已验） |
| Q5 | 是否做"主动学习"（Agent 发现知识缺口主动访谈）| Phase 6 后讨论 |
| Q6 | 多人共用 Hindsight 还是单人？多 bank 怎么组织？ | Phase 7 设计前讨论 |

---

## 📊 实施统计（Phase 3）

| 指标 | 数值 |
|---|---|
| Tasks | 61/61 ✓ |
| Source 文件 | 22 个新增 |
| Test 文件 | 18 个新增 |
| 单元测试 | 197 个（按文件单独跑全部通过）|
| e2e 测试 | 4 个文件（待实跑） |
| 累计 LOC | ~3500 行（source + tests）|
| 数据库对象 | 2 表 + 3 索引 |
| API 端点 | 5 个新 + 1 个 feature-flag 化 |
| 文档 | proposal / design / 6 specs / tasks / README / AGENTS / ROADMAP |
| 提交 | 3 个 commit（feat / test / docs 拆分）|

---

**最后更新**：2026-08-29 Phase 3 实施完成时
