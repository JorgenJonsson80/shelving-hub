import { supabase } from "./supabaseClient";

function rowToObs(row) {
  return {
    id: row.id,
    datum: row.datum,
    veckodag: row.veckodag,
    timme: row.timme,
    kbana: row.kbana,
    systemtid: row.systemtid,
    skickad: row.skickad,
    klar: row.klar,
    transportTid: row.transport_tid,
    mezzVantetid: row.mezz_vantetid,
    totalLedtid: row.total_ledtid,
    ledtid: row.transport_tid, // was a stored duplicate of transportTid — now just aliased on read
    antalKolli: row.antal_kolli,
    orsak: row.orsak,
    notering: row.notering,
  };
}

// ledtid_observations is a row-per-observation event log — same shape as
// pf_days, grows forever, never shrinks. Both call sites (Ledtid.jsx,
// Prognos.jsx) only use it for kbanaStats()'s per-kbana average/median/
// alarm-level, which is a rolling operational baseline, not a historical
// record — recent performance is what an alarm threshold should reflect
// anyway. Bounding this DOES change the computed numbers (average/median/
// larmniva now reflect the last 120 days instead of all-time), unlike a
// pagination fix that's purely about transfer size — matching pf_days'
// existing window here for consistency rather than picking a new number.
const FETCH_WINDOW_DAYS = 120;

// Ledtid.jsx and Prognos.jsx both call fetchLedtidObservations() independently
// on mount — caching the in-flight/resolved promise means the second caller
// reuses the first's fetch instead of re-hitting the network. Any write
// invalidates it so the next read reflects the change.
let cachedPromise = null;

export async function fetchLedtidObservations() {
  if (!cachedPromise) {
    cachedPromise = (async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - FETCH_WINDOW_DAYS);
      const { data, error } = await supabase
        .from("ledtid_observations")
        .select("*")
        .gte("datum", cutoff.toISOString().slice(0, 10))
        .order("datum");
      if (error) throw error;
      return data.map(rowToObs);
    })().catch((error) => {
      cachedPromise = null;
      throw error;
    })
  }
  const obs = await cachedPromise;
  return [...obs];
}

function invalidateLedtidCache() {
  cachedPromise = null;
}

export async function insertLedtidObservation(o) {
  const { data, error } = await supabase.from("ledtid_observations").insert({
    datum: o.datum,
    veckodag: o.veckodag,
    timme: o.timme,
    kbana: o.kbana,
    systemtid: o.systemtid,
    skickad: o.skickad,
    klar: o.klar,
    transport_tid: o.transportTid,
    mezz_vantetid: o.mezzVantetid,
    total_ledtid: o.totalLedtid,
    antal_kolli: o.antalKolli,
    orsak: o.orsak,
    notering: o.notering,
  }).select().single();
  if (error) throw error;
  invalidateLedtidCache();
  return rowToObs(data);
}

export async function deleteLedtidObservation(id) {
  const { error } = await supabase.from("ledtid_observations").delete().eq("id", id);
  if (error) throw error;
  invalidateLedtidCache();
}
