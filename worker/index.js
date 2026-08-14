/**
 * Authenticated, rate-limited Anthropic proxy for Shelving Hub.
 *
 * Required Worker secrets:
 *   ANTHROPIC_API_KEY
 *
 * Required Worker variables (not secrets):
 *   SUPABASE_URL                 e.g. https://<project>.supabase.co
 *   SUPABASE_PUBLISHABLE_KEY     the project's anon/publishable key
 *   ALLOWED_ORIGIN               e.g. https://jorgenjonsson80.github.io
 *
 * Required binding:
 *   AI_RATE_LIMITER              configured in worker/wrangler.toml
 */
import { validateAiRequest } from "./requestValidation.js";

const MAX_BODY_BYTES = 30_000;

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (origin !== env.ALLOWED_ORIGIN) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
}

function response(body, status, cors) {
  return new Response(body, { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function verifiedUser(request, env) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  // getUser's underlying endpoint verifies the JWT with Supabase Auth. Do not
  // decode the JWT locally or trust a client-provided user id.
  const authResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      "apikey": env.SUPABASE_PUBLISHABLE_KEY,
      "Authorization": authorization,
    },
  });
  if (!authResponse.ok) return null;
  const user = await authResponse.json();
  return typeof user?.id === "string" ? user : null;
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (!cors) return new Response("Forbidden", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return response(JSON.stringify({ error: "Method not allowed" }), 405, cors);

    if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.ANTHROPIC_API_KEY || !env.AI_RATE_LIMITER) {
      return response(JSON.stringify({ error: "AI-tjänsten är inte korrekt konfigurerad." }), 503, cors);
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return response(JSON.stringify({ error: "Begäran är för stor." }), 413, cors);
    }

    try {
      const user = await verifiedUser(request, env);
      if (!user) return response(JSON.stringify({ error: "Unauthorized" }), 401, cors);

      // Limit per verified user, never per spoofable client-side identifier.
      const { success } = await env.AI_RATE_LIMITER.limit({ key: user.id });
      if (!success) {
        return response(JSON.stringify({ error: "För många AI-anrop. Försök igen om en minut." }), 429, cors);
      }

      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
        return response(JSON.stringify({ error: "Begäran är för stor." }), 413, cors);
      }

      let body;
      try { body = JSON.parse(raw); }
      catch { return response(JSON.stringify({ error: "Ogiltig JSON." }), 400, cors); }
      const checked = validateAiRequest(body);
      if (checked.error) return response(JSON.stringify({ error: checked.error }), 400, cors);

      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(checked.value),
      });

      if (!upstream.ok) {
        console.error("Anthropic request failed", upstream.status);
        return response(JSON.stringify({ error: "AI-tjänsten kunde inte slutföra begäran." }), 502, cors);
      }
      return response(await upstream.text(), 200, cors);
    } catch (error) {
      console.error("AI proxy failed", error);
      return response(JSON.stringify({ error: "AI-tjänsten kunde inte nås." }), 502, cors);
    }
  },
};
