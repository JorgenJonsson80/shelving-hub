// Pure PF-inflow forecasting math, used by Prognos.jsx. Kept separate from
// the component (like liveUtils.js) so the curve math is unit-testable
// without needing React or Supabase.

// Fallback empirical cumulative curve — 9 days of data (5–25 Jun 2026, 15 033
// rows), used only when there isn't enough stored history yet to build one
// from real data (see buildEmpiriskKurva / effectiveKurva below).
// Index 0 = pct done by end of hour 5, index 11 = end of hour 16
export const KURVA = {
  timmar: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  GM:    [ 0,  2, 14, 27, 44, 55, 63, 74, 81, 91, 97, 98],
  Mezz:  [11, 16, 29, 42, 44, 55, 69, 80, 87, 96, 98, 99],
  ULC:   [ 7, 14, 28, 45, 46, 57, 71, 83, 90, 98, 99,100],
  PL09:  [ 9, 16, 28, 45, 48, 59, 72, 81, 88, 96, 99, 99],
  TOTAL: [ 3,  7, 19, 33, 44, 56, 66, 77, 84, 93, 97, 99],
};

export const MIN_SAMPLES_VECKODAG = 5;
export const MIN_SAMPLES_POOLAD = 5;
export const MIN_SAMPLES_MANAD = 3;

// A stored day only tells the truth about "how much of a normal day is done
// by hour X" if the file behind it was captured near end of day. A file
// uploaded mid-morning (from either this tab or Påfyllningsmönster, which
// shares the same pf_days table) still gets saved under that date — its
// "total" is just whatever had arrived by then, not the real day total.
// Left untreated, such a day looks like "100% done by 08:00" once it becomes
// history, which drags the learned curve's early hours up and makes later
// forecasts (estTotal = sett / andelKlar) come out far too low. Require data
// late in the day before trusting a stored day as a real reference point.
export const DAGEN_KOMPLETT_TIMME = 16;
export function dagenArKomplett(day) {
  return Array.isArray(day.perTimme) && day.perTimme.slice(DAGEN_KOMPLETT_TIMME).some(v => v > 0);
}

// Builds a KURVA-shaped object from real stored days instead of the
// hardcoded fallback. Falls back per-source (not per-curve) to KURVA's
// values when a source has no usable data across the given days at all
// (e.g. a day where PL09 was 0) — keeps the rest of the curve real.
export function buildEmpiriskKurva(days) {
  const timmar = KURVA.timmar;
  const sources = ["GM", "Mezz", "ULC", "PL09", "TOTAL"];
  const out = { timmar, baseline: {} };
  for (const src of sources) {
    const perBucket = timmar.map(() => []);
    const totals = [];
    for (const day of days) {
      const total  = src === "TOTAL" ? day.total   : day.perKalla?.[src];
      const hourly = src === "TOTAL" ? day.perTimme : day.perTimmeKalla?.[src];
      if (!total || !hourly) continue;
      totals.push(total);
      let cum = 0;
      const cumByHour = hourly.map(v => (cum += v));
      timmar.forEach((h, i) => perBucket[i].push((cumByHour[h] / total) * 100));
    }
    out[src] = perBucket.map((arr, i) =>
      arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : KURVA[src][i]
    );
    // Average full-day total for this source across the same days used to
    // build the % curve above — the historical reference point blendKvar
    // leans on before a källa has enough of today's own signal to trust.
    out.baseline[src] = totals.length ? totals.reduce((s, v) => s + v, 0) / totals.length : null;
  }
  return out;
}

// Each curve bucket means "% of a normal day done by the END of hour H" —
// i.e. an anchor point at clock time (H+1):00. We add an implicit 0%
// anchor at the start of the first bucket's hour, then interpolate linearly
// between the two nearest anchors by elapsed minutes. This replaces the old
// step function, which jumped straight to the next bucket's value the
// instant the clock ticked past hour H — over-crediting progress for most
// of every hour and then snapping at the boundary.
// `nowT` is a fractional hour, e.g. 12.5 for 12:30.
export function getAndelKlar(kurva, kalla, nowT) {
  const vals = kurva[kalla];
  if (!vals || !vals.length) return 1.0;

  const points = [
    { t: kurva.timmar[0], v: 0 },
    ...kurva.timmar.map((h, i) => ({ t: h + 1, v: vals[i] })),
  ];

  if (nowT <= points[0].t) return 0;
  const last = points[points.length - 1];
  if (nowT >= last.t) return last.v / 100;

  for (let i = 1; i < points.length; i++) {
    if (nowT <= points[i].t) {
      const a = points[i - 1], b = points[i];
      const frac = (nowT - a.t) / (b.t - a.t);
      return (a.v + (b.v - a.v) * frac) / 100;
    }
  }
  return last.v / 100;
}

