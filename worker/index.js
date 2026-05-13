/**
 * Cloudflare Worker — Anthropic API proxy for Shelving Hub
 *
 * Setup:
 *   1. Paste this file into a new Cloudflare Worker
 *   2. Settings → Variables → add secret: ANTHROPIC_API_KEY = sk-ant-...
 *   3. Copy Worker URL → add as VITE_API_URL in GitHub repo secrets (with https://)
 */

const ALLOWED_ORIGIN = "https://jorgenjonsson80.github.io";

const CORS = {
  "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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
