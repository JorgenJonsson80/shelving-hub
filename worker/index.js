/**
 * Cloudflare Worker — Anthropic API proxy for Shelving Hub
 *
 * Setup:
 *   1. Paste this file into a new Cloudflare Worker
 *   2. Settings → Variables → add secret: ANTHROPIC_API_KEY = sk-ant-...
 *   3. Settings → Variables → add secret: APP_SHARED_SECRET = (see below)
 *   4. Copy Worker URL → add as VITE_API_URL in GitHub repo secrets (with https://)
 *   5. Add the same APP_SHARED_SECRET value as VITE_APP_KEY in GitHub repo secrets
 */

const ALLOWED_ORIGIN = "https://jorgenjonsson80.github.io";

const CORS = {
  "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Key",
};

export default {
  async fetch(request, env) {
    // Always handle preflight first
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: CORS });
    }

    // Shared-secret check — CORS alone only stops browsers, not direct calls.
    // Raises the bar from "guess the worker URL" to "extract the key from the bundle".
    if (request.headers.get("X-App-Key") !== env.APP_SHARED_SECRET) {
      return new Response("Unauthorized", { status: 401, headers: CORS });
    }

    try {
      const body = await request.text();

      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body,
      });

      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
  },
};
