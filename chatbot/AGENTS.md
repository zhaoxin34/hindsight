# Hindsight Chatbot — AGENTS.md

> AI agent / 协作者快速上手本项目的入口文档。
> 项目整体规划见 `../ROADMAP.md`，Hindsight 后端见 `../docker-compose.yml`。

## 项目概述

独立的 Chatbot 产品，**复用 [vectorize-io/hindsight](https://github.com/vectorize-io/hindsight) 作为记忆后端**。

**Phase 1 已实现：双层校验（LLM 直答 + Hindsight 增补）**

- 用户问 → 同步 recall → 把 facts 注入 system prompt → LLM 自然融合 → 答案下方挂一个"📚 参考记忆"折叠区（默认收起）

Phase 2+ 会引入**专家访谈 Agent**（recall 空 + LLM 不确定时触发反问，把隐性知识萃取进 Hindsight），见 `../ROADMAP.md`。

---

## 技术栈

| 层 | 选型 | 备注 |
|---|---|---|
| **框架** | Next.js 16.3.3（App Router + Turbopack） | 单体部署，前后端共用一个项目 |
| **语言** | TypeScript 5（strict） | `next.config.ts` 用 `.ts` 后缀 |
| **UI 库** | React 19.2.8 + Tailwind CSS 4 | 不引入 shadcn/ui，原生 Tailwind 够用 |
| **AI SDK** | Vercel AI SDK v5：`ai` + `@ai-sdk/react` + `@ai-sdk/openai` | `streamText` + `useChat` + `createUIMessageStream` |
| **记忆后端** | Hindsight v0.9.2（pgvector + 本地 BGE / MiniLM） | 独立 Docker 容器，通过 REST 调 |
| **LLM** | 阿里云百炼 `qwen-plus`，OpenAI 兼容模式 | `base_url=https://dashscope.aliyuncs.com/compatible-mode/v1` |
| **校验** | zod 4 | API schema 校验 |
| **测试** | Vitest 4 + @vitest/coverage-v8 | 4 个测试文件 / 46 个用例；纯函数 + Composer 注入式单测 |
| **Node** | ≥20 | Next.js 16 要求 |

**未引入**：React Query、SWR、Redux、shadcn/ui、Tailwind UI、Mastra（**Phase 3 才考虑**）。保持轻。

---

## 架构与数据流

```mermaid
flowchart TB
    User([User])
    Page["app/page.tsx<br/>useChat"]
    Route["app/api/chat/route.ts<br/>thin adapter<br/>装配 deps"]
    Composer["lib/chat/composer.ts<br/>composeChat<br/>★ DI seam"]
    Extract["extractUserQuery<br/>纯函数"]
    Recall["lib/hindsight.ts<br/>buildRecallRequestBody<br/>+ recallMemories"]
    Hindsight[(Hindsight<br/>localhost:8888)]
    Prompt["lib/system-prompt.ts<br/>buildSystemPrompt"]
    Stream["streamText<br/>+ createUIMessageStream"]
    LLM[阿里云百炼<br/>qwen-plus]

    User -->|输入| Page
    Page -->|"POST /api/chat<br/>{messages}"| Route
    Route -->|composeChat(messages, deps)| Composer
    Composer -->|1. 抽 query| Extract
    Composer -->|2. recall query| Recall
    Recall -->|POST /v1/.../recall| Hindsight
    Hindsight -->|RecallResponse| Recall
    Composer -->|3. recall| Prompt
    Prompt -->|中文 system message| Composer
    Composer -->|4. streamText| Stream
    Stream -->|TextDelta| LLM
    LLM -->|stream| Stream
    Composer -->|5. write data-recall + merge| Page
    Page -->|渲染：text + 折叠区| User

    style Composer fill:#0f172a,color:#f8fafc
```

**关键设计**：
- recall 是**同步**调用（composer 内 await），用户期望"问一次答一次"，异步会让 LLM 答跟记忆内容割裂
- **Composer 是 DI seam**：所有外部副作用（recall / LLM / data part）通过 `ChatDeps` 注入。Phase 2 加面试 Agent 只需在 `route.ts` 里替换 deps（YAGNI：暂不在 composer 里加 mode 分支）
- `route.ts` 是 thin adapter：parse req → 装配 deps → 调用 `composeChat`，**没有任何业务逻辑**

---

## 目录结构

```
chatbot/
├── app/
│   ├── api/
│   │   └── chat/
│   │       └── route.ts          # Thin adapter：parse + 装配 deps + delegate to composer
│   ├── layout.tsx                  # 根布局（Geist 字体）
│   ├── page.tsx                    # Chat UI（useChat + 折叠区）
│   └── globals.css                 # Tailwind 入口
├── lib/
│   ├── chat/                       # 编排层（DI seam，Phase 2 复用）
│   │   ├── composer.ts             # ChatComposer：主 agent 编排
│   │   └── extract-user-query.ts   # 纯函数：取最后一条 user message 文本（封装 parts 类型 hack）
│   ├── hindsight.ts                # Hindsight REST 客户端 + buildRecallRequestBody 纯函数
│   └── system-prompt.ts            # 双层校验 prompt 构建器
├── tests/                          # Vitest 单测
│   ├── lib/
│   │   ├── chat/
│   │   │   ├── composer.test.ts
│   │   │   └── extract-user-query.test.ts
│   │   ├── system-prompt.test.ts
│   │   └── hindsight-recall-body.test.ts
├── public/                         # 静态资源（Next.js boilerplate）
├── .env.example                    # 环境变量模板（提交）
├── .env.local                      # 本地配置（不提交）
├── next.config.ts                  # Next.js 配置
├── tsconfig.json                   # TypeScript 配置
├── vitest.config.mts               # 测试配置
├── package.json                    # 依赖
└── README.md                       # Next.js 自带 README（占位）
```

---

## 关键文件职责

| 文件 | 行数大概 | 职责 |
|---|---|---|
| **`app/page.tsx`** | ~180 | Chat UI。`useChat({transport})` 监听 stream。`MessageBubble` 组件提取 `text` + `data-recall` parts。`RecallSection` 组件渲染折叠区（默认收起，列出 facts / entities / scores） |
| **`app/api/chat/route.ts`** | ~62 | **Thin adapter**。解析 `messages`、装配 `ChatComposer` 的 deps（`recallMemories` / `buildSystemPrompt` / `streamText(...).toUIMessageStream` / `writeDataPart`）、转发给 `composeChat`。**没有业务逻辑**，5 步流程全部在 composer 里 |
| **`lib/chat/composer.ts`** | ~110 | `composeChat(messages, deps)` 编排：extract → recall → build prompt → stream LLM → write `data-recall` part + merge。返回 `Response`。所有依赖通过 `ChatDeps` 注入，**Phase 2 面试 Agent 只需换一个 deps**（YAGNI：暂不加 mode 分支） |
| **`lib/chat/extract-user-query.ts`** | ~32 | `extractUserQuery(messages)` 纯函数。封装 `UIMessage.parts` 类型 hack（AI SDK v5 公开类型不暴露 parts，运行时稳定） |
| **`lib/hindsight.ts`** | ~220 | Hindsight REST 客户端。导出：`recallMemories(query, options?)`、`retainMemories(items)`、`isHindsightHealthy()`，以及纯函数 `buildRecallRequestBody(query, options)`。`request<T>()` 私有 helper 统一错误处理（`HindsightError`）。**默认值合并逻辑全部在 `buildRecallRequestBody` 里，方便单测** |
| **`lib/system-prompt.ts`** | ~50 | 双层校验 prompt 构建器。`buildSystemPrompt(recall)` 返回完整中文 system message：persona + 长期记忆 section + 引用规则（不编造、优先最新事实） |

---

## 环境变量

```bash
HINDSIGHT_API_URL=http://localhost:8888      # Hindsight REST endpoint（后端用）
HINDSIGHT_BANK_ID=zhangwei                   # Phase 1 demo bank
BAILIAN_API_KEY=sk-xxx                      # 阿里云百炼 API key（必填，通过 shell env 注入）
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
```

**安全约定**：
- `BAILIAN_API_KEY` **永远不写进任何文件**（即使 `.env.local` 在 .gitignore 里）。通过 shell env 注入：`BAILIAN_API_KEY=$BAILIAN_API_KEY npm run dev`，项目根的 `Makefile` 的 `dev` target 已处理
- `.env.local` 已被 .gitignore（Next.js 默认）

---

## 常用命令

```bash
# 在项目根（推荐）
make restart   # ← 重启 dev server
make status    # 检查 chatbot + Hindsight 健康
make logs      # tail dev server 日志
make clean     # 停 + 清 .next 缓存

# 在 chatbot/ 下直接跑
cd chatbot
BAILIAN_API_KEY=$BAILIAN_API_KEY npm run dev    # 启动
BAILIAN_API_KEY=$BAILIAN_API_KEY npm run build  # 生产构建

# 测试 / 类型检查
npm test              # 跑全部 vitest 用例（46 个）
npm run test:watch          # watch 模式
npm run test:coverage       # 覆盖率（v8）
npm run type-check # tsc --noEmit
npm run lint        # eslint
```

---

## 已知坑（重要！）

### 1. `include.entities` 必须是对象，不是 boolean

```typescript
// ❌ 错（触发 422）
include: { entities: true }
// ✅ 对
include: { entities: { max_tokens: 500 } }
```

错误信息：`Input should be a valid dictionary or object to extract fields from`

### 2. `convertToModelMessages` 是 async

AI SDK v5 里它是 Promise，必须 `await`：

```typescript
messages: await convertToModelMessages(messages),
```

### 3. `UIMessage.parts` 类型 hack 已封装在 `extract-user-query.ts`

AI SDK v5 的 `UIMessage` 公开类型不暴露 `parts`，但运行时稳定。`lib/chat/extract-user-query.ts` 集中处理这个 cast（带 SAFETY 注释）。**新代码不要再在 route handler 或 UI 组件里直接 cast `parts`**——需要时把逻辑加到 `extractUserQuery()`，保持类型 hack 集中在一处。

### 4. Hindsight `HINDSIGHT_API_WORKER_ID` 必须固定

dev 模式可以省略（每次重启都新 ID），但生产部署前必须设置稳定值，否则重启后未完成的任务变孤儿。

### 5. `HINDSIGHT_API_URL` 在 Next.js 服务端用

浏览器**不知道** Hindsight 在哪。所有 recall/retain 都从 Next.js route handler 发起 server-to-server 调用。

### 6. `min_scores.reranker=0.3` 默认过滤低相关 facts

`lib/hindsight.ts` 默认在请求里加 `min_scores: { reranker: 0.3 }`，把 cross-encoder 认为不相关的事实过滤掉。

**设计意图**：Hindsight 在 budget 模式下会把召回结果 padding 到预算上限（即使没有真正相关的事实）。如果不加这个 floor，无关 query（比如"什么是黑洞？"）会返回 3 条关于张伟的事实、LLM 被 noise 干扰、UI折叠区也会展示无关内容。

**取舍**：阈值 0.3 是经验值。**代价**：中等相关但分数略低（<0.3）的事实会被过滤掉，需要根据实际效果调。**禁用**：传 `{ minScores: {} }` 给 `recallMemories()` 即可关闭。

**后端联动**：`docker-compose.yml` 里 Hindsight 用了 `HINDSIGHT_API_RERANKER_PROVIDER=alibaba` + `qwen3-rerank`。默认 `local` 是 `cross-encoder/ms-marco-MiniLM-L-6-v2`（英文 MS MARCO 训练），对中文返回随机高分（黑洞 query 召回张伟 facts rerank=0.99 是 bug），换 `qwen3-rerank` 才正常。

---

## 调试技巧

```bash
# 1. 直接 curl /api/chat 看 stream 协议
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"张伟在哪里工作？"}]}]}' \
  | head -c 4000

# 2. Hindsight 健康检查
curl http://localhost:8888/health | python3 -m json.tool

# 3. 列出 bank 的事实数
curl http://localhost:8888/v1/default/banks/zhangwei/stats | python3 -m json.tool

# 4. 直接调 Hindsight recall（绕过 chatbot）
curl -X POST http://localhost:8888/v1/default/banks/zhangwei/memories/recall \
  -H "Content-Type: application/json" \
  -d '{"query":"张伟在哪里工作？","types":["observation","world"],"prefer_observations":true}'
```

---

## 设计约束 / 不要做的事

- ❌ **不要在 `.env.local` 写 `BAILIAN_API_KEY`**——通过 shell env 注入
- ❌ **不要重新发明 memory**——所有记忆走 Hindsight
- ❌ **不要把 recall 改成异步**——用户体验依赖同步 recall
- ❌ **不要在 Phase 1 引入 Mastra / LangGraph**——Phase 3+ 才考虑
- ❌ **不要直接修改 `app/page.tsx` 用 shadcn/ui / Tailwind UI**——保持原生 Tailwind
- ❌ **不要硬编码 LLM 模型名**——统一从 `process.env.LLM_MODEL` 读

---

## Phase 1 Done 标准

- [x] 用户发问 → recall → LLM 用注入的 recall 答 → 主答案下方展示"参考记忆"折叠区
- [x] recall 空时双层校验依然工作（仅 LLM 答，无折叠区）
- [x] recall 命中时折叠区显示具体 facts + entities + scores
- [x] observation 与 raw fact 不重复（`prefer_observations=true` 生效）
- [x] 中文 recall 验证通过
- [x] 同一问题连续问 5 次，recall 召回稳定

---

## 相关文件

- `../ROADMAP.md` — 项目整体 roadmap（Phase 0-7）
- `../docker-compose.yml` — Hindsight 后端部署
- `../Makefile` — 服务管理命令（restart / status / logs / clean）
- [vectorize-io/hindsight](https://github.com/vectorize-io/hindsight) — Hindsight 后端仓库