/**
 * Cloudflare Worker — Anthropic API proxy for Shelving Hub
 *
 * Deploy:
 *   1. Go to https://workers.cloudflare.com and create a free account
 *   2. Create a new Worker, paste this file
 *   3. Add secret: Settings → Variables → add ANTHROPIC_API_KEY
 *   4. Copy the worker URL (e.g. https://shelving-hub-proxy.YOUR_NAME.workers.dev)
 *   5. Add VITE_API_URL = that URL to your GitHub repo secrets
 *
 * The worker adds the API key server-side so it's never in the browser bundle.
 */

const ALLOWED_ORIGIN = "https://jorgenjonsson80.github.io";

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const body = await request.text();

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body,
    });

    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  },
};
