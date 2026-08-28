"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RecallResponse } from "@/lib/hindsight";

// Shape of `data-recall` and `data-interview-state` parts as written by
// app/api/chat/route.ts. We type them locally because the AI SDK v5 strict
// UIMessage data typing is not worth registering globally for two parts.
type RecallPart = { type: "data-recall"; id?: string; data: RecallResponse };

type InterviewState = {
  awaitingAnswer: true;
  query: string;
  askedAt: number;
};

type InterviewStatePart = {
  type: "data-interview-state";
  id?: string;
  data: InterviewState;
};

function isRecallPart(part: unknown): part is RecallPart {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "data-recall"
  );
}

function isInterviewStatePart(part: unknown): part is InterviewStatePart {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "data-interview-state"
  );
}

interface InterviewPair {
  question: string;
  answer: string;
}

export default function Home() {
  const [input, setInput] = useState("");
  const [interviewPairs, setInterviewPairs] = useState<InterviewPair[]>([]);
  const [retainStatus, setRetainStatus] = useState<
    "idle" | "sending" | "ok" | "err"
  >("idle");
  const [retainMessage, setRetainMessage] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat({ transport });

  // Detect interview mode: the most recent assistant message carries a
  // `data-interview-state` part. While true, every user submission is
  // considered an *answer* (its question is the most recent assistant text).
  const interviewMode = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      // SAFETY: AI SDK v5's strict UIMessage data typing doesn't expose
      // `parts` in all minor versions; the runtime shape is stable.
      const parts = (m as unknown as { parts: ReadonlyArray<unknown> }).parts;
      if (parts && parts.some(isInterviewStatePart)) return true;
    }
    return false;
  }, [messages]);

  // When the user submits in interview mode, snapshot (most-recent assistant
  // text → current user text) as a Q/A pair. We mirror `interviewMode` into
  // a ref via effect so the callback closure can read the latest value
  // without re-binding on every render.
  const interviewModeRef = useRef(interviewMode);
  useEffect(() => {
    interviewModeRef.current = interviewMode;
  }, [interviewMode]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    if (interviewModeRef.current) {
      const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.role === "assistant");
      // SAFETY: AI SDK v5's strict UIMessage data typing doesn't expose
      // `parts` in all minor versions; the runtime shape is stable.
      const question =
        lastAssistant &&
        extractText(
          (lastAssistant as unknown as { parts: ReadonlyArray<unknown> })
            .parts,
        ).trim();
      if (question) {
        setInterviewPairs((prev) => [...prev, { question, answer: text }]);
      }
    }

    sendMessage({ text });
    setInput("");
  };

  // Reset retain banner when conversation shifts away from interview mode
  // (e.g. user clicked 完成 successfully — next /api/chat will likely
  // switch back to main flow if recall now hits).
  useEffect(() => {
    if (!interviewMode && retainStatus !== "idle") {
      // Don't reset on success: we want the success banner to persist until
      // the user starts typing again.
    }
  }, [interviewMode, retainStatus]);

  // Auto-scroll to the bottom when new messages arrive.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, interviewPairs.length]);

  const handleFinishInterview = useCallback(async () => {
    if (interviewPairs.length === 0 || retainStatus === "sending") return;
    setRetainStatus("sending");
    setRetainMessage("");
    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: interviewPairs }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        items_count?: number;
        error?: string;
      };
      if (!res.ok || !payload.success) {
        setRetainStatus("err");
        setRetainMessage(payload.error ?? `HTTP ${res.status}`);
        return;
      }
      setRetainStatus("ok");
      setRetainMessage(`已记录 ${payload.items_count ?? interviewPairs.length} 条知识`);
      setInterviewPairs([]);
    } catch (err) {
      setRetainStatus("err");
      setRetainMessage(err instanceof Error ? err.message : String(err));
    }
  }, [interviewPairs, retainStatus]);

  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Hindsight Chatbot
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {interviewMode
            ? "访谈模式：系统在记录你的回答，点「完成」存入长期记忆"
            : "双层校验：LLM 直答 + Hindsight 长期记忆增补"}
        </p>
      </header>

      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.length === 0 && !interviewMode && <EmptyState />}

          {messages.map(
            (m: {
              id: string;
              role: string;
              parts: ReadonlyArray<unknown>;
            }) => (
              <MessageBubble key={m.id} message={m} />
            ),
          )}

          {status === "submitted" &&
            (messages.at(-1) as { role: string } | undefined)?.role ===
              "user" && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-white px-4 py-3 text-sm text-zinc-500 shadow-sm dark:bg-zinc-800 dark:text-zinc-400">
                  <span className="inline-flex gap-1">
                    <Dot delay="0ms" />
                    <Dot delay="150ms" />
                    <Dot delay="300ms" />
                  </span>
                </div>
              </div>
            )}

          {interviewMode && interviewPairs.length > 0 && (
            <InterviewPairList pairs={interviewPairs} />
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              出错了：{error.message}
            </div>
          )}

          {retainStatus === "ok" && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              ✅ {retainMessage}。下次问类似问题应该能直接召回。
            </div>
          )}

          {retainStatus === "err" && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              落库失败：{retainMessage}
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900 sm:px-6">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-3xl items-end gap-2"
        >
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (retainStatus !== "idle") {
                setRetainStatus("idle");
                setRetainMessage("");
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder={
              interviewMode
                ? "输入你的回答…  （Enter 发送，Shift+Enter 换行）"
                : "问我任何问题…  （Enter 发送，Shift+Enter 换行）"
            }
            rows={1}
            className="flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
          />
          {interviewMode && (
            <button
              type="button"
              onClick={handleFinishInterview}
              disabled={
                interviewPairs.length === 0 || retainStatus === "sending"
              }
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-40"
            >
              {retainStatus === "sending" ? "落库中…" : `完成${interviewPairs.length > 0 ? ` (${interviewPairs.length})` : ""}`}
            </button>
          )}
          <button
            type="submit"
            disabled={!input.trim() || status !== "ready"}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            发送
          </button>
        </form>
      </footer>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-white/50 px-6 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-400">
      <p className="mb-2 font-medium text-zinc-700 dark:text-zinc-300">
        开始一段对话
      </p>
      <p>
        试着问我「张伟在哪里工作？」或「李娜在哪个公司？」——
        系统会先从长期记忆库里检索，再用 LLM 综合回答。
      </p>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-2 w-2 animate-bounce rounded-full bg-zinc-400"
      style={{ animationDelay: delay }}
    />
  );
}

