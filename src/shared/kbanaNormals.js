import { supabase } from "./supabaseClient";

// Per-K-bana "normal day" volumes, derived from Historik's stored Daily
// files — lets Live.jsx show "normalt X st" without needing today's PF file
// to be uploaded in Prognos first. Same weekday-then-pooled tiering as
// Prognos's effectiveKurva, so the two features read consistently even
// though they're built from different tables.
const MIN_SAMPLES_VECKODAG = 5;
const MIN_SAMPLES_POOLAD = 5;

export async function fetchHistorikDays() {
  const { data, error } = await supabase.from("historik_days").select("date_str, rows");
  if (error) throw error;
  return data;
}

// Returns { [kbana]: { kolli, kart, helpall, n, tier } } — average day
// totals per K-bana. Skips a K-bana entirely if there isn't enough history
// yet (rather than guessing from too few samples).
export function buildKbanaNormals(days, weekday) {
  const weekdayDays = days.filter(d => new Date(d.date_str + "T12:00:00").getDay() === weekday);
  const source = weekdayDays.length >= MIN_SAMPLES_VECKODAG ? weekdayDays
    : days.length >= MIN_SAMPLES_POOLAD ? days
    : null;
  if (!source) return {};
  const tier = weekdayDays.length >= MIN_SAMPLES_VECKODAG ? "veckodag" : "poolad";

  const byKb = {};
  for (const day of source) {
    for (const r of day.rows || []) {
      if (!r.kbana) continue;
      if (!byKb[r.kbana]) byKb[r.kbana] = { kolli: [], kart: [], helpall: [] };
      byKb[r.kbana].kolli.push(r.kolli || 0);
      byKb[r.kbana].kart.push(r.kart || 0);
      byKb[r.kbana].helpall.push(r.helpall || 0);
    }
  }
  const avg = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
  const out = {};
  for (const [kb, v] of Object.entries(byKb)) {
    out[kb] = { kolli: avg(v.kolli), kart: avg(v.kart), helpall: avg(v.helpall), n: v.kolli.length, tier };
  }
  return out;
}
