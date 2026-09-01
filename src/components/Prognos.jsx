import { useState, useEffect, useMemo } from "react";
import { C } from "../shared/theme";
import { Alert, DeltaChip, Dropzone, Panel } from "../shared/components";
import { parsePFExport } from "../shared/parsers";
import { classifyLocation, pctDelta } from "../shared/liveUtils";
import { fetchPfDays, upsertPfDay } from "../shared/pfDaysDb";
import { fetchLedtidObservations } from "../shared/ledtidDb";
import { useSetting } from "../shared/useSetting";
import {
  KURVA, MIN_SAMPLES_VECKODAG, MIN_SAMPLES_POOLAD, MIN_SAMPLES_MANAD, KALLA_MIN_ANDEL,
  dagenArKomplett, buildEmpiriskKurva, getAndelKlar, calcPrognos, calcKartongPrognos, blendKvar,
} from "../shared/prognosCurve";

function toMin(str) {
  if (!str) return null;
  const [h, m] = String(str).split(":").map(Number);
  return isNaN(h) ? null : h * 60 + (m || 0);
}

function fmtHM(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const VECKODAGAR = ["Sön","Mån","Tis","Ons","Tor","Fre","Lör"];

// Fast identitetsfärg per källa — samma dot+textfärg varhelst källan visas,
// så man känner igen GM/Mezz/ULC/PL09 på färgen istället för att läsa texten.
const KALLA_COLOR = { GM: C.green, Mezz: C.red, ULC: C.blue, PL09: C.yellow };

function KallaDot({ color }) {
  return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: color, marginRight: 7 }} />;
}

function meanStd(values) {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance), n };
}

const MIN_SAMPLES = 4;
const Z_THRESHOLD = 2;
const MIN_FACIT_SAMPLES = 3;

function computeKbanaAccuracy(checkpoints, storedDays, todayDatum) {
  const byKb = {};
  for (const [datum, cp] of Object.entries(checkpoints)) {
    if (datum === todayDatum || !cp.byKb) continue;
    const day = storedDays.find(d => d.datum === datum);
    if (!day || !dagenArKomplett(day)) continue;
    const actual = perKbanaStats(day.rows);
    for (const [kb, est] of Object.entries(cp.byKb)) {
      const act = actual[kb]?.total || 0;
      if (act === 0 && est === 0) continue;
      const pctOff = act > 0 ? (Math.abs(est - act) / act) * 100 : 100;
      if (!byKb[kb]) byKb[kb] = [];
      byKb[kb].push(pctOff);
    }
  }
  const out = {};
  for (const [kb, vals] of Object.entries(byKb)) {
    if (vals.length < MIN_FACIT_SAMPLES) continue;
    out[kb] = { avgOff: vals.reduce((s, v) => s + v, 0) / vals.length, n: vals.length };
  }
  return out;
}

function AccuracyChip({ avgOff, n }) {
  const color = avgOff <= 10 ? C.green : avgOff <= 20 ? C.yellow : C.red;
  return (
    <span
      title={`Snitt avvikelse mot facit, senaste ${n} spårade dagarna`}
      style={{ fontSize: 10, fontWeight: 700, color, border: `1px solid ${color}55`, background: color + "18", borderRadius: 5, padding: "2px 6px", whiteSpace: "nowrap" }}
    >
      ±{avgOff.toFixed(0)}% ({n}d)
    </span>
  );
}

// Per K-bana: total PF that day + count per källa, for one historical day's rows.
function perKbanaStats(rows) {
  const perKb = {};
  for (const row of rows) {
    const kb = classifyLocation(row.toLoc);
    if (!kb) continue;
    if (!perKb[kb]) perKb[kb] = { total: 0, kalla: { GM: 0, Mezz: 0, ULC: 0, PL09: 0 } };
    perKb[kb].total++;
    if (row.kalla in perKb[kb].kalla) perKb[kb].kalla[row.kalla]++;
  }
  return perKb;
}

