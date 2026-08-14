# Shelving Hub AI Worker

This Worker is the only component allowed to hold `ANTHROPIC_API_KEY`.

## Configure

1. In `worker/wrangler.toml`, set a `name` and choose an unused numeric `namespace_id` for this Cloudflare account.
2. Add GitHub repository secrets `CLOUDFLARE_API_TOKEN` (Workers: Edit permission) and `CLOUDFLARE_ACCOUNT_ID`. The deployment workflow deploys the Worker before GitHub Pages, so the two versions cannot silently drift apart.
3. In the Worker settings, add:
   - secret `ANTHROPIC_API_KEY`
   - variable `SUPABASE_URL` — the same value as `VITE_SUPABASE_URL`
   - variable `SUPABASE_PUBLISHABLE_KEY` — the same value as `VITE_SUPABASE_ANON_KEY`
   - variable `ALLOWED_ORIGIN` — `https://jorgenjonsson80.github.io`
4. The deployment workflow automatically uses the deployed Worker URL; no `VITE_API_URL` secret is needed.
5. Delete the obsolete GitHub secrets `VITE_API_URL`, `VITE_ANTHROPIC_API_KEY` and `VITE_APP_KEY` after the next successful deployment, and rotate the old Anthropic key because it was previously exposed to browsers.

The Worker requires a valid Supabase access token, verifies it with Supabase Auth, rate-limits by verified user ID, caps prompts at 30 KB and completions at 1,000 tokens, and allows only the application’s fixed Claude model. `keep_vars = true` preserves the Cloudflare-configured values during CI deployment; they remain runtime configuration, never bundled into the website. CI makes a deliberately unauthenticated request after deployment; it must receive `401`, so misconfigured Worker variables (`503`) or an incorrect allowed origin (`403`) block the Pages release.
