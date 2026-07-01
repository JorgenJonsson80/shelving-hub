import { useState, useEffect, useMemo } from "react";
import { C } from "../shared/theme";
import { Alert, Dropzone, Panel } from "../shared/components";
import { parsePFExport } from "../shared/parsers";
import { classifyLocation } from "../shared/liveUtils";

function toMin(str) {
  if (!str) return null;
  const [h, m] = String(str).split(":").map(Number);
  return isNaN(h) ? null : h * 60 + (m || 0);
}

// Empirical cumulative curve — 9 days of data (5–25 Jun 2026, 15 033 rows)
// Index 0 = pct done by end of hour 5, index 11 = end of hour 16
const KURVA = {
  timmar: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  GM:    [ 0,  2, 14, 27, 44, 55, 63, 74, 81, 91, 97, 98],
  Mezz:  [11, 16, 29, 42, 44, 55, 69, 80, 87, 96, 98, 99],
  ULC:   [ 7, 14, 28, 45, 46, 57, 71, 83, 90, 98, 99,100],
  PL09:  [ 9, 16, 28, 45, 48, 59, 72, 81, 88, 96, 99, 99],
  TOTAL: [ 3,  7, 19, 33, 44, 56, 66, 77, 84, 93, 97, 99],
};

function getAndelKlar(kalla, nowHour) {
  const idx = KURVA.timmar.findIndex(h => h >= nowHour);
  if (idx === -1) return 1.0;
  return (KURVA[kalla]?.[idx] ?? 100) / 100;
}

function calcPrognos(kalla, sett, nowHour) {
  const andelKlar = getAndelKlar(kalla, nowHour);
  if (andelKlar <= 0) return { estTotal: null, kvar: null, osäkert: true, andelKlar: 0 };
  const estTotal = sett / andelKlar;
  const kvar = Math.max(0, estTotal - sett);
  return { estTotal: Math.round(estTotal), kvar: Math.round(kvar), andelKlar };
}

function lsGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
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
  const [storedDays, setStoredDays] = useState(() => lsGet("prognos_days_v1", []));
  const [filterVeckodag, setFilterVeckodag] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const nowHour = now.getHours();

  const handleFile = (f) => {
    setErr(null);
    parsePFExport(f).then(days => {
      if (!days.length) { setErr("Inga rader hittades i filen."); return; }
      const best = [...days].sort((a, b) => b.total - a.total)[0];
      setTodayData(best);
      // Store for self-learning counter (last 90 completed days)
      setStoredDays(prev => {
        if (prev.some(d => d.datum === best.datum)) return prev;
        const next = [...prev, { datum: best.datum, total: best.total, perKalla: best.perKalla }].slice(-90);
        try { localStorage.setItem("prognos_days_v1", JSON.stringify(next)); } catch {}
        return next;
      });
    }).catch(e => setErr(e.message));
  };

  const forecast = useMemo(() => {
    if (!todayData) return null;
    const { perKalla, total, perTimme } = todayData;

    const totalProg = calcPrognos("TOTAL", total, nowHour);
    const andelKlarTotal = getAndelKlar("TOTAL", nowHour);
    const klartPct = Math.round(andelKlarTotal * 100);

    const gmProg   = calcPrognos("GM",   perKalla.GM,   nowHour);
    const mezzProg = calcPrognos("Mezz", perKalla.Mezz, nowHour);
    const ulcProg  = calcPrognos("ULC",  perKalla.ULC,  nowHour);
    const pl09Prog = calcPrognos("PL09", perKalla.PL09, nowHour);

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
      daysCount: storedDays.length,
    };
  }, [todayData, nowHour, storedDays]);

  const kbanaForecast = useMemo(() => {
    if (!forecast || forecast.tooEarly) return null;

    const pafyllDays = lsGet("pafyll_days_v1", []);
    const daysWithRows = pafyllDays.filter(d => Array.isArray(d.rows) && d.rows.length > 0);
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
      result.push({ kb, exp: Math.round(exp), timme, topp, ledtidMins: ledtidKb[kb] || 0 });
    }

    return result.sort((a, b) => b.exp - a.exp);
  }, [forecast, nowHour, filterVeckodag]);

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
              {forecast.daysCount}/30 dagar mot självlärande kurva
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
                  Baserat på historiska mönster{kbanaForecast.some(k => k.ledtidMins > 0) ? " · förskjutet med ledtid" : ""}
                </span>
                <button
                  onClick={() => setFilterVeckodag(v => !v)}
                  style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, cursor: "pointer",
                    border: `1px solid ${filterVeckodag ? C.accent : C.border}`,
                    background: filterVeckodag ? C.accent + "22" : "transparent",
                    color: filterVeckodag ? C.accent : C.textDim }}>
                  {["Sön","Mån","Tis","Ons","Tor","Fre","Lör"][new Date().getDay()]}dagar
                </button>
              </div>
              {kbanaForecast.map(k => (
                <div key={k.kb} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{k.kb}</span>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 11 }}>
                      {k.ledtidMins > 0 && <span style={{ color: C.dim }}>+{k.ledtidMins}min ledtid</span>}
                      {k.timme[k.topp] > 0 && <span style={{ color: C.textDim }}>topp kl {k.topp}</span>}
                      <span style={{ fontWeight: 700, color: C.text, fontVariantNumeric: "tabular-nums" }}>~{k.exp} PF</span>
                    </div>
                  </div>
                  <HourBar perTimme={k.timme} highlight={k.timme[k.topp] > 0 ? [k.topp, k.topp] : null} />
                </div>
              ))}
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
