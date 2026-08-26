-- Shelving Hub — Supabase schema
--
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Replaces the localStorage-only persistence with shared, durable tables.
--
-- Access model: every table is locked down to logged-in users only (RLS).
-- There is no self-service sign-up in the app — create user accounts yourself
-- under Authentication → Users → Add user in the Supabase dashboard.

-- ── historik_days ────────────────────────────────────────────────────────────
-- Replaces the "shelving_history_v2" localStorage key (was: nested object
-- month → day → record). One row per calendar day instead of one giant blob.

create table if not exists historik_days (
  date_str    date primary key,
  file_name   text,
  rows        jsonb not null default '[]',
  summary     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── pf_days ──────────────────────────────────────────────────────────────────
-- Replaces BOTH "prognos_days_v1" and "pafyll_days_v1". Both tabs derive their
-- data from the same PF-export parser output — they just stored inconsistent
-- subsets of it before. One shared table, full shape, fixes that for good.

create table if not exists pf_days (
  datum             date primary key,
  total             integer not null default 0,
  per_kalla         jsonb not null default '{}',
  per_timme         jsonb not null default '[]',
  per_timme_kalla   jsonb not null default '{}',
  rows              jsonb not null default '[]',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ── ledtid_observations ─────────────────────────────────────────────────────
-- Replaces "ledtid_obs_v1" (was: flat array, whole thing rewritten on every
-- change). Row-per-observation avoids that, and matches the existing
-- import-dedup key (kbana, skickad, klar, datum) as a real constraint.
-- Note: the old "ledtid" field was a pure duplicate of transportTid — dropped,
-- the app computes it from transport_tid instead.

create table if not exists ledtid_observations (
  id              bigint generated always as identity primary key,
  datum           date not null,
  veckodag        smallint not null,
  timme           smallint,
  kbana           text not null,
  systemtid       text,
  skickad         text not null,
  klar            text not null,
  transport_tid   numeric not null,
  mezz_vantetid   numeric,
  total_ledtid    numeric,
  antal_kolli     integer,
  orsak           text,
  notering        text,
  created_at      timestamptz not null default now(),
  unique (kbana, skickad, klar, datum)
);

-- fetchLedtidObservations() (ledtidDb.js) queries `gte(datum, cutoff) order
-- by datum` for its rolling window — unlike pf_days/historik_days, whose
-- date column IS the primary key (a covering index for free), datum here is
-- just a plain column with no index of its own until this. Invisible at
-- today's row counts, but keeps the bounded-window query cheap as the table
-- grows instead of falling back to a sequential scan + sort.
create index if not exists ledtid_observations_datum_idx on ledtid_observations (datum);

-- ── app_settings ─────────────────────────────────────────────────────────────
-- Generic key/value table for the 7 "current setting" keys that don't need
-- their own relational shape: Live.jsx's 5 keys (bemanning/pall/schedule/
-- bastid/passes) + Raknare.jsx's 2 keys (e1_loc_col/e1_vnr_col). Mirrors the
-- old localStorage key→value pattern almost exactly.

create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Small internal team tool, no per-user data ownership needed: any logged-in
-- user gets full access, anyone not logged in gets nothing. The public "anon"
-- key that ships in the app bundle is safe to expose (same as VITE_API_URL
-- already is) — it grants nothing by itself, RLS is what actually gates access.

alter table historik_days         enable row level security;
alter table pf_days               enable row level security;
alter table ledtid_observations   enable row level security;
alter table app_settings          enable row level security;

create policy "authenticated_full_access" on historik_days
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_full_access" on pf_days
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_full_access" on ledtid_observations
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "authenticated_full_access" on app_settings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
