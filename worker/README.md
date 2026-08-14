# Shelving Hub AI Worker

This Worker is the only component allowed to hold `ANTHROPIC_API_KEY`.

## Configure

1. In `worker/wrangler.toml`, set a `name` and choose an unused numeric `namespace_id` for this Cloudflare account.
2. Deploy the Worker from this directory with Wrangler 4.36 or newer.
3. In the Worker settings, add:
   - secret `ANTHROPIC_API_KEY`
   - variable `SUPABASE_URL` — the same value as `VITE_SUPABASE_URL`
   - variable `SUPABASE_PUBLISHABLE_KEY` — the same value as `VITE_SUPABASE_ANON_KEY`
   - variable `ALLOWED_ORIGIN` — `https://jorgenjonsson80.github.io`
4. Set `VITE_API_URL` in GitHub Actions to the deployed Worker URL.
5. Delete the obsolete GitHub secrets `VITE_ANTHROPIC_API_KEY` and `VITE_APP_KEY` after the next successful deployment.

The Worker requires a valid Supabase access token, verifies it with Supabase Auth, rate-limits by verified user ID, caps prompts at 30 KB and completions at 1,000 tokens, and allows only the application’s fixed Claude model.