// Simple inline bar chart — shows PF per hour (0–23)
function HourBar({ perTimme, highlight }) {
  const max = Math.max(...perTimme, 1);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 48, padding: "0 2px" }}>
      {hours.map(h => {
        const v = perTimme[h] ?? 0;
        const pct = (v / max) * 100;
        const isHL = highlight && h >= highlight[0] && h <= highlight[1];
        const color = isHL ? C.accent : C.blue;
        return (
          <div key={h} title={`Kl ${h}: ${v} PF`}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div style={{ width: "100%", height: `${pct}%`, background: color, borderRadius: 2, opacity: v ? 1 : 0.15, minHeight: v ? 2 : 0 }} />
            {h % 4 === 0 && (
              <div style={{ fontSize: 8, color: C.dim, lineHeight: 1 }}>{h}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Prognos() {
  const [drag, setDrag]             = useState(false);
  const [todayData, setTodayData]   = useState(null);
  const [err, setErr]               = useState(null);
  const [now, setNow]               = useState(() => new Date());
  const [storedDays, setStoredDays] = useState([]);
  const [filterVeckodag, setFilterVeckodag] = useState(false);
  const [ledtidObs, setLedtidObs]   = useState([]);
  const [checkpoints, setCheckpoints] = useSetting("prognos_checkpoints", {});
  const [, setSharedKbanaForecast]    = useSetting("prognos_kbana_forecast", null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetchPfDays().then(setStoredDays).catch(e => setErr(e.message));
  }, []);

  useEffect(() => {
    fetchLedtidObservations().then(setLedtidObs).catch(() => {});
  }, []);

  const nowHour = now.getHours();
  const nowT = nowHour + now.getMinutes() / 60;

  const effectiveKurva = useMemo(() => {
    const todayWd = now.getDay();
    const history = storedDays.filter(d => d.rows?.length > 0 && d.datum !== todayData?.datum && dagenArKomplett(d));
    const veckodagDays = history.filter(d => new Date(d.datum + "T12:00:00").getDay() === todayWd);

    if (veckodagDays.length >= MIN_SAMPLES_VECKODAG) {
      return { kurva: buildEmpiriskKurva(veckodagDays), tier: "veckodag", n: veckodagDays.length, days: veckodagDays };
    }
    if (history.length >= MIN_SAMPLES_POOLAD) {
      return { kurva: buildEmpiriskKurva(history), tier: "poolad", n: history.length, days: history };
    }
    return { kurva: KURVA, tier: "fast", n: 0, days: [] };
  }, [storedDays, todayData, now]);

  const handleFile = (f) => {
    setErr(null);
    parsePFExport(f).then(async (days) => {
      if (!days.length) { setErr("Inga rader hittades i filen."); return; }
      const best = [...days].sort((a, b) => b.total - a.total)[0];
      setTodayData(best);
      // Store every day with real rows for K-bana history / self-learning curve.
      const toUpsert = days.filter(d => d.rows?.length > 0);
      for (const d of toUpsert) {
        try { await upsertPfDay(d); } catch { /* skip failed day, keep going */ }
      }
      setStoredDays(await fetchPfDays());
    }).catch(e => setErr(e.message));
  };

  const forecast = useMemo(() => {
    if (!todayData) return null;
    const { perKalla, total, perTimme } = todayData;
    const kurva = effectiveKurva.kurva;

    const totalProg = calcPrognos(kurva, "TOTAL", total, nowT);
    const andelKlarTotal = getAndelKlar(kurva, "TOTAL", nowT);
    const klartPct = Math.round(andelKlarTotal * 100);

    const gmProg   = calcPrognos(kurva, "GM",   perKalla.GM,   nowT);
    const mezzProg = calcPrognos(kurva, "Mezz", perKalla.Mezz, nowT);
    const ulcProg  = calcPrognos(kurva, "ULC",  perKalla.ULC,  nowT);
    const pl09Prog = calcPrognos(kurva, "PL09", perKalla.PL09, nowT);

    const gmLåg = gmProg.kvar != null ? Math.round(gmProg.kvar * 0.75) : null;
    const gmHög = gmProg.kvar != null ? Math.round(gmProg.kvar * 1.25) : null;

    // Number of Labels is per-PF-row cartons — already parsed onto each row
    // (parsePFExport) but otherwise unused. See calcKartongPrognos for why
    // this needs its own (higher) confidence floor than the PF-row estimate.
    const kartSett = todayData.rows?.reduce((s, r) => s + (r.labels || 0), 0) ?? 0;
    // Historical average day total for kartonger, from the same days used to
    // build effectiveKurva — the reference blendKvar leans on below the
    // confidence floor instead of returning nothing (see calcKartongPrognos).
    const kartBaselineDays = effectiveKurva.days
      .map(d => d.rows?.reduce((s, r) => s + (r.labels || 0), 0))
      .filter(v => v > 0);
    const kartBaselineTotal = kartBaselineDays.length
      ? kartBaselineDays.reduce((s, v) => s + v, 0) / kartBaselineDays.length
      : null;
    const { estTotal: kartEstTotal, kvar: kartKvar, blended: kartBlended } =
      calcKartongPrognos(andelKlarTotal, kartSett, kartBaselineTotal);

    const tooEarly   = nowHour < 7;
    const morningWarn = !tooEarly && nowHour < 8 && andelKlarTotal < 0.20;

    return {
      sett: total, klartPct,
      totalKvar: totalProg.kvar, totalEst: totalProg.estTotal,
      andelKlar: andelKlarTotal,
      gm:   { sett: perKalla.GM,   kvar: gmProg.kvar,   låg: gmLåg, hög: gmHög, andelKlar: gmProg.andelKlar },
      mezz: { sett: perKalla.Mezz, kvar: mezzProg.kvar, andelKlar: mezzProg.andelKlar },
      ulc:  { sett: perKalla.ULC,  kvar: ulcProg.kvar,  andelKlar: ulcProg.andelKlar },
      pl09: { sett: perKalla.PL09, kvar: pl09Prog.kvar, andelKlar: pl09Prog.andelKlar },
      kartonger: { sett: kartSett, kvar: kartKvar, estTotal: kartEstTotal, blended: kartBlended },
      perTimme,
      tooEarly, morningWarn,
      kurvaTier: effectiveKurva.tier, kurvaN: effectiveKurva.n,
    };
  }, [todayData, nowT, nowHour, effectiveKurva]);

  const todayCheckpoint = todayData ? checkpoints[todayData.datum] : null;

  // Past saved guesses vs. the actual final total, once that day's stored
  // record looks complete (dagenArKomplett) — comparing against a still-
  // partial day would make an accurate guess look like a miss.
  const facit = useMemo(() => {
    const out = [];
    for (const [datum, cp] of Object.entries(checkpoints)) {
      if (datum === todayData?.datum) continue;
      const day = storedDays.find(d => d.datum === datum);
      if (!day || !dagenArKomplett(day)) continue;
      out.push({ datum, ...cp, actual: day.total });
    }
    return out.sort((a, b) => b.datum.localeCompare(a.datum)).slice(0, 8);
  }, [checkpoints, storedDays, todayData]);

  const kbanaAccuracy = computeKbanaAccuracy(checkpoints, storedDays, todayData?.datum);
  const kbanaForecast = useMemo(() => {
    if (!forecast || forecast.tooEarly) return null;

    // Today's already-processed PF (and cartons) per K-bana from uploaded file
    const todayKbMap = {};
    const todayKartMap = {};
    if (todayData?.rows) {
      for (const row of todayData.rows) {
        const kb = classifyLocation(row.toLoc);
        if (kb) {
          todayKbMap[kb] = (todayKbMap[kb] || 0) + 1;
          todayKartMap[kb] = (todayKartMap[kb] || 0) + (row.labels || 0);
        }
      }
    }

    const daysWithRows = storedDays.filter(d =>
      Array.isArray(d.rows) && d.rows.length > 0 && d.datum !== todayData?.datum && dagenArKomplett(d));
    if (!daysWithRows.length) return null;

    const todayWd = new Date().getDay();
    const days = filterVeckodag
      ? daysWithRows.filter(d => new Date(d.datum + "T12:00:00").getDay() === todayWd)
      : daysWithRows;
    if (!days.length) return null;

    // This-month average PF/day per K-bana (excluding today), for the "vs
    // snitt" comparison shown next to each K-bana's estimated total. Kept
    // separate from `days` above (which may be weekday-filtered) — this is
    // always the plain calendar-month average, matching Historik's
    // "månadssnitt" so the two features read consistently.
    const yearMonth = todayData.datum.slice(0, 7);
    const monthDays = storedDays.filter(d =>
      Array.isArray(d.rows) && d.rows.length > 0 && d.datum !== todayData.datum &&
      d.datum?.startsWith(yearMonth) && dagenArKomplett(d));
    const monthSum = {}, monthCount = {};
    for (const day of monthDays) {
      const dayKb = {};
      for (const row of day.rows) {
        const kb = classifyLocation(row.toLoc);
        if (kb) dayKb[kb] = (dayKb[kb] || 0) + 1;
      }
      for (const [kb, n] of Object.entries(dayKb)) {
        monthSum[kb] = (monthSum[kb] || 0) + n;
        monthCount[kb] = (monthCount[kb] || 0) + 1;
      }
    }
    const monthAvgByKb = {};
    for (const kb of Object.keys(monthSum)) {
      if (monthCount[kb] >= MIN_SAMPLES_MANAD) monthAvgByKb[kb] = monthSum[kb] / monthCount[kb];
    }

    // Aggregate per K-bana across historical days
    const hist = {};       // kb → { pf, src, pt:[24] }
    const srcTot = { GM: 0, Mezz: 0, ULC: 0, PL09: 0 };

    for (const day of days) {
      const dayKb = {};
      for (const row of day.rows) {
        const kb = classifyLocation(row.toLoc);
        if (!kb) continue;
        if (!dayKb[kb]) dayKb[kb] = { pf: 0, labels: 0, src: { GM:0,Mezz:0,ULC:0,PL09:0 }, pt: Array(24).fill(0) };
        dayKb[kb].pf++;
        dayKb[kb].labels += row.labels || 0;
        if (row.kalla in dayKb[kb].src) dayKb[kb].src[row.kalla]++;
        if (row.hour >= 0 && row.hour < 24) dayKb[kb].pt[row.hour]++;
      }
      for (const [kb, d] of Object.entries(dayKb)) {
        if (!hist[kb]) hist[kb] = { pf: 0, labels: 0, src: { GM:0,Mezz:0,ULC:0,PL09:0 }, pt: Array(24).fill(0) };
        hist[kb].pf += d.pf;
        hist[kb].labels += d.labels;
        for (const s of ["GM","Mezz","ULC","PL09"]) { hist[kb].src[s] += d.src[s]; srcTot[s] += d.src[s]; }
        d.pt.forEach((v, h) => { hist[kb].pt[h] += v; });
      }
    }

    // Remaining per source from today's prognos. Below KALLA_MIN_ANDEL (see
    // prognosCurve.js) the raw sett/andelKlar guess isn't trusted on its own
    // — blendKvar leans on that källa's historical baseline (from the same
    // days effectiveKurva's curve was built from) instead, so a K-bana still
    // gets a real forecasted-kvar redistributed to it early in the morning
    // rather than 0 ("queue-only") until the källa crosses the floor.
    const srcBaseline = effectiveKurva.kurva.baseline;
    const kvarSrc = {
      GM:   blendKvar(forecast.gm.sett,   forecast.gm.andelKlar,   KALLA_MIN_ANDEL, srcBaseline?.GM),
      Mezz: blendKvar(forecast.mezz.sett, forecast.mezz.andelKlar, KALLA_MIN_ANDEL, srcBaseline?.Mezz),
      ULC:  blendKvar(forecast.ulc.sett,  forecast.ulc.andelKlar,  KALLA_MIN_ANDEL, srcBaseline?.ULC),
      PL09: blendKvar(forecast.pl09.sett, forecast.pl09.andelKlar, KALLA_MIN_ANDEL, srcBaseline?.PL09),
    };

    // Median lead time per K-bana from real Ledtid.jsx observations (Supabase)
    const ledtidKb = {};
    for (const kb of Object.keys(hist)) {
      const times = ledtidObs
        .filter(o => o.kbana === kb)
        .map(o => { const sk = toMin(o.skickad), kl = toMin(o.klar); if (sk==null||kl==null) return null; const d=kl-sk; return d<0?d+1440:d; })
        .filter(v => v != null);
      if (times.length) { const s=[...times].sort((a,b)=>a-b); ledtidKb[kb]=s[Math.floor(s.length/2)]; }
    }

    const result = [];
    for (const [kb, h] of Object.entries(hist)) {
      // Expected remaining PF for this K-bana
      const exp = ["GM","Mezz","ULC","PL09"].reduce((s, src) => {
        return s + kvarSrc[src] * (srcTot[src] > 0 ? h.src[src] / srcTot[src] : 0);
      }, 0);
      if (exp < 1) continue;

      // Future hour shares (hours after now)
      const futPt = h.pt.map((v, hour) => hour >= nowHour ? v : 0);
      const futSum = futPt.reduce((s, v) => s + v, 0);

      // Distribute expected PF across future hours, shifted by lead time
      const shiftH = ledtidKb[kb] ? Math.round(ledtidKb[kb] / 60) : 0;
      const timme = Array(24).fill(0);
      if (futSum > 0) {
        futPt.forEach((v, hour) => {
          if (v > 0) timme[Math.min(23, hour + shiftH)] += Math.round(exp * v / futSum);
        });
      }

      const topp = timme.indexOf(Math.max(...timme));
      const today = todayKbMap[kb] || 0;
      const estTotal = today + Math.round(exp);
      const monthAvg = monthAvgByKb[kb] ?? null;
      const monthDeltaPct = pctDelta(estTotal, monthAvg);
      const vsMonthAvg = monthDeltaPct != null ? Math.round(monthDeltaPct) : null;

      // Expected remaining cartons for this K-bana: this K-bana's expected
      // remaining PF-rows (exp, above) times its own historical labels-per-
      // row ratio. Reuses the already-validated per-kbana `exp` split
      // instead of needing a separate per-källa cartons breakdown. Only
      // trusted once the global kartonger estimate itself is (see
      // calcKartongPrognos's confidence floor) — null otherwise, same as
      // Live.jsx's existing "absent forecast → queue-only" fallback.
      const todayKart = todayKartMap[kb] || 0;
      const kartPerPf = h.pf > 0 ? h.labels / h.pf : 0;
      const expKart = forecast.kartonger.kvar != null ? Math.round(exp * kartPerPf) : null;

      result.push({ kb, exp: Math.round(exp), timme, topp, ledtidMins: ledtidKb[kb] || 0, today, estTotal, monthAvg, vsMonthAvg, todayKart, expKart });
    }

    return result.sort((a, b) => b.estTotal - a.estTotal);
  }, [forecast, nowHour, filterVeckodag, todayData, storedDays, ledtidObs, effectiveKurva]);

  const saveCheckpoint = () => {
    if (!todayData || !forecast) return;
    setCheckpoints(prev => ({
      ...prev,
      [todayData.datum]: {
        mins: now.getHours() * 60 + now.getMinutes(),
        sett: forecast.sett,
        estTotal: forecast.totalEst,
        kartSett: forecast.kartonger.sett,
        kartEstTotal: forecast.kartonger.estTotal,
        byKb: kbanaForecast ? Object.fromEntries(kbanaForecast.map(k => [k.kb, k.estTotal])) : {},
      },
    }));
  };

  // Shares today's per-K-bana expected-remaining with Live.jsx (same
  // app_settings mechanism as prognos_checkpoints) so its Buffert/Saldo can
  // account for volume that hasn't arrived yet, not just what's already in
  // queue. All tabs stay mounted at once (see App.jsx), so this keeps
  // refreshing every minute — via `forecast`, which ticks with `now` — as
  // long as today's PF-export is loaded here, even while looking at Live.
  useEffect(() => {
    if (!kbanaForecast || !todayData) return;
    setSharedKbanaForecast({
      datum: todayData.datum,
      mins: now.getHours() * 60 + now.getMinutes(),
      byKb: Object.fromEntries(kbanaForecast.map(k => [k.kb, k.exp])),
      kartByKb: Object.fromEntries(
        kbanaForecast.filter(k => k.expKart != null).map(k => [k.kb, k.expKart])
      ),
    });
  }, [kbanaForecast, todayData, now, setSharedKbanaForecast]);

  const multiFill = useMemo(() => {
    if (!todayData?.rows) return null;
    const locCount = {};
    for (const row of todayData.rows) {
      if (!row.toLoc) continue;
      const kb = classifyLocation(row.toLoc);
      if (!kb) continue;
      if (!locCount[row.toLoc]) locCount[row.toLoc] = { kb, count: 0, vnrs: new Set(), kallor: new Set() };
      const loc = locCount[row.toLoc];
      loc.count++;
      if (row.vnr) loc.vnrs.add(row.vnr);
      loc.kallor.add(row.kalla);
    }
    const entries = Object.entries(locCount).filter(([, v]) => v.count >= 3);
    if (!entries.length) return null;
    const byKb = {};
    for (const [loc, { kb, count, vnrs, kallor }] of entries) {
      if (!byKb[kb]) byKb[kb] = [];
      byKb[kb].push({ loc, count, vnrs: [...vnrs], kallor: [...kallor] });
    }
    for (const kb of Object.keys(byKb)) byKb[kb].sort((a, b) => b.count - a.count);
    return Object.entries(byKb).sort((a, b) => {
      const sa = a[1].reduce((s, x) => s + x.count, 0);
      const sb = b[1].reduce((s, x) => s + x.count, 0);
      return sb - sa;
    });
  }, [todayData]);

  const veckodagsAvvikelser = useMemo(() => {
    if (!todayData?.rows) return null;
    const todayWd = new Date().getDay();
    const todayKb = perKbanaStats(todayData.rows);

    // Historical days matching today's weekday, excluding today's own date
    const historicalDays = storedDays
      .filter(d => d.datum !== todayData.datum && d.rows?.length > 0 && dagenArKomplett(d))
      .filter(d => new Date(d.datum + "T12:00:00").getDay() === todayWd)
      .map(d => perKbanaStats(d.rows));
    if (historicalDays.length < MIN_SAMPLES) return null;

    const flags = [];
    for (const [kb, today] of Object.entries(todayKb)) {
      // Total volume for this K-bana vs. same weekday historically
      const totals = historicalDays.filter(d => d[kb]).map(d => d[kb].total);
      if (totals.length >= MIN_SAMPLES) {
        const stat = meanStd(totals);
        const floor = Math.max(stat.std, stat.mean * 0.1, 1);
        const z = (today.total - stat.mean) / floor;
        if (Math.abs(z) >= Z_THRESHOLD) {
          flags.push({
            z: Math.abs(z), kb,
            text: `${today.total} PF idag — ovanligt ${z > 0 ? "högt" : "lågt"} för en ${VECKODAGAR[todayWd]}dag (snitt ${stat.mean.toFixed(0)}, ±${stat.std.toFixed(0)}, ${stat.n} dagar)`,
            tone: z > 0 ? C.yellow : C.blue,
          });
        }
      }
      // Källmix vs. same weekday historically — only when today's volume is meaningful
      if (today.total >= 3) {
        for (const src of ["GM", "Mezz", "ULC", "PL09"]) {
          const todayShare = today.kalla[src] / today.total;
          const shares = historicalDays
            .filter(d => d[kb] && d[kb].total >= 3)
            .map(d => d[kb].kalla[src] / d[kb].total);
          if (shares.length < MIN_SAMPLES) continue;
          const stat = meanStd(shares);
          const floor = Math.max(stat.std, 0.05);
          const z = (todayShare - stat.mean) / floor;
          if (Math.abs(z) >= Z_THRESHOLD) {
            flags.push({
              z: Math.abs(z), kb,
              text: `${Math.round(todayShare * 100)}% ${src} idag — ovanligt ${z > 0 ? "högt" : "lågt"} för en ${VECKODAGAR[todayWd]}dag (snitt ${Math.round(stat.mean * 100)}%, ±${Math.round(stat.std * 100)}, ${stat.n} dagar)`,
              tone: z > 0 ? C.yellow : C.blue,
            });
          }
        }
      }
    }

    return flags.sort((a, b) => b.z - a.z).slice(0, 5);
  }, [todayData, storedDays]);

  const tidStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">PROGNOS</div>
          <h1 className="page-title">PF-Inflöde</h1>
          <div className="page-subtitle">Hur mycket PF kommer senare idag, fördelat på källa.</div>
        </div>
        {todayData && (
          <div className="file-meta">
            <div className="file-meta__loaded">
              <label className="file-meta__change">Byt fil
                <input type="file" accept=".xlsx" className="visually-hidden-input"
                  onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
              </label>
            </div>
          </div>
        )}
      </div>

      {err && <Alert>{err}</Alert>}

      {!todayData && (
        <div onDragEnter={() => setDrag(true)} onDragLeave={() => setDrag(false)} onDrop={() => setDrag(false)}>
          <Dropzone icon="P" title="Släpp dagens PF-exportfil här" subtitle="PF-lista .xlsx" dragging={drag} onFile={handleFile} />
        </div>
      )}

      {forecast && (
        <div className="anim-fade-up">
          {/* Status row */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 10, padding: "10px 14px", background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13 }}>
            <span style={{ color: C.text }}>Sett hittills: <strong>{forecast.sett}</strong> PF</span>
            <span style={{ color: C.dim }}>·</span>
            <span style={{ color: C.textDim }}>kl {tidStr}</span>
            <span style={{ color: C.dim }}>·</span>
            <span style={{ color: forecast.klartPct < 20 ? C.red : forecast.klartPct < 60 ? C.yellow : C.green, fontWeight: 700 }}>
              {forecast.klartPct}% av dagen
            </span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: C.dim }}>
              {forecast.kurvaTier === "veckodag" && `${forecast.kurvaN} ${VECKODAGAR[now.getDay()].toLowerCase()}dagar mot självlärande kurva`}
              {forecast.kurvaTier === "poolad" && `${forecast.kurvaN} dagar totalt mot självlärande kurva (för få ${VECKODAGAR[now.getDay()].toLowerCase()}dagar ännu)`}
              {forecast.kurvaTier === "fast" && "Standardkurva (för lite historik ännu)"}
            </span>
          </div>

          {/* Too early */}
          {forecast.tooEarly && (
            <div style={{ padding: "10px 14px", marginBottom: 8, background: C.red + "18", border: `1px solid ${C.red}44`, borderRadius: 8, fontSize: 13, color: C.text }}>
              För tidigt för säker prognos — 90%+ av dagen återstår.
            </div>
          )}

          {/* Morning warning */}
          {forecast.morningWarn && (
            <div style={{ padding: "10px 14px", marginBottom: 8, background: C.yellow + "18", border: `1px solid ${C.yellow}44`, borderRadius: 8, fontSize: 13, color: C.text }}>
              Ser lugnt ut nu, men {100 - forecast.klartPct}% av dagen återstår — tyngsta GM-vågen kommer 10–13.
            </div>
          )}

          {/* Main estimate */}
          {!forecast.tooEarly && forecast.totalKvar != null && (
            <Panel>
              <div style={{ textAlign: "center", padding: "20px 16px 12px" }}>
                <div style={{ fontSize: 11, color: C.dim, letterSpacing: "0.1em", marginBottom: 6 }}>ÅTERSTÅR IDAG (EST.)</div>
                <div style={{ fontSize: 48, fontWeight: 800, color: C.text, lineHeight: 1 }}>~{forecast.totalKvar}</div>
                <div style={{ fontSize: 13, color: C.textDim, marginTop: 4 }}>PF kvar att ta emot</div>
                <div style={{ fontSize: 12, color: C.dim, marginTop: 8 }}>
                  ≈ <strong style={{ color: C.text }}>{forecast.totalEst}</strong> PF totalt idag
                  {forecast.kartonger.estTotal != null && <> · ≈ <strong style={{ color: C.text }}>{forecast.kartonger.estTotal}</strong> kartonger</>}
                </div>
              </div>
              {/* Progress bar */}
              <div style={{ padding: "0 16px 16px" }}>
                <div style={{ height: 10, background: C.border, borderRadius: 5, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${forecast.klartPct}%`, background: C.green, borderRadius: 5, transition: "width 0.5s" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.dim, marginTop: 5 }}>
                  <span style={{ color: C.green }}>{forecast.klartPct}% klart</span>
                  <span>{100 - forecast.klartPct}% kvar</span>
                </div>
              </div>
            </Panel>
          )}

          {/* Spara dagens gissning + facit mot tidigare sparade gissningar */}
          {!forecast.tooEarly && forecast.totalEst != null && (
            <Panel title="GISSNING & TRÄFFSÄKERHET">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "6px 0 14px" }}>
                <div style={{ fontSize: 12, color: C.textDim }}>
                  {todayCheckpoint
                    ? <>Sparad kl {fmtHM(todayCheckpoint.mins)}: <strong style={{ color: C.text }}>~{todayCheckpoint.estTotal} PF</strong> (utifrån {todayCheckpoint.sett} sett)
                        {todayCheckpoint.kartEstTotal != null && <> · ~{todayCheckpoint.kartEstTotal} kartonger</>}</>
                    : <>Spara nuvarande gissning (~{forecast.totalEst} PF, inkl. per K-bana) så du kan se hur den stämde när dagen är slut.</>}
                </div>
                <button
                  onClick={saveCheckpoint}
                  style={{ fontSize: 11, padding: "5px 12px", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap",
                    border: `1px solid ${C.accent}`, background: C.accent + "18", color: C.accent, fontWeight: 700 }}>
                  {todayCheckpoint ? "Uppdatera gissning" : `Spara gissning kl ${tidStr}`}
                </button>
              </div>

              {facit.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>Tidigare sparade gissningar vs. facit:</div>
                  {facit.map(f => {
                    const wd = VECKODAGAR[new Date(f.datum + "T12:00:00").getDay()];
                    const rawPctOff = pctDelta(f.actual, f.estTotal);
                    const pctOff = rawPctOff != null ? Math.round(rawPctOff) : null;
                    return (
                      <div key={f.datum} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12, flexWrap: "wrap" }}>
                        <span style={{ color: C.textDim, flexShrink: 0 }}>{wd} {f.datum.slice(5)} · kl {fmtHM(f.mins)}</span>
                        <span style={{ color: C.text }}>gissade ~{f.estTotal} ({f.sett} sett) → blev <strong>{f.actual}</strong></span>
                        <DeltaChip pct={pctOff} />
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          )}

          {/* Per source */}
          <Panel title="PER KÄLLA (KVAR)">
            <div>
              {/* GM — with range */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                <div>
                  <KallaDot color={KALLA_COLOR.GM} />
                  <span style={{ fontWeight: 700, color: KALLA_COLOR.GM, fontSize: 13 }}>GM</span>
                  <span style={{ fontSize: 11, color: C.dim, marginLeft: 8 }}>Godsmottagning · sett {forecast.gm.sett}</span>
                </div>
                {forecast.gm.kvar != null
                  ? <div style={{ textAlign: "right" }}>
                      <span style={{ fontWeight: 700, color: C.yellow, fontVariantNumeric: "tabular-nums" }}>
                        {forecast.gm.låg}–{forecast.gm.hög}
                      </span>
                      <span style={{ fontSize: 11, color: C.dim, marginLeft: 4 }}>(osäkert)</span>
                    </div>
                  : <span style={{ color: C.dim }}>–</span>}
              </div>

              {[
                { id: "mezz", label: "Mezz",  sett: forecast.mezz.sett, kvar: forecast.mezz.kvar },
                { id: "ulc",  label: "ULC",   sett: forecast.ulc.sett,  kvar: forecast.ulc.kvar },
                { id: "pl09", label: "PL09",  sett: forecast.pl09.sett, kvar: forecast.pl09.kvar },
              ].map(({ id, label, sett, kvar }) => (
                <div key={id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                  <div>
                    <KallaDot color={KALLA_COLOR[label]} />
                    <span style={{ fontWeight: 700, color: KALLA_COLOR[label], fontSize: 13 }}>{label}</span>
                    <span style={{ fontSize: 11, color: C.dim, marginLeft: 8 }}>sett {sett}</span>
                  </div>
                  {kvar != null
                    ? <span style={{ fontWeight: 700, color: C.textDim, fontVariantNumeric: "tabular-nums" }}>~{kvar}</span>
                    : <span style={{ color: C.dim }}>–</span>}
                </div>
              ))}
            </div>
          </Panel>

          {/* Kartonger — labels-kolumnen, egen enhet, inte en "källa" som ovan */}
          {forecast.kartonger.estTotal != null && (
            <Panel title="KARTONGER (LABELS)">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
                <span style={{ fontSize: 11, color: C.dim }}>Sett {forecast.kartonger.sett}</span>
                <span style={{ fontWeight: 700, color: C.textDim, fontVariantNumeric: "tabular-nums" }}>
                  ~{forecast.kartonger.kvar} kvar · ≈{forecast.kartonger.estTotal} totalt
                  {forecast.kartonger.blended && (
                    <span style={{ fontSize: 11, color: C.dim, fontWeight: 400, marginLeft: 4 }}>(tidig gissning)</span>
                  )}
                </span>
              </div>
            </Panel>
          )}

          {/* Hourly distribution chart */}
          <Panel title="INFLÖDE PER TIMME (IDAG)">
            <div style={{ padding: "8px 0" }}>
              <HourBar perTimme={forecast.perTimme} highlight={[10, 13]} />
              <div style={{ fontSize: 11, color: C.dim, marginTop: 4, textAlign: "center" }}>
                Markerat kl 10–13: GM-toppvågen
              </div>
            </div>
          </Panel>

          {/* Per K-bana forecast */}
          {kbanaForecast?.length > 0 && (
            <Panel title="PROGNOS PER K-BANA">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 11, color: C.dim }}>
                  Sett idag + estimerat kvar = dagstotal{kbanaForecast.some(k => k.ledtidMins > 0) ? " · förskjutet med ledtid" : ""}
                </span>
                <button
                  onClick={() => setFilterVeckodag(v => !v)}
                  style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, cursor: "pointer",
                    border: `1px solid ${filterVeckodag ? C.accent : C.border}`,
                    background: filterVeckodag ? C.accent + "22" : "transparent",
                    color: filterVeckodag ? C.accent : C.textDim }}>
                  {VECKODAGAR[new Date().getDay()]}dagar
                </button>
              </div>
              {kbanaForecast.map(k => (
                <div key={k.kb} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{k.kb}</span>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 11 }}>
                      {k.ledtidMins > 0 && <span style={{ color: C.dim }}>+{k.ledtidMins}min</span>}
                      {k.timme[k.topp] > 0 && <span style={{ color: C.textDim }}>topp kl {k.topp}</span>}
                      {k.today > 0 && (
                        <span style={{ color: C.dim, fontVariantNumeric: "tabular-nums" }}>
                          {k.today} sett + ~{k.exp} kvar
                        </span>
                      )}
                      {k.expKart != null && k.expKart > 0 && (
                        <span style={{ color: C.dim, fontVariantNumeric: "tabular-nums" }}>
                          · ~{k.expKart} kartonger kvar
                        </span>
                      )}
                      <span style={{ fontWeight: 700, color: C.accent, fontVariantNumeric: "tabular-nums" }}>
                        ~{k.estTotal > 0 ? k.estTotal : k.exp} tot
                      </span>
                      {k.monthAvg != null && (
                        <DeltaChip pct={k.vsMonthAvg} label={`vs snitt ${Math.round(k.monthAvg)}`} />
                      )}
                      {kbanaAccuracy[k.kb] && (
                        <AccuracyChip avgOff={kbanaAccuracy[k.kb].avgOff} n={kbanaAccuracy[k.kb].n} />
                      )}
                    </div>
                  </div>
                  <HourBar perTimme={k.timme} highlight={k.timme[k.topp] > 0 ? [k.topp, k.topp] : null} />
                </div>
              ))}
            </Panel>
          )}

          {/* Avvikelser mot samma veckodags historiska mönster */}
          {veckodagsAvvikelser?.length > 0 && (
            <Panel title="AVVIKELSER MOT VECKODAGSMÖNSTER">
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 12 }}>
                Källmix och volym idag jämfört med tidigare {VECKODAGAR[new Date().getDay()].toLowerCase()}dagar.
              </div>
              {veckodagsAvvikelser.map((a, i) => (
                <div key={i} style={{ display: "flex", gap: 8, padding: "8px 0", borderBottom: i < veckodagsAvvikelser.length - 1 ? `1px solid ${C.border}` : "none" }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: C.text, flexShrink: 0 }}>{a.kb}</span>
                  <span style={{ fontSize: 12, color: a.tone }}>{a.text}</span>
                </div>
              ))}
            </Panel>
          )}

          {/* Multi-fill: platser som fyllts på 3+ ggr idag */}
          {multiFill?.length > 0 && (
            <Panel title="PLATSER MED MÅNGA PF IDAG">
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 12 }}>
                Platser som tagit emot 3 eller fler PF hittills idag — kan indikera hög efterfrågan.
              </div>
              {multiFill.map(([kb, items]) => (
                <div key={kb} style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 6 }}>{kb}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {items.map(({ loc, count, vnrs, kallor }) => (
                      <div key={loc} style={{
                        padding: "4px 10px", borderRadius: 5, fontSize: 11,
                        background: count >= 5 ? C.red + "22" : C.yellow + "22",
                        border: `1px solid ${count >= 5 ? C.red + "44" : C.yellow + "44"}`,
                        color: C.text,
                      }}>
                        <div>
                          {loc}{" "}
                          <strong style={{ color: count >= 5 ? C.red : C.yellow }}>×{count}</strong>
                        </div>
                        {(vnrs.length > 0 || kallor.length > 0) && (
                          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, fontSize: 10, color: C.dim, marginTop: 3 }}>
                            {vnrs.length > 0 && <span>VNR {vnrs.join(", ")}</span>}
                            {kallor.map(k => (
                              <span key={k} style={{ display: "inline-flex", alignItems: "center", color: KALLA_COLOR[k] || C.dim, fontWeight: 700 }}>
                                <KallaDot color={KALLA_COLOR[k] || C.dim} />{k}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
