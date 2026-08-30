-- 001_chatbot_interview_schema.sql
-- Phase 3 多轮访谈 Agent 的 session 持久化 schema
--
-- 设计决策（参考 ROADMAP §5 Phase 3 + design D1）：
--   - 使用 host `postgres` 容器（pgvector/pgvector:pg16，监听 localhost:5432）
--   - 与 Hindsight 解耦：Hindsight 连自己的 PG（hindsight 数据库），chatbot 用默认 postgres 数据库
--   - 独立 schema `chatbot_interview` 隔离 chatbot session 数据
--
-- 复用：
--   psql -h localhost -p 5432 -U postgres -d postgres -f chatbot/db/migrations/001_chatbot_interview_schema.sql
--
-- 回滚：
--   DROP TABLE IF EXISTS chatbot_interview.interview_sessions;
--   DROP SCHEMA IF EXISTS chatbot_interview;

CREATE SCHEMA IF NOT EXISTS chatbot_interview;

CREATE TABLE IF NOT EXISTS chatbot_interview.interview_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id TEXT NOT NULL,
    query TEXT NOT NULL,
    classification JSONB NOT NULL,
    turns JSONB NOT NULL DEFAULT '[]'::JSONB,
    round INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    constraint CHK_INTERVIEW_STATE CHECK (
        state IN ('active', 'finished', 'abandoned')
    )
);

CREATE INDEX IF NOT EXISTS idx_interview_sessions_bank_state
ON chatbot_interview.interview_sessions (bank_id, state);

CREATE INDEX IF NOT EXISTS idx_interview_sessions_updated_at
ON chatbot_interview.interview_sessions (updated_at);
