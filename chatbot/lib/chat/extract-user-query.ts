/**
 * Extract the latest user message text from an AI SDK v5 conversation.
 *
 * AI SDK v5 messages use a `parts` array. Older `content` strings still work
 * via the same shim, so we handle both. This is a pure function — no IO,
 * no side effects, no Hindsight dependency.
 *
 * SAFETY: `UIMessage`'s public type does not expose `parts` directly in all
 * v5 minor versions; the runtime shape is stable. The cast is required to
 * peek into the parts array without re-implementing the message shape.
 */
export interface ChatMessage {
  role: string;
  parts?: ReadonlyArray<{ type: string; text?: string }>;
  content?: string;
}

export function extractUserQuery(messages: ReadonlyArray<ChatMessage>): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return "";
  return extractText(lastUser).trim();
}

function extractText(message: ChatMessage): string {
  if (Array.isArray(message.parts)) {
    return message.parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text!)
      .join("");
  }
  if (typeof message.content === "string") return message.content;
  return "";
}
