"use client";

/**
 * MultiTurnPanel — Phase 3 multi-turn interview UI.
 *
 * Renders the new interview session flow built on the `useInterviewSession`
 * hook. The panel shows one of several states:
 *
 *   - idle        : the user hasn't started an interview yet
 *   - active      : an interview is in progress, waiting for the user's answer
 *   - conflict    : a recall fact contradicted the latest answer; show options
 *   - finished    : the interview completed, show turn summary + retain items
 *   - abandoned   : the user gave up; the session is over
 *   - error       : something went wrong; show error
 *
 * The component is a controlled, self-contained island. It is mounted by
 * `app/page.tsx` but otherwise has no coupling to the Phase 2 interview
 * flow that uses `data-interview-state` data parts.
 */

import { useState } from "react";

import { useInterviewSession } from "@/lib/chat/interview/use-session";
import type { ConflictPair } from "@/lib/chat/interview/state";

export function MultiTurnPanel() {
  const { state, start, answer, finish, abandon, resolveConflict, reset } =
    useInterviewSession();

  if (state.kind === "idle") {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-zinc-600 dark:text-zinc-300">
          复杂判断 / 抽象问题可走多轮访谈萃取（每次 3–5 轮追问）。
        </p>
        <NewInterviewForm onSubmit={start} />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm dark:border-red-900 dark:bg-red-950">
        <p className="font-medium text-red-800 dark:text-red-200">
          出错了：{state.message}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-2 text-xs text-red-700 underline dark:text-red-300"
        >
          重置
        </button>
      </div>
    );
  }

  if (state.kind === "abandoned") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-zinc-600 dark:text-zinc-300">本次访谈已放弃。</p>
        <button
          type="button"
          onClick={reset}
          className="mt-2 text-xs text-zinc-600 underline dark:text-zinc-300"
        >
          开启新访谈
        </button>
      </div>
    );
  }

  if (state.kind === "conflict") {
    return (
      <ConflictPanel
        conflict={state.conflict}
        onResolve={async (verdict, oldFactId) => {
          await resolveConflict(verdict, oldFactId);
        }}
        onAbandon={abandon}
        question={state.session.query}
      />
    );
  }

  if (state.kind === "finished") {
    return <FinishedPanel items={state.items} onNewInterview={reset} />;
  }

  // active: waiting for the user's answer
  return (
    <ActivePanel
      session={state.session}
      question={state.question}
      onAnswer={answer}
      onFinish={finish}
      onAbandon={abandon}
    />
  );
}

function NewInterviewForm({
  onSubmit,
}: {
  onSubmit: (query: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!query.trim() || submitting) return;
        setSubmitting(true);
        try {
          await onSubmit(query.trim());
        } finally {
          setSubmitting(false);
        }
      }}
      className="mt-2 flex gap-2"
    >
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="输入抽象 / 判断类问题…"
        className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        disabled={submitting}
      />
      <button
        type="submit"
        disabled={!query.trim() || submitting}
        className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {submitting ? "启动中…" : "开始多轮访谈"}
      </button>
    </form>
  );
}

