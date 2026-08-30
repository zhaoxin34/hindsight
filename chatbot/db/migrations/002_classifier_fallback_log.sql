-- 002_classifier_fallback_log.sql
-- Phase 3 多轮访谈 Agent — Complexity Classifier fallback 日志表
--
-- 记录每次 HybridClassifier 走 LLM fallback 的事件，用于 Phase 6 调优：
--   - 高频 fallback → 规则覆盖不足，需补充 rule
--   - 低 confidence 但 LLM 也低 confidence → 难样本，考虑专用模型
--
-- 复用：
--   psql -h localhost -p 5432 -U postgres -d postgres -f chatbot/db/migrations/002_classifier_fallback_log.sql

CREATE TABLE IF NOT EXISTS chatbot_interview.classifier_fallback_log (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source TEXT NOT NULL,
    query TEXT NOT NULL,
    rule_confidence REAL NOT NULL,
    llm_result JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_classifier_fallback_log_created_at
ON chatbot_interview.classifier_fallback_log (created_at);
