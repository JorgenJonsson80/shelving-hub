import { supabase } from "./supabaseClient";

const PROXY_URL = import.meta.env.VITE_API_URL;

/**
 * Call the server-side AI proxy as the currently signed-in Supabase user.
 *
 * The browser must never have an Anthropic key or a shared proxy password.
 * The Worker validates this session token before it calls Anthropic.
 */
export async function callAI(messages, maxTokens = 1000) {
  if (!PROXY_URL) throw new Error("AI-tjänsten är inte konfigurerad.");

  const { data: sessionData, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!sessionData.session?.access_token) throw new Error("Du måste vara inloggad för att använda AI-briefen.");

  const resp = await fetch(PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${sessionData.session.access_token}`,
    },
    // Model and upper limit are enforced again by the Worker; this only
    // communicates the requested size to the trusted server.
    body: JSON.stringify({ max_tokens: maxTokens, messages }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`API ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  return data.content?.map(b => b.text || "").join("") || "Inget svar.";
}
