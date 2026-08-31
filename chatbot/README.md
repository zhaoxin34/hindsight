# Hindsight Chatbot

AI agent / 协作者快速上手本项目的入口文档。
项目整体规划见 `../ROADMAP.md`，Hindsight 后端见 `../docker-compose.yml`，本模块说明见 `AGENTS.md`。

## 快速开始

```bash
# 1. 启动 Hindsight 后端（另一个 docker-compose）
cd .. && docker compose up -d hindsight

# 2. 启动 chatbot 开发服务
npm run dev   # http://localhost:3000

# 3. 跑测试
npm test      # vitest run
```

## Phase 3 多轮访谈（默认禁用）

Phase 3 实现了**多轮访谈 Agent**（3-5 轮追问），但默认是**关闭**的。
要启用：

```bash
# .env.local 或 shell env
ENABLE_MULTI_TURN_INTERVIEW=true npm run dev
```

开启后：

- `lib/chat/mode-router.ts` 走新分支：recall 空时用 ComplexityClassifier 决定是否进多轮访谈
- 新的 UI 组件 `MultiTurnPanel` 出现在 Chat 页面，提供「够了」/「放弃」按钮
- 5 个新 API 端点（见 `app/api/interview/session/*`）可调
- session 存到本地 PG（`CHATBOT_INTERVIEW` schema）

## 环境变量

```bash
HINDSIGHT_API_URL=http://localhost:8888      # Hindsight REST endpoint
HINDSIGHT_BANK_ID=zhangwei                   # demo bank
BAILIAN_API_KEY=sk-xxx                      # 阿里云百炼 API key（必填）
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
ENABLE_MULTI_TURN_INTERVIEW=false             # Phase 3 开关（默认 false）
CHATBOT_DATABASE_URL=postgresql://...        # Phase 3 session 存储（默认 host hindsight:5432）
```

## Phase 3 端到端流程

1. 用户提问 → `ComplexityClassifier` 判定复杂度
2. 抽象问题 → `MultiTurnPanel` 启动 session，3-5 轮追问
3. 专家每轮回答 → `nextTurn()` state machine 生成下一轮问题
4. 矛盾时（recall 与新回答冲突）→ 显式提示「口误/认真」 → PATCH 老 fact + POST 新 fact
5. 专家点「够了」或「放弃」 → 结束 session
6. 完成的 session 走 `retainMemories` 落库到 Hindsight

详见 `AGENTS.md` 和 `../openspec/changes/phase3-multi-turn-interview/`。

## 相关

- `AGENTS.md` — 详细项目结构 + 设计决策 + 关键文件职责
- `../ROADMAP.md` — 整体 roadmap（Phase 0-7）
- `../openspec/changes/phase3-multi-turn-interview/` — Phase 3 完整 OpenSpec 文档
- `../docker-compose.yml` — Hindsight 后端部署

---

## (以下为 Next.js 默认 README)

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!
