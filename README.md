# Shelving Hub

Internt verktyg för lagerdrift: följ K-banor i realtid, prognostisera inkommande PF-volym, håll koll på bemanning, ledtider och historik. React 19 + Vite, driftsatt på GitHub Pages, med Supabase (Postgres + Auth) som delad backend och en Cloudflare Worker som proxar AI-anrop.

Live: https://jorgenjonsson80.github.io/shelving-hub/

## Flikar

- **Live** — realtidsstatus per K-bana: kö, bemanning, Buffert/Saldo, ETA.
- **Prognos** — förväntat PF-inflöde resten av dagen, per källa och K-bana, från en självlärande veckodagskurva. Delar sin per-K-bana-prognos med Live så Buffert/Saldo kan räkna in väntat inflöde, inte bara det som redan syns i kön.
- **Historik** — dagliga siffror per K-bana + månadssnitt, jämfört mot föregående månad och totalsnitt.
- **Ledtid** — transporttider mellan GM och K-banor, larmnivåer.
- **Påfyllningsmönster** — historiska påfyllningsmönster per K-bana.
- **Bemanning** — bemanningsöversikt.
- **Brief** — AI-genererad dagsbriefing baserad på dagens och historiska siffror.
- **Räknare** — tre snabba Excel-räknare (helpallar, infattning/scan-andel, bemanning).

## Lokal utveckling

```bash
npm install
npm run dev       # Vite dev-server
npm run test      # Vitest, watch-läge
npm run test:run  # Vitest, en körning
npm run lint      # ESLint
npm run build     # produktionsbygge till dist/
```

### Miljövariabler (`.env.local`, gitignorad via `*.local`)

| Variabel | Syfte |
|---|---|
| `VITE_SUPABASE_URL` | Supabase-projektets URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon-nyckel — publik med design, RLS gate:ar åtkomst, inte nyckeln |
| `VITE_API_URL` | URL till den deployade Cloudflare Workern (AI-proxy) |

I produktion sätts dessa som GitHub Actions-secrets. `VITE_API_URL` sätts automatiskt till Workerns URL vid varje deploy (se `.github/workflows/deploy.yml`) — ingen manuell synk behövs.

## Backend

- **Supabase** (Postgres + Auth). `supabase/schema.sql` är källan till sanningen för schemat, men det finns ingen migrationstooling — ändringar klistras in manuellt i Supabase SQL-editorn efter att filen uppdaterats. Ingen självregistrering i appen; konton skapas manuellt i Supabase-dashboarden, och varje tabell är RLS-gated till inloggade användare (ett enda delat team, ingen per-användar-ägd data).
- **Cloudflare Worker** (`worker/`) — enda komponenten som har Anthropic-API-nyckeln. Verifierar varje anrop mot Supabase Auth, hastighetsbegränsar per verifierad användare, och är den enda vägen `Brief.jsx`s `callAI()` (`src/shared/api.js`) når Anthropic. Se `worker/README.md` för konfiguration av Cloudflare-sidans miljövariabler.

## Deploy

Push till `main` kör `.github/workflows/deploy.yml`: Workern deployas och hälsokontrolleras (måste svara 401 obehörig på ett oautentiserat anrop) *innan* sajten byggs och publiceras till GitHub Pages — en felkonfigurerad Worker blockerar alltså releasen istället för att tyst gå live med en trasig AI-funktion.