function ActivePanel({
  session,
  question,
  onAnswer,
  onFinish,
  onAbandon,
}: {
  session: {
    query: string;
    round: number;
    maxRounds: number;
    turns: Array<{ q: string; a: string; ts: string }>;
  };
  question: string | null;
  onAnswer: (text: string) => Promise<void>;
  onFinish: () => Promise<void>;
  onAbandon: () => Promise<void>;
}) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
          🟡 多轮访谈进行中 ({session.round} / {session.maxRounds})
        </span>
        <span className="text-xs text-amber-700 dark:text-amber-300">
          {session.query}
        </span>
      </div>

      {question && (
        <div className="rounded-md bg-white px-3 py-2 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
          <div className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300">
            系统追问
          </div>
          <div className="whitespace-pre-wrap">{question}</div>
        </div>
      )}

      {session.turns.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-amber-700 dark:text-amber-300">
            已记录 {session.turns.length} 轮
          </summary>
          <ol className="mt-1 flex flex-col gap-1 text-zinc-700 dark:text-zinc-300">
            {session.turns.map((t, i) => (
              <li
                key={i}
                className="rounded bg-white/60 px-2 py-1 dark:bg-zinc-900/50"
              >
                <span className="text-[10px] text-amber-700 dark:text-amber-300">
                  Q{i + 1}
                </span>{" "}
                {t.q} →{" "}
                <span className="text-[10px] text-amber-700 dark:text-amber-300">
                  A
                </span>{" "}
                {t.a}
              </li>
            ))}
          </ol>
        </details>
      )}

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!answer.trim() || busy) return;
          setBusy(true);
          try {
            await onAnswer(answer.trim());
            setAnswer("");
          } finally {
            setBusy(false);
          }
        }}
        className="mt-3 flex flex-col gap-2"
      >
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="回答…（Enter 发送，Shift+Enter 换行）"
          rows={2}
          className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm dark:border-amber-900 dark:bg-zinc-900"
          disabled={busy}
        />
        <div className="flex justify-end gap-2">
          {!showAbandonConfirm ? (
            <button
              type="button"
              onClick={() => setShowAbandonConfirm(true)}
              disabled={busy}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              放弃
            </button>
          ) : (
            <button
              type="button"
              onClick={onAbandon}
              disabled={busy}
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 transition hover:bg-red-100 disabled:opacity-40 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              确认放弃？回答不保留
            </button>
          )}
          <button
            type="button"
            onClick={onFinish}
            disabled={busy}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 disabled:opacity-40"
          >
            够了（落库）
          </button>
          <button
            type="submit"
            disabled={!answer.trim() || busy}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
          >
            发送
          </button>
        </div>
      </form>
    </div>
  );
}

function ConflictPanel({
  conflict,
  question,
  onResolve,
  onAbandon,
}: {
  conflict: ConflictPair[];
  question: string;
  onResolve: (verdict: "typo" | "serious", oldFactId: string) => Promise<void>;
  onAbandon: () => Promise<void>;
}) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/40 px-4 py-3 text-sm dark:border-rose-900 dark:bg-rose-950/30">
      <div className="mb-2 font-medium text-rose-800 dark:text-rose-200">
        ⚠️ 检测到与历史记忆的冲突
      </div>
      <p className="mb-3 text-xs text-rose-700 dark:text-rose-300">
        关于：{question}
      </p>
      <ul className="flex flex-col gap-2">
        {conflict.map((c) => (
          <li
            key={c.old_fact.id}
            className="rounded-md bg-white px-3 py-2 dark:bg-zinc-900"
          >
            <p className="text-xs text-zinc-600 dark:text-zinc-300">
              旧事实：{c.old_fact.text}
            </p>
            <p className="mt-1 text-xs text-zinc-500 italic dark:text-zinc-400">
              {c.reason}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => onResolve("typo", c.old_fact.id)}
                className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                口误
              </button>
              <button
                type="button"
                onClick={() => onResolve("serious", c.old_fact.id)}
                className="rounded bg-zinc-900 px-2 py-1 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900"
              >
                认真（替换旧事实）
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onAbandon}
        className="mt-3 text-xs text-zinc-500 underline dark:text-zinc-400"
      >
        放弃本次访谈
      </button>
    </div>
  );
}

function FinishedPanel({
  items,
  onNewInterview,
}: {
  items: ReadonlyArray<{ content: string; context?: string | null }>;
  onNewInterview: () => void;
}) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="mb-2 font-medium text-emerald-800 dark:text-emerald-200">
        ✅ 访谈完成（{items.length} 条知识待落库）
      </div>
      <ol className="flex flex-col gap-1 text-xs text-emerald-900 dark:text-emerald-100">
        {items.map((it, i) => (
          <li
            key={i}
            className="rounded bg-white/60 px-2 py-1 dark:bg-zinc-900/50"
          >
            {it.content}
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={onNewInterview}
        className="mt-3 text-xs text-emerald-700 underline dark:text-emerald-300"
      >
        开启新访谈
      </button>
    </div>
  );
}
