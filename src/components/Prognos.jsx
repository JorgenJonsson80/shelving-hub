import { useState, useEffect, useMemo } from "react";
import { C } from "../shared/theme";
import { Alert, Dropzone, Panel } from "../shared/components";
import { parsePFExport } from "../shared/parsers";
import { classifyLocation } from "../shared/liveUtils";
import { fetchPfDays, upsertPfDay } from "../shared/pfDaysDb";

function toMin(str) {
  if (!str) return null;
  const [h, m] = String(str).split(":").map(Number);
  return isNaN(h) ? null : h * 60 + (m || 0);
}

// Fallback empirical cumulative curve — 9 days of data (5–25 Jun 2026, 15 033
// rows), used only when there isn't enough stored history yet to build one
// from real data (see buildEmpiriskKurva / effectiveKurva below).
// Index 0 = pct done by end of hour 5, index 11 = end of hour 16
const KURVA = {
  timmar: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  GM:    [ 0,  2, 14, 27, 44, 55, 63, 74, 81, 91, 97, 98],
  Mezz:  [11, 16, 29, 42, 44, 55, 69, 80, 87, 96, 98, 99],
  ULC:   [ 7, 14, 28, 45, 46, 57, 71, 83, 90, 98, 99,100],
  PL09:  [ 9, 16, 28, 45, 48, 59, 72, 81, 88, 96, 99, 99],
  TOTAL: [ 3,  7, 19, 33, 44, 56, 66, 77, 84, 93, 97, 99],
};

const MIN_SAMPLES_VECKODAG = 5;
const MIN_SAMPLES_POOLAD = 5;

// A stored day only tells the truth about "how much of a normal day is done
// by hour X" if the file behind it was captured near end of day. A file
// uploaded mid-morning (from either this tab or Påfyllningsmönster, which
// shares the same pf_days table) still gets saved under that date — its
// "total" is just whatever had arrived by then, not the real day total.
// Left untreated, such a day looks like "100% done by 08:00" once it becomes
// history, which drags the learned curve's early hours up and makes later
// forecasts (estTotal = sett / andelKlar) come out far too low. Require data
// late in the day before trusting a stored day as a real reference point.
const DAGEN_KOMPLETT_TIMME = 16;
function dagenArKomplett(day) {
  return Array.isArray(day.perTimme) && day.perTimme.slice(DAGEN_KOMPLETT_TIMME).some(v => v > 0);
}

// Builds a KURVA-shaped object from real stored days instead of the
// hardcoded fallback. Falls back per-source (not per-curve) to KURVA's
// values when a source has no usable data across the given days at all
// (e.g. a day where PL09 was 0) — keeps the rest of the curve real.
function buildEmpiriskKurva(days) {
  const timmar = KURVA.timmar;
  const sources = ["GM", "Mezz", "ULC", "PL09", "TOTAL"];
  const out = { timmar };
  for (const src of sources) {
    const perBucket = timmar.map(() => []);
    for (const day of days) {
      const total  = src === "TOTAL" ? day.total   : day.perKalla?.[src];
      const hourly = src === "TOTAL" ? day.perTimme : day.perTimmeKalla?.[src];
      if (!total || !hourly) continue;
      let cum = 0;
      const cumByHour = hourly.map(v => (cum += v));
      timmar.forEach((h, i) => perBucket[i].push((cumByHour[h] / total) * 100));
    }
    out[src] = perBucket.map((arr, i) =>
      arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : KURVA[src][i]
    );
  }
  return out;
}

function getAndelKlar(kurva, kalla, nowHour) {
  const idx = kurva.timmar.findIndex(h => h >= nowHour);
  if (idx === -1) return 1.0;
  return (kurva[kalla]?.[idx] ?? 100) / 100;
}

function calcPrognos(kurva, kalla, sett, nowHour) {
  const andelKlar = getAndelKlar(kurva, kalla, nowHour);
  if (andelKlar <= 0) return { estTotal: null, kvar: null, osäkert: true, andelKlar: 0 };
  const estTotal = sett / andelKlar;
  const kvar = Math.max(0, estTotal - sett);
  return { estTotal: Math.round(estTotal), kvar: Math.round(kvar), andelKlar };
}

function lsGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}

const VECKODAGAR = ["Sön","Mån","Tis","Ons","Tor","Fre","Lör"];

function meanStd(values) {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance), n };
}

