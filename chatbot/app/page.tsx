"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { RecallResponse } from "@/lib/hindsight";

// Shape of a `data-recall` part as written by app/api/chat/route.ts.
// We type it locally because the AI SDK v5 strict UIMessage data typing
// is not worth registering globally for a single data part.
type RecallPart = { type: "data-recall"; id?: string; data: RecallResponse };

function isRecallPart(part: unknown): part is RecallPart {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "data-recall"
  );
}

export default function Home() {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat({ transport });

  // Auto-scroll to the bottom when new messages arrive.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Hindsight Chatbot
        </h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          双层校验：LLM 直答 + Hindsight 长期记忆增补
        </p>
      </header>

      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.length === 0 && <EmptyState />}

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

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              出错了：{error.message}
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="问我任何问题…  （Enter 发送，Shift+Enter 换行）"
            rows={1}
            className="flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
          />
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

function MessageBubble({
  message,
}: {
  message: { id: string; role: string; parts: ReadonlyArray<unknown> };
}) {
  const text = extractText(message.parts);
  const recallPart = message.parts.find(isRecallPart);

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
