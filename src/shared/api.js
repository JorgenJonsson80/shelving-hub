const PROXY_URL = import.meta.env.VITE_API_URL;
const API_KEY   = import.meta.env.VITE_ANTHROPIC_API_KEY;
const IS_DEV    = import.meta.env.DEV;

/**
 * Call Claude.
 * - Dev (npm run dev): routes through Vite's /api proxy → api.anthropic.com (no CORS)
 * - Prod with VITE_API_URL: routes through Cloudflare Worker (no CORS, key server-side)
 * - Prod without VITE_API_URL: throws — set up the worker first
 */
export async function callAI(messages, maxTokens = 1000) {
  let url, headers;

  if (PROXY_URL) {
    url = PROXY_URL;
    headers = { "Content-Type": "application/json" };
  } else if (IS_DEV) {
    url = "/api/v1/messages";
    headers = {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    };
  } else {
    throw new Error("AI-funktionen kräver VITE_API_URL i produktion. Se worker/index.js.");
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