export function calcPrognos(kurva, kalla, sett, nowT) {
  const andelKlar = getAndelKlar(kurva, kalla, nowT);
  if (andelKlar <= 0) return { estTotal: null, kvar: null, osäkert: true, andelKlar: 0 };
  const estTotal = sett / andelKlar;
  const kvar = Math.max(0, estTotal - sett);
  return { estTotal: Math.round(estTotal), kvar: Math.round(kvar), andelKlar };
}

// Cartons ("kartonger", PF-row `labels` column) have no dedicated self-
// learning curve — no per-hour history is stored for them (see
// buildEmpiriskKurva, which only tracks GM/Mezz/ULC/PL09/TOTAL row counts) —
// so the estimate rides the same TOTAL "% of day done" curve as PF-row-count,
// a reasonable proxy since cartons arrive alongside the same påfyllningar.
// Unlike PF-row-count (self-consistent with its own curve by definition),
// the labels-per-row ratio isn't constant through the day, and dividing by a
// small andelKlar amplifies that mismatch heavily: at andelKlar 0.13 a
// single delivery with an unusually high carton count gets blown up ~7.7x.
// Bug report 2026-08-19: guessed 7000 kartonger around 7:30 when the day
// landed at 3500–4500 (PF-row estimate was fine at the same moment). Below
// this floor the raw sett/andelKlar guess isn't trusted on its own — see
// blendKvar below, which leans on a historical baseline instead of just
// returning nothing (2026-08-21: that "nothing" made Live's ETA silently
// reduce to queue-only most mornings, which is the actual thing being fixed
// here).
export const KART_MIN_ANDEL = 0.30;
export function calcKartongPrognos(andelKlarTotal, kartSett, baselineTotal = null) {
  if (andelKlarTotal < KART_MIN_ANDEL) {
    if (baselineTotal == null) return { estTotal: null, kvar: null, osäkert: true };
    const kvar = Math.round(blendKvar(kartSett, andelKlarTotal, KART_MIN_ANDEL, baselineTotal));
    return { estTotal: kartSett + kvar, kvar, osäkert: false, blended: true };
  }
  const estTotal = Math.round(kartSett / andelKlarTotal);
  const kvar = Math.max(0, estTotal - kartSett);
  return { estTotal, kvar };
}

// Blends a live sett/andelKlar-based guess with a historical baseline total,
// weighted by how far andelKlar is through the confidence floor (minAndel).
// At andelKlar 0 → pure baseline guess ("assume today is a normal day and
// subtract what's already arrived"). At andelKlar >= minAndel → pure live
// guess, same number calcPrognos/calcKartongPrognos already produce past the
// floor, so there's no jump the instant a källa crosses it. Replaces the old
// on/off floor (0 below, live guess above) that made remainWork/ETA in
// Live.jsx quietly collapse to "queue-only" for a big chunk of the morning —
// GM in particular doesn't clear KALLA_MIN_ANDEL until ~08:15-08:30 most
// days (see KURVA). Without a baseline (too little stored history site-wide
// to have one yet) there's nothing to blend against, so it falls back to the
// old conservative floor behavior.
export function blendKvar(sett, andelKlar, minAndel, baselineTotal) {
  if (baselineTotal == null) {
    return andelKlar >= minAndel && andelKlar > 0 ? Math.max(0, sett / andelKlar - sett) : 0;
  }
  const baselineKvar = Math.max(0, baselineTotal - sett);
  if (minAndel <= 0 || andelKlar >= minAndel) {
    return andelKlar > 0 ? Math.max(0, sett / andelKlar - sett) : baselineKvar;
  }
  const weight = andelKlar / minAndel;
  const liveKvar = andelKlar > 0 ? Math.max(0, sett / andelKlar - sett) : baselineKvar;
  return weight * liveKvar + (1 - weight) * baselineKvar;
}

// Same amplification risk as KART_MIN_ANDEL above (estTotal = sett /
// andelKlar), but for the per-source PF-row "kvar" (GM/Mezz/ULC/PL09) that
// Prognos.jsx's kbanaForecast redistributes across K-banor and shares with
// Live.jsx as forecastKolli/forecastKart. A source that's barely started for
// the day (small andelKlar) can blow up that source's kvar, which then
// inflates remainWork for whichever lane draws heavily on it — producing an
// implausible ETA in Live's "Klart vid nuv. takt" even while every other
// number on screen looks fine. Callers should run a source below this floor
// through blendKvar (with that källa's historical baseline) rather than
// trusting the raw sett/andelKlar guess outright or, as before, treating it
// as 0/no signal — see blendKvar's comment for why the latter made Live's
// ETA read as queue-only for most of the morning.
export const KALLA_MIN_ANDEL = 0.30;