function InterviewPairList({ pairs }: { pairs: ReadonlyArray<InterviewPair> }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 px-4 py-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left font-medium text-emerald-800 dark:text-emerald-200"
      >
        <span>🟢 本轮访谈暂存 ({pairs.length} 条)</span>
        <span className="text-[10px]">{open ? "收起 ▲" : "展开 ▼"}</span>
      </button>
      {open && (
        <ol className="mt-2 flex flex-col gap-2 text-xs text-emerald-900 dark:text-emerald-100">
          {pairs.map((p, i) => (
            <li
              key={i}
              className="rounded-md bg-white/60 px-3 py-2 dark:bg-zinc-900/50"
            >
              <div className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                Q{i + 1}
              </div>
              <div className="whitespace-pre-wrap">{p.question}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                A{i + 1}
              </div>
              <div className="whitespace-pre-wrap">{p.answer}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function MessageBubble({
  message,
}: {
  message: { id: string; role: string; parts: ReadonlyArray<unknown> };
}) {
  const text = extractText(message.parts);
  const recallPart = message.parts.find(isRecallPart);
  const interviewPart = message.parts.find(isInterviewStatePart);

  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
          isUser
            ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
            : "bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
        }`}
      >
        {text && <p className="whitespace-pre-wrap">{text}</p>}

        {recallPart && recallPart.data.results.length > 0 && (
          <RecallSection recall={recallPart.data} />
        )}

        {!isUser && interviewPart && (
          <div className="mt-3 border-t border-emerald-200 pt-3 text-xs text-emerald-700 dark:border-emerald-900 dark:text-emerald-300">
            🟢 访谈中：系统在记录你的回答
          </div>
        )}
      </div>
    </div>
  );
}

function extractText(parts: ReadonlyArray<unknown>): string {
  return parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        typeof p === "object" &&
        p !== null &&
        (p as { type?: unknown }).type === "text",
    )
    .map((p) => p.text)
    .join("");
}

function RecallSection({ recall }: { recall: RecallResponse }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-700">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        <span>📚 参考记忆 ({recall.results.length})</span>
        <span className="text-[10px]">{open ? "收起 ▲" : "展开 ▼"}</span>
      </button>

      {open && (
        <ol className="mt-2 flex flex-col gap-2">
          {recall.results.map((r, i) => (
            <li
              key={r.id}
              className="rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                <span className="font-mono">#{i + 1}</span>
                <span className="rounded bg-zinc-200 px-1.5 py-0.5 dark:bg-zinc-700">
                  {r.type}
                </span>
                {r.context && <span>[{r.context}]</span>}
                {r.scores && (
                  <span className="ml-auto">
                    rerank: {r.scores.reranker?.toFixed(3) ?? "—"}
                  </span>
                )}
              </div>
              <p className="mt-1 text-zinc-800 dark:text-zinc-200">{r.text}</p>
              {r.entities && r.entities.length > 0 && (
                <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  实体：{r.entities.join("、")}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}