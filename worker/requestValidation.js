export const AI_MODEL = "claude-sonnet-4-6";
export const MAX_TOKENS = 1_000;
export const MAX_MESSAGES = 4;
export const MAX_MESSAGE_CHARS = 12_000;

/**
 * Keep the public Worker a deliberately narrow endpoint. It accepts only the
 * single prompt shape this app needs, and never lets a browser choose a model
 * or an unbounded token budget.
 */
export function validateAiRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Ogiltigt AI-anrop." };
  }
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > MAX_MESSAGES) {
    return { error: "Ogiltigt antal meddelanden." };
  }

  const messages = [];
  for (const message of body.messages) {
    if (!message || message.role !== "user" || typeof message.content !== "string") {
      return { error: "Ogiltigt meddelandeformat." };
    }
    if (!message.content.trim() || message.content.length > MAX_MESSAGE_CHARS) {
      return { error: "Meddelandet är tomt eller för långt." };
    }
    messages.push({ role: "user", content: message.content });
  }

  const requestedTokens = Number(body.max_tokens);
  const max_tokens = Number.isInteger(requestedTokens) && requestedTokens > 0
    ? Math.min(requestedTokens, MAX_TOKENS)
    : MAX_TOKENS;

  return { value: { model: AI_MODEL, max_tokens, messages } };
}
