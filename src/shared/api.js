const PROXY_URL = import.meta.env.VITE_API_URL;
const API_KEY   = import.meta.env.VITE_ANTHROPIC_API_KEY;

/**
 * Call Claude.
 * - With VITE_API_URL: routes through Cloudflare Worker (API key server-side, more secure)
 * - Without: calls Anthropic directly from the browser using the required browser-access header
 */
export async function callAI(messages, maxTokens = 1000) {
  let url, headers;

  if (PROXY_URL) {
    url = PROXY_URL;
    headers = { "Content-Type": "application/json" };
  } else {
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
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
