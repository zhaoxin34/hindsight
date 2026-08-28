import { describe, expect, it } from "vitest";
import { extractUserQuery } from "@/lib/chat/extract-user-query";

describe("extractUserQuery", () => {
  it("returns empty string when there is no user message", () => {
    expect(extractUserQuery([{ role: "assistant", content: "hello" }])).toBe(
      "",
    );
  });

  it("returns empty string for empty input", () => {
    expect(extractUserQuery([])).toBe("");
  });

  it("picks the last user message when multiple are present", () => {
    const messages = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second question" },
    ];
    expect(extractUserQuery(messages)).toBe("second question");
  });

  it("ignores trailing assistant messages", () => {
    const messages = [
      { role: "user", content: "the question" },
      { role: "assistant", content: "the answer" },
    ];
    expect(extractUserQuery(messages)).toBe("the question");
  });

  it("joins multiple text parts from AI SDK v5 message shape", () => {
    const messages = [
      {
        role: "user",
        parts: [
          { type: "text", text: "张伟" },
          { type: "text", text: "在哪里" },
          { type: "text", text: "工作？" },
        ],
      },
    ];
    expect(extractUserQuery(messages)).toBe("张伟在哪里工作？");
  });

  it("skips non-text parts and joins the text parts", () => {
    const messages = [
      {
        role: "user",
        parts: [
          { type: "image", text: "ignored" } as { type: string; text?: string },
          { type: "text", text: "只看 text parts" },
        ],
      },
    ];
    expect(extractUserQuery(messages)).toBe("只看 text parts");
  });

  it("trims whitespace from the resulting query", () => {
    const messages = [{ role: "user", content: "   padded   " }];
    expect(extractUserQuery(messages)).toBe("padded");
  });

  it("falls back to empty when last user message has only non-text parts", () => {
    const messages = [
      {
        role: "user",
        parts: [{ type: "image", text: "not text" }],
      },
    ];
    expect(extractUserQuery(messages)).toBe("");
  });

  it("returns empty string when text field is missing on a text part", () => {
    const messages = [
      {
        role: "user",
        parts: [{ type: "text" } as { type: string; text?: string }],
      },
    ];
    expect(extractUserQuery(messages)).toBe("");
  });
});
