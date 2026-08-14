import { describe, expect, it } from "vitest";
import { AI_MODEL, MAX_TOKENS, validateAiRequest } from "./requestValidation.js";

describe("validateAiRequest", () => {
  const valid = { max_tokens: 300, messages: [{ role: "user", content: "Skapa en kort brief." }] };

  it("uses a fixed model and accepts the app's prompt shape", () => {
    expect(validateAiRequest(valid)).toEqual({
      value: { model: AI_MODEL, max_tokens: 300, messages: valid.messages },
    });
  });

  it("caps the requested token budget", () => {
    expect(validateAiRequest({ ...valid, max_tokens: 99_999 }).value.max_tokens).toBe(MAX_TOKENS);
  });

  it.each([
    [null],
    [{}],
    [{ messages: [] }],
    [{ messages: [{ role: "assistant", content: "no" }] }],
    [{ messages: [{ role: "user", content: "" }] }],
    [{ messages: [{ role: "user", content: "x".repeat(12_001) }] }],
  ])("rejects invalid input", (body) => {
    expect(validateAiRequest(body).error).toBeTruthy();
  });
});
