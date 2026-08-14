import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "public-key",
  ANTHROPIC_API_KEY: "server-secret",
  ALLOWED_ORIGIN: "https://jorgenjonsson80.github.io",
  AI_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
};

function request(body, headers = {}) {
  return new Request("https://worker.example", {
    method: "POST",
    headers: {
      "Origin": env.ALLOWED_ORIGIN,
      "Authorization": "Bearer user-jwt",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  env.AI_RATE_LIMITER.limit.mockReset();
  env.AI_RATE_LIMITER.limit.mockResolvedValue({ success: true });
});

describe("AI Worker", () => {
  it("rejects a request from another origin before doing any work", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(request({}, { Origin: "https://attacker.example" }), env);

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a verified Supabase user", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(request({ messages: [{ role: "user", content: "Brief" }] }), env);

    expect(response.status).toBe(401);
    expect(env.AI_RATE_LIMITER.limit).not.toHaveBeenCalled();
  });

  it("forwards only the validated, capped payload after auth and rate limiting", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: "user-123" }))
      .mockResolvedValueOnce(Response.json({ content: [{ type: "text", text: "Klart" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(request({
      model: "an-unapproved-model",
      max_tokens: 50_000,
      messages: [{ role: "user", content: "Skapa brief" }],
    }), env);

    expect(response.status).toBe(200);
    expect(env.AI_RATE_LIMITER.limit).toHaveBeenCalledWith({ key: "user-123" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: "Skapa brief" }],
    });
  });

  it("does not call Anthropic when the per-user limit is exceeded", async () => {
    env.AI_RATE_LIMITER.limit.mockResolvedValue({ success: false });
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "user-123" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(request({ messages: [{ role: "user", content: "Brief" }] }), env);

    expect(response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