const MIN_SAMPLES = 4;
const Z_THRESHOLD = 2;

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

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    fetchPfDays().then(setStoredDays).catch(e => setErr(e.message));
  }, []);

  const nowHour = now.getHours();

  const effectiveKurva = useMemo(() => {
    const todayWd = now.getDay();
    const history = storedDays.filter(d => d.rows?.length > 0 && d.datum !== todayData?.datum && dagenArKomplett(d));
    const veckodagDays = history.filter(d => new Date(d.datum + "T12:00:00").getDay() === todayWd);

    if (veckodagDays.length >= MIN_SAMPLES_VECKODAG) {
      return { kurva: buildEmpiriskKurva(veckodagDays), tier: "veckodag", n: veckodagDays.length };
    }
    if (history.length >= MIN_SAMPLES_POOLAD) {
      return { kurva: buildEmpiriskKurva(history), tier: "poolad", n: history.length };
    }
    return { kurva: KURVA, tier: "fast", n: 0 };
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

    const totalProg = calcPrognos(kurva, "TOTAL", total, nowHour);
    const andelKlarTotal = getAndelKlar(kurva, "TOTAL", nowHour);
    const klartPct = Math.round(andelKlarTotal * 100);

    const gmProg   = calcPrognos(kurva, "GM",   perKalla.GM,   nowHour);
    const mezzProg = calcPrognos(kurva, "Mezz", perKalla.Mezz, nowHour);
    const ulcProg  = calcPrognos(kurva, "ULC",  perKalla.ULC,  nowHour);
    const pl09Prog = calcPrognos(kurva, "PL09", perKalla.PL09, nowHour);

    const gmLåg = gmProg.kvar != null ? Math.round(gmProg.kvar * 0.75) : null;
    const gmHög = gmProg.kvar != null ? Math.round(gmProg.kvar * 1.25) : null;

    const tooEarly   = nowHour < 7;
    const morningWarn = !tooEarly && nowHour < 8 && andelKlarTotal < 0.20;

    return {
      sett: total, klartPct,
      totalKvar: totalProg.kvar, totalEst: totalProg.estTotal,
      andelKlar: andelKlarTotal,
      gm:   { sett: perKalla.GM,   kvar: gmProg.kvar,   låg: gmLåg, hög: gmHög },
      mezz: { sett: perKalla.Mezz, kvar: mezzProg.kvar },
      ulc:  { sett: perKalla.ULC,  kvar: ulcProg.kvar },
      pl09: { sett: perKalla.PL09, kvar: pl09Prog.kvar },
      perTimme,
      tooEarly, morningWarn,
      kurvaTier: effectiveKurva.tier, kurvaN: effectiveKurva.n,
    };
  }, [todayData, nowHour, effectiveKurva]);

  const kbanaForecast = useMemo(() => {
    if (!forecast || forecast.tooEarly) return null;

    // Today's already-processed PF per K-bana from uploaded file
    const todayKbMap = {};
    if (todayData?.rows) {
      for (const row of todayData.rows) {
        const kb = classifyLocation(row.toLoc);
        if (kb) todayKbMap[kb] = (todayKbMap[kb] || 0) + 1;
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

    // Aggregate per K-bana across historical days
    const hist = {};       // kb → { pf, src, pt:[24] }
    const srcTot = { GM: 0, Mezz: 0, ULC: 0, PL09: 0 };

    for (const day of days) {
      const dayKb = {};
      for (const row of day.rows) {
        const kb = classifyLocation(row.toLoc);
        if (!kb) continue;
        if (!dayKb[kb]) dayKb[kb] = { pf: 0, src: { GM:0,Mezz:0,ULC:0,PL09:0 }, pt: Array(24).fill(0) };
        dayKb[kb].pf++;
        if (row.kalla in dayKb[kb].src) dayKb[kb].src[row.kalla]++;
        if (row.hour >= 0 && row.hour < 24) dayKb[kb].pt[row.hour]++;
      }
      for (const [kb, d] of Object.entries(dayKb)) {
        if (!hist[kb]) hist[kb] = { pf: 0, src: { GM:0,Mezz:0,ULC:0,PL09:0 }, pt: Array(24).fill(0) };
        hist[kb].pf += d.pf;
        for (const s of ["GM","Mezz","ULC","PL09"]) { hist[kb].src[s] += d.src[s]; srcTot[s] += d.src[s]; }
        d.pt.forEach((v, h) => { hist[kb].pt[h] += v; });
      }
    }

    // Remaining per source from today's prognos
    const kvarSrc = {
      GM:   forecast.gm.kvar   ?? 0,
      Mezz: forecast.mezz.kvar ?? 0,
      ULC:  forecast.ulc.kvar  ?? 0,
      PL09: forecast.pl09.kvar ?? 0,
    };

    // Median lead time per K-bana from ledtid_obs_v1
    const ledtidObs = lsGet("ledtid_obs_v1", []);
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
      result.push({ kb, exp: Math.round(exp), timme, topp, ledtidMins: ledtidKb[kb] || 0, today, estTotal: today + Math.round(exp) });
    }

    return result.sort((a, b) => b.estTotal - a.estTotal);
  }, [forecast, nowHour, filterVeckodag, todayData, storedDays]);

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

          {/* Per source */}
          <Panel title="PER KÄLLA (KVAR)">
            <div>
              {/* GM — with range */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                <div>
                  <span style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>GM</span>
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
                    <span style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{label}</span>
                    <span style={{ fontSize: 11, color: C.dim, marginLeft: 8 }}>sett {sett}</span>
                  </div>
                  {kvar != null
                    ? <span style={{ fontWeight: 700, color: C.textDim, fontVariantNumeric: "tabular-nums" }}>~{kvar}</span>
                    : <span style={{ color: C.dim }}>–</span>}
                </div>
              ))}
            </div>
          </Panel>

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
                      <span style={{ fontWeight: 700, color: C.accent, fontVariantNumeric: "tabular-nums" }}>
                        ~{k.estTotal > 0 ? k.estTotal : k.exp} tot
                      </span>
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
                          <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>
                            {vnrs.length > 0 && <>VNR {vnrs.join(", ")}</>}
                            {vnrs.length > 0 && kallor.length > 0 && " · "}
                            {kallor.join(", ")}
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
