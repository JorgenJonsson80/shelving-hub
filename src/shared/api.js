const PROXY_URL = import.meta.env.VITE_API_URL;   // set in GitHub secrets → proxy worker
const API_KEY   = import.meta.env.VITE_ANTHROPIC_API_KEY; // only used for local dev

/**
 * Call Claude. Uses the proxy worker when VITE_API_URL is set (GitHub Pages),
 * falls back to direct Anthropic API for local development.
 */
export async function callAI(messages, maxTokens = 1000) {
  const url = PROXY_URL || "https://api.anthropic.com/v1/messages";

  const headers = { "Content-Type": "application/json" };
  if (!PROXY_URL) {
    // Local dev: call Anthropic directly with the key
    headers["x-api-key"] = API_KEY;
    headers["anthropic-version"] = "2023-06-01";
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, messages }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`API ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  return data.content?.map(b => b.text || "").join("") || "Inget svar.";
}
