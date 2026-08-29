import { supabase } from "./supabaseClient";

// Shared by Prognos.jsx and Pafyllningsmonster.jsx — replaces what used to be
// two separate, inconsistently-shaped localStorage keys ("prognos_days_v1"
// and "pafyll_days_v1"). Both tabs derive their data from the same PF-export
// parser output, so they now read/write the same table with the full shape.

function rowToDay(row) {
  return {
    datum: row.datum,
    total: row.total,
    perKalla: row.per_kalla,
    perTimme: row.per_timme,
    perTimmeKalla: row.per_timme_kalla,
    rows: row.rows,
  };
}

// pf_days.rows holds one JSON object per individual PF line item (1500–2000+
// per day) — unlike historik_days' small per-K-bana daily summaries, this
// table's payload grows fast and forever. Prognos.jsx and Pafyllningsmonster.jsx
// each pull the whole table on mount, and neither needs more than a few dozen
// same-weekday samples (MIN_SAMPLES_VECKODAG/POOLAD/MANAD, all ≤5) or the
// current month (monthAvgByKb) to work — so an unbounded fetch keeps paying
// (in transfer + JSON parsing, on a Supabase project shared with another app)
// for months of history no calculation actually uses. Bounding to a rolling
// window trims that cost with room to spare for every existing use.
const FETCH_WINDOW_DAYS = 120;

// Prognos.jsx and Pafyllningsmonster.jsx both call fetchPfDays() independently
// on mount, and refetch after every upload — on the heaviest table in the app
// (1500-2000+ rows/day), so visiting both tabs in one session paid for this
// window twice. Caching the in-flight/resolved promise means the second
// caller reuses the first's fetch instead of re-hitting the network; any
// write invalidates it so the next read is fresh. Callers get a shallow
// array copy so neither can mutate the shared cached array out from under
// the other (the row objects inside are still shared, same as before —
// nothing here mutates a day's own fields in place).
let cachedPromise = null;

export async function fetchPfDays() {
  if (!cachedPromise) {
    cachedPromise = (async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - FETCH_WINDOW_DAYS);
      const { data, error } = await supabase.from("pf_days").select("*")
        .gte("datum", cutoff.toISOString().slice(0, 10))
        .order("datum");
      if (error) throw error;
      return data.map(rowToDay);
    })().catch((error) => {
      cachedPromise = null;
      throw error;
    })
  }
  const days = await cachedPromise;
  return [...days];
}

function invalidatePfDaysCache() {
  cachedPromise = null;
}

export async function upsertPfDay(d) {
  const { error } = await supabase.from("pf_days").upsert({
    datum: d.datum,
    total: d.total ?? 0,
    per_kalla: d.perKalla ?? {},
    per_timme: d.perTimme ?? [],
    per_timme_kalla: d.perTimmeKalla ?? {},
    rows: d.rows ?? [],
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  invalidatePfDaysCache();
}

export async function deleteAllPfDays() {
  const { error } = await supabase.from("pf_days").delete().not("datum", "is", null);
  if (error) throw error;
  invalidatePfDaysCache();
}

// One-time migration helper — merges the two old localStorage keys into the
// shape pf_days expects, preferring the richer pafyll_days_v1 entry when a
// date exists in both.
export function loadLegacyLocalPfDays() {
  const lsGet = (key) => {
    try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? []; }
    catch { return []; }
  };
  const byDatum = {};
  for (const d of lsGet("prognos_days_v1")) byDatum[d.datum] = d;
  for (const d of lsGet("pafyll_days_v1")) byDatum[d.datum] = { ...byDatum[d.datum], ...d };
  return Object.values(byDatum);
}
