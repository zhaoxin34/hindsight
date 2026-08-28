# Hindsight Chatbot

独立的 Chatbot 产品，核心能力是**长期记忆 + 主动学习**。

---

## 背景

市面上大多数 AI agent 记忆系统（RAG、知识图谱）只能做"查找历史对话"。
[Hindsight](https://github.com/vectorize-io/hindsight) 由 [vectorize-io](https://vectorize.io) 出品，在
[LongMemEval](https://arxiv.org/abs/2512.12818) 基准上长期 SOTA，提供 `retain / recall / reflect / observe`
的完整原语，并能自动 consolidate 出 observation / mental model。

但 Hindsight 是**后端**——要变成用户可用的产品，需要在上面构建**"提问 / 访谈 / 萃取"**的编排层。
本项目就是这个编排层。

---

## 目标

构建一个 Chatbot，行为如下：

1. 用户提问 → Agent 用 **LLM 自身知识 + Hindsight 召回**做双层校验后回答
2. 当两者都答不上时，自动开启**专家访谈模式**，向用户追问
3. 访谈产出的隐性知识被萃取为结构化事实 → **用户审核** → 存入 Hindsight
4. 知识库随时间增长，访谈频率自然下降，最终形成可持续的"个人 / 团队记忆"

> 详细架构、模块拆分、开发阶段见 [ROADMAP.md](./ROADMAP.md)。

---

## 当前进度

- [x] **Phase 0**：Hindsight 后端已部署（pgvector + 阿里云百炼 qwen-plus + 本地 BGE/MiniLM）
- [ ] Phase 1：双层校验主 Agent
- [ ] Phase 2 – 7：访谈策略 / 知识萃取 / 用户审核 / 质量评估 / 生产化（见 ROADMAP）

---

## 技术栈

| 层 | 选型 |
|---|---|
| 记忆后端 | [vectorize-io/hindsight](https://github.com/vectorize-io/hindsight) v0.9.2 |
| 向量数据库 | pgvector |
| LLM | 阿里云百炼 qwen-plus（OpenAI 兼容模式） |
| Embedding | 本地 BAAI/bge-small-en-v1.5 |
| Reranker | 本地 cross-encoder/ms-marco-MiniLM-L-6-v2 |

---

## 快速开始

### 前置

- Docker
- PostgreSQL 14+ with pgvector（Supabase / Neon / AlloyDB / 自部署均可）
- 阿里云百炼 API Key（设置环境变量 `BAILIAN_API_KEY`）

### 启动 Hindsight 后端

```bash
export BAILIAN_API_KEY=sk-xxx
docker compose up -d
```

- API：`http://localhost:8888`
- Web UI（Control Plane）：`http://localhost:9999`

> ⚠️ Chatbot 前端（Phase 1+）尚未实现，目前仅部署记忆后端。

---

## 贡献

详见 [ROADMAP.md](./ROADMAP.md) 的开发阶段与待讨论项。重大架构决策前请先开 Issue 讨论。

---

## 许可证

MIT