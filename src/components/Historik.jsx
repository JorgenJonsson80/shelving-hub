import { useState, useMemo, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";
import { C } from "../shared/theme";
import { supabase } from "../shared/supabaseClient";
import { invalidateHistorikDaysCache } from "../shared/kbanaNormals";
import {
  ActionButton,
  BedomingPill,
  DataTable,
  DeltaChip,
  GapChip,
  MetricCard,
  MetricGrid,
  Panel,
  PrestBar,
} from "../shared/components";
import { parseDailyRows } from "../shared/parseDailyRows";
import { pctDelta, rekommenderadBemanning, rekommenderadBemanningBreakdown } from "../shared/liveUtils";
import { useSetting } from "../shared/useSetting";

// Fixed categorical colors for the bemanning-breakdown bars — kept separate
// from green/red since those already mean "över/under bemannat" elsewhere
// in this same tab (SnitTabell/DagTabell's REK. BEM. column).
const BEMANNING_COLOR = { kolli: C.blue, kart: C.yellow, pall: C.accent };

const KBANA_ORDER = ["K51","K52","K53","K55","K56","K58","K59","K60","K61-7","K62","K63"];
// Old localStorage key — no longer written to, only read once for the
// one-time "import my local history into Supabase" migration button.
const LEGACY_STORAGE_KEY = "shelving_history_v2";
const MONTHS_SV = ["Januari","Februari","Mars","April","Maj","Juni","Juli","Augusti","September","Oktober","November","December"];
const MONTHS_SHORT = ["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];

function loadLegacyLocalHistory() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function rowToDay(row) {
  return { dateStr: row.date_str, fileName: row.file_name, rows: row.rows, summary: row.summary };
}

async function fetchHistory() {
  const { data, error } = await supabase.from("historik_days").select("*").order("date_str");
  if (error) throw error;
  const h = {};
  for (const row of data) {
    const m = row.date_str.substring(0, 7);
    if (!h[m]) h[m] = {};
    h[m][row.date_str] = rowToDay(row);
  }
  return h;
}

async function upsertDay(d) {
  const { error } = await supabase.from("historik_days").upsert({
    date_str: d.dateStr,
    file_name: d.fileName,
    rows: d.rows,
    summary: d.summary,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  invalidateHistorikDaysCache();
}

async function deleteDay(dateStr) {
  const { error } = await supabase.from("historik_days").delete().eq("date_str", dateStr);
  if (error) throw error;
  invalidateHistorikDaysCache();
}

async function deleteAllDays() {
  const { error } = await supabase.from("historik_days").delete().not("date_str", "is", null);
  if (error) throw error;
  invalidateHistorikDaysCache();
}

function getLatestSelection(h) {
  const months = Object.keys(h).sort();
  if (!months.length) return { month: null, day: null };
  const month = months[months.length - 1];
  const days = Object.keys(h[month]).sort();
  return { month, day: days[days.length - 1] || null };
}

// "YYYY-MM" shifted by `delta` calendar months (delta may be negative).
function shiftMonthKey(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

// Per-K-bana averages (kolli/kart/pall/pers/prest/gap) across a list of day
// objects ({ rows: [...] }). Shared by the current-month, previous-month and
// all-time aggregations in Historik so the three stay in sync.
function aggregateKbanaRows(days, kringuppgifterPct = 0) {
  const byK = {};
  for (const d of days) {
    for (const r of d.rows) {
      if (!byK[r.kbana]) byK[r.kbana] = { pa: [], ga: [], ko: 0, ka: 0, pall: 0, pers: 0, n: 0 };
      const b = byK[r.kbana];
      if (r.prest) b.pa.push(r.prest);
      b.ga.push(r.gap);
      b.ko += r.kolli;
      b.ka += r.kart;
      b.pall += r.helpall || 0;
      b.pers += r.pers || 0;
      b.n++;
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(byK)) {
    const ko = v.n ? v.ko / v.n : 0;
    const ka = v.n ? v.ka / v.n : 0;
    const pall = v.n ? v.pall / v.n : 0;
    const pers = v.n ? v.pers / v.n : 0;
    out[k] = {
      kbana: k,
      prest: v.pa.length ? v.pa.reduce((a, b) => a + b) / v.pa.length : 0,
      gap: v.ga.reduce((a, b) => a + b) / v.ga.length,
      ko, ka, pall, pers,
      rekBem: rekommenderadBemanning(k, ko, ka, pall, undefined, kringuppgifterPct),
      n: v.n,
    };
  }
  return out;
}

// Warehouse-wide daily totals (summed across every K-bana, then averaged per
// day) — the same "vs föregående månad / vs totalt" idea as SnitCell below,
// just one level up from per-K-bana to a single headline figure.
function aggregateTotals(days) {
  let kolli = 0, kart = 0, pall = 0, pers = 0;
  for (const d of days) {
    for (const r of d.rows) {
      kolli += r.kolli;
      kart += r.kart;
      pall += r.helpall || 0;
      pers += r.pers || 0;
    }
  }
  const n = days.length || 1;
  return { kolli: kolli / n, kart: kart / n, pall: pall / n, pers: pers / n, n: days.length };
}

function parseDailyFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets["Daily"];
        if (!sheet) throw new Error("Ingen Daily-flik");
        const raw = XLSX.utils.sheet_to_json(sheet, { defval: "", header: 1 });

        let dateStr = "";
        const nm = file.name.match(/(\d+)[_\s]?(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)/i);
        if (nm) {
          const ms = { jan:1,feb:2,mar:3,apr:4,maj:5,jun:6,jul:7,aug:8,sep:9,okt:10,nov:11,dec:12 };
          const y = new Date().getFullYear();
          const m = ms[nm[2].toLowerCase()];
          const d = parseInt(nm[1], 10);
          dateStr = y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
        } else {
          dateStr = file.name.replace(/\.[^/.]+$/, "").slice(-10);
        }

        const kbanaRows = parseDailyRows(raw);
        const n = kbanaRows.length || 1;
        resolve({
          dateStr,
          fileName: file.name,
          rows: kbanaRows,
          summary: {
            pers:  kbanaRows.reduce((s, r) => s + r.pers,  0),
            kolli: kbanaRows.reduce((s, r) => s + r.kolli, 0),
            kart:  kbanaRows.reduce((s, r) => s + r.kart,  0),
            gap:   kbanaRows.reduce((s, r) => s + r.gap,   0),
            prest: kbanaRows.reduce((s, r) => s + r.prest, 0) / n,
          },
        });
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function Sparkline({ values, color, w = 80, h = 28 }) {
  if (!values || values.length < 2) return <span style={{ display: "inline-block", width: w, height: h }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    h - 2 - ((v - min) / range) * (h - 4),
  ]);
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={w} height={h} style={{ overflow: "visible", flexShrink: 0 }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="2.5" fill={color} />
    </svg>
  );
}

function TrendView({ history, selMonth, monthDays }) {
  const trends = useMemo(() => {
    if (!selMonth || !history[selMonth]) return [];
    const byK = {};
    for (const day of monthDays) {
      const d = history[selMonth]?.[day];
      if (!d) continue;
      for (const r of d.rows) {
        if (!byK[r.kbana]) byK[r.kbana] = { prest: [], gap: [] };
        byK[r.kbana].prest.push(r.prest);
        byK[r.kbana].gap.push(r.gap);
      }
    }
    return KBANA_ORDER.filter(k => byK[k]).map(k => ({ kbana: k, ...byK[k] }));
  }, [history, selMonth, monthDays]);

  if (!trends.length) return null;

  return (
    <div className="anim-fade-up trend-grid">
      {trends.map(k => {
        const latestPrest = k.prest[k.prest.length - 1];
        const latestGap   = k.gap[k.gap.length - 1];
        const prestColor  = latestPrest < 1 ? C.green : C.red;
        const gapColor    = latestGap > 0.5 ? C.green : latestGap < -0.5 ? C.red : C.yellow;
        return (
          <div key={k.kbana} className="section-card">
            <div className="section-card__header">{k.kbana}</div>
            <div className="section-card__body">
              <div className="trend-metric">
                <span className="trend-metric__label">PREST</span>
                <Sparkline values={k.prest} color={prestColor} />
                <span className="trend-metric__value" style={{ color: prestColor }}>
                  {Math.round(latestPrest * 100)}%
                </span>
              </div>
              <div className="trend-metric">
                <span className="trend-metric__label">GAP</span>
                <Sparkline values={k.gap} color={gapColor} />
                <span className="trend-metric__value" style={{ color: gapColor }}>
                  {latestGap > 0 ? "+" : ""}{latestGap.toFixed(1)}h
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DagTabell({ rows, kringuppgifterPct }) {
  return (
    <DataTable headers={[
      "BANA",
      { label: "PERS", align: "right" },
      { label: "REK. BEM.", align: "right" },
      { label: "KOLLI", align: "right" },
      { label: "KART", align: "right" },
      { label: "PALL", align: "right" },
      { label: "PREST", align: "right" },
      { label: "GAP", align: "right" },
      { label: "SCAN", align: "right" },
      { label: "BEDÖMNING", align: "right" },
    ]}>
          {KBANA_ORDER.map(k => {
            const r = rows.find(x => x.kbana === k);
            if (!r) return null;
            const scanPct = r.scannat != null ? Math.round(r.scannat * 100) : null;
            const scanColor = scanPct == null ? C.dim : scanPct < 20 ? C.dim : scanPct < 60 ? C.red : scanPct < 75 ? C.yellow : C.green;
            const rekBem = rekommenderadBemanning(r.kbana, r.kolli, r.kart, r.helpall, undefined, kringuppgifterPct);
            const rekColor = r.pers >= rekBem ? C.green : r.pers >= rekBem * 0.9 ? C.yellow : C.red;
            return (
              <tr key={k}>
                <td className="primary-cell">{r.kbana}</td>
                <td className="is-right mono-cell" style={{ color: C.textDim }}>{r.pers}</td>
                <td className="is-right mono-cell" style={{ color: rekColor, fontWeight: 700 }}>{rekBem.toFixed(1)}</td>
                <td className="is-right mono-cell">{r.kolli}</td>
                <td className="is-right mono-cell">{r.kart}</td>
                <td className="is-right mono-cell">{r.helpall}</td>
                <td className="is-right"><PrestBar prest={r.prest} /></td>
                <td className="is-right"><GapChip gap={r.gap} /></td>
                <td className="is-right mono-cell" style={{ color: scanColor, fontWeight: scanPct !== null && scanPct < 75 ? 700 : 400 }}>
                  {scanPct != null ? scanPct + "%" : "-"}
                </td>
                <td className="is-right"><BedomingPill text={r.bedoming} /></td>
              </tr>
            );
          })}
    </DataTable>
  );
}

// Value + small "vs föregående månad / vs totalt" delta chips underneath —
// used for the volume columns (KOLLI/KART/PALL) where a bare average hides
// whether today's month is unusually high or low.
function SnitCell({ value, prevVal, totalVal, prevLabel }) {
  const pctPrev = pctDelta(value, prevVal);
  const pctTotal = pctDelta(value, totalVal);
  return (
    <td className="is-right mono-cell">
      <div>{Math.round(value)}</div>
      {(pctPrev != null || pctTotal != null) && (
        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", marginTop: 3, flexWrap: "wrap" }}>
          {pctPrev != null && <DeltaChip pct={pctPrev} label={`vs ${prevLabel}`} />}
          {pctTotal != null && <DeltaChip pct={pctTotal} label="vs totalt" />}
        </div>
      )}
    </td>
  );
}

function SnitTabell({ agg, prevAgg, prevLabel, totalAgg }) {
  return (
    <DataTable headers={[
      "BANA",
      { label: "DAGAR", align: "right" },
      { label: "SNITT PERS", align: "right" },
      { label: "SNITT REK. BEM.", align: "right" },
      { label: "SNITT KOLLI", align: "right" },
      { label: "SNITT KART", align: "right" },
      { label: "SNITT PALL", align: "right" },
      { label: "SNITT PREST", align: "right" },
      { label: "SNITT GAP", align: "right" },
    ]}>
          {KBANA_ORDER.map(k => {
            const r = agg[k];
            if (!r) return null;
            const prev = prevAgg?.[k];
            const tot = totalAgg?.[k];
            const rekColor = r.pers >= r.rekBem ? C.green : r.pers >= r.rekBem * 0.9 ? C.yellow : C.red;
            return (
              <tr key={k}>
                <td className="primary-cell">{r.kbana}</td>
                <td className="is-right mono-cell" style={{ color: C.dim }}>{r.n}</td>
                <td className="is-right mono-cell" style={{ color: C.textDim }}>{r.pers.toFixed(1)}</td>
                <td className="is-right mono-cell" style={{ color: rekColor, fontWeight: 700 }}>{r.rekBem.toFixed(1)}</td>
                <SnitCell value={r.ko}   prevVal={prev?.ko}   totalVal={tot?.ko}   prevLabel={prevLabel} />
                <SnitCell value={r.ka}   prevVal={prev?.ka}   totalVal={tot?.ka}   prevLabel={prevLabel} />
                <SnitCell value={r.pall} prevVal={prev?.pall} totalVal={tot?.pall} prevLabel={prevLabel} />
                <td className="is-right"><PrestBar prest={r.prest} /></td>
                <td className="is-right"><GapChip gap={r.gap} /></td>
              </tr>
            );
          })}
    </DataTable>
  );
}

function BemanningLegend() {
  const items = [
    ["kolli", "Kolli"],
    ["kart", "Kartong"],
    ["pall", "Pall"],
  ];
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 11, color: C.dim, marginBottom: 14 }}>
      {items.map(([k, l]) => (
        <span key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: BEMANNING_COLOR[k], display: "inline-block" }} />
          {l}
        </span>
      ))}
      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: 2, height: 10, background: C.white, display: "inline-block", borderRadius: 1 }} />
        Faktiskt bemannat (snitt)
      </span>
    </div>
  );
}

// Horizontal stacked bar: length = rekommenderad bemanning (scaled against
// the shared `max` across all K-banor in the current view, so bars stay
// comparable), segments = kolli/kart/pall's respective person-contribution.
// A thin vertical tick marks the actual average bemanning for comparison.
function RekBemBar({ breakdown, actual, max, width = 200 }) {
  const { kolliPers, kartPers, pallPers, total } = breakdown;
  const barWidth = max > 0 ? (total / max) * width : 0;
  const actualX = actual != null && max > 0 ? Math.min(width, (actual / max) * width) : null;
  const segs = [
    { key: "kolli", label: "Kolli", val: kolliPers },
    { key: "kart", label: "Kartong", val: kartPers },
    { key: "pall", label: "Pall", val: pallPers },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ position: "relative", width, height: 14, background: C.border, borderRadius: 4, flexShrink: 0 }}>
        <div
          title={segs.map(s => `${s.label}: ${s.val.toFixed(2)} pers`).join(" · ")}
          style={{ display: "flex", height: "100%", width: barWidth, borderRadius: 4, overflow: "hidden", gap: 1 }}
        >
          {segs.map(s => (total > 0 && s.val > 0) ? (
            <div key={s.key} style={{ width: `${(s.val / total) * 100}%`, background: BEMANNING_COLOR[s.key] }} />
          ) : null)}
        </div>
        {actualX != null && (
          <div
            title={`Faktiskt bemannat i snitt: ${actual.toFixed(1)}`}
            style={{ position: "absolute", left: actualX - 1, top: -3, width: 2, height: 20, background: C.white, borderRadius: 1 }}
          />
        )}
      </div>
      <span className="mono-cell" style={{ fontWeight: 700, color: C.text, minWidth: 30 }}>{total.toFixed(1)}</span>
    </div>
  );
}

// Visual view: recommended bemanning per K-bana, either for the currently
// selected period (selMonth) or pooled across all stored history — toggle
// between the two, per Jörgens ask ("antingen all historik eller vald
// historik"). Unrounded (toFixed(1), not Math.round) since a "1.4" vs "1.0"
// distinction is exactly the point.
function BemanningView({ periodAgg, periodLabel, allAgg, allLabel, kringuppgifterPct }) {
  const [scope, setScope] = useState("period");
  const active = scope === "period" ? periodAgg : allAgg;

  const rows = useMemo(() => {
    if (!active) return [];
    return KBANA_ORDER.filter(k => active[k]).map(k => {
      const r = active[k];
      return { kbana: k, breakdown: rekommenderadBemanningBreakdown(k, r.ko, r.ka, r.pall, undefined, kringuppgifterPct), actual: r.pers, n: r.n };
    });
  }, [active, kringuppgifterPct]);

  const max = Math.max(...rows.map(r => r.breakdown.total), ...rows.map(r => r.actual), 0.1);

  return (
    <div key="bemanning" className="anim-fade-up">
      <div className="form-row">
        <button
          className={"historik__snitt-btn" + (scope === "period" ? " is-active" : "")}
          onClick={() => setScope("period")}
          disabled={!periodAgg}
        >
          {periodLabel}
        </button>
        <button
          className={"historik__snitt-btn" + (scope === "all" ? " is-active" : "")}
          onClick={() => setScope("all")}
          disabled={!allAgg}
        >
          {allLabel}
        </button>
      </div>
      <Panel title="REKOMMENDERAD BEMANNING PER K-BANA" accent="blue" flush>
        <div style={{ padding: "16px 16px 4px" }}>
          {!rows.length ? (
            <div style={{ color: C.dim, fontSize: 12 }}>Ingen data för vald period.</div>
          ) : (
            <>
              <BemanningLegend />
              {rows.map(r => (
                <div key={r.kbana} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <span className="mono-cell" style={{ width: 56, fontWeight: 700, color: C.text }}>{r.kbana}</span>
                  <RekBemBar breakdown={r.breakdown} actual={r.actual} max={max} />
                  <span style={{ fontSize: 11, color: C.dim }}>{r.n} dagar</span>
                </div>
              ))}
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}

// Headline row above SnitTabell: total (all K-banor combined) daily average
// for the selected month, same comparison chips as SnitCell.
function TotalSnittRow({ totals, prevTotals, prevLabel, allTimeTotals }) {
  const fields = ["kolli", "kart", "pall", "pers"];
  return (
    <MetricGrid columns={4}>
      {fields.map(f => {
        const v = totals[f];
        const prev = prevTotals?.[f];
        const tot = allTimeTotals?.[f];
        const pctPrev = pctDelta(v, prev);
        const pctTotal = pctDelta(v, tot);
        return (
          <MetricCard key={f} label={`SNITT ${f.toUpperCase()}/DAG`} value={Math.round(v)}>
            {(pctPrev != null || pctTotal != null) && (
              <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                {pctPrev != null && <DeltaChip pct={pctPrev} label={`vs ${prevLabel}`} />}
                {pctTotal != null && <DeltaChip pct={pctTotal} label="vs totalt" />}
              </div>
            )}
          </MetricCard>
        );
      })}
    </MetricGrid>
  );
}

export default function Historik() {
  const [history, setHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const [selMonth, setSelMonth] = useState(null);
  const [selDay, setSelDay] = useState(null);
  const [view, setView] = useState("dag");
  const [legacyLocal] = useState(() => loadLegacyLocalHistory());
  // Delat globalt reglage från Live.jsx — se KringuppgifterSettings där.
  const [kringuppgifterPct] = useSetting("kringuppgifter_pct", 0, { pollMs: 60_000 });

  useEffect(() => {
    fetchHistory().then(h => {
      setHistory(h);
      const sel = getLatestSelection(h);
      setSelMonth(sel.month);
      setSelDay(sel.day);
      setLoading(false);
    }).catch(err => {
      setMsg("Kunde inte läsa historik: " + err.message);
      setLoading(false);
    });
  }, []);

  const handleFiles = useCallback(async (files) => {
    setUploading(true);
    const nh = { ...history };
    let ok = 0, fail = 0;
    for (const f of files) {
      try {
        const d = await parseDailyFile(f);
        if (!d.dateStr || !d.rows.length) continue;
        await upsertDay(d);
        const m = d.dateStr.substring(0, 7);
        if (!nh[m]) nh[m] = {};
        nh[m][d.dateStr] = d;
        ok++;
      } catch { fail++; }
    }
    setHistory(nh);
    const months = Object.keys(nh).sort();
    if (months.length) {
      const lm = months[months.length - 1];
      setSelMonth(lm);
      const days = Object.keys(nh[lm]).sort();
      setSelDay(days[days.length - 1]);
    }
    setMsg(ok + " filer inlästa" + (fail ? " (" + fail + " fel)" : ""));
    setUploading(false);
  }, [history]);

  const importLegacyLocal = useCallback(async () => {
    const days = Object.values(legacyLocal).flatMap(month => Object.values(month));
    if (!days.length) return;
    setUploading(true);
    let ok = 0, fail = 0;
    for (const d of days) {
      try { await upsertDay(d); ok++; } catch { fail++; }
    }
    const h = await fetchHistory();
    setHistory(h);
    const sel = getLatestSelection(h);
    setSelMonth(sel.month);
    setSelDay(sel.day);
    setMsg(ok + " lokala dagar importerade" + (fail ? " (" + fail + " fel)" : ""));
    setUploading(false);
  }, [legacyLocal]);

  const allMonths = useMemo(() => Object.keys(history).sort().reverse(), [history]);

  const monthDays = useMemo(() => {
    if (!selMonth || !history[selMonth]) return [];
    return Object.keys(history[selMonth]).sort();
  }, [history, selMonth]);

  const dayData = useMemo(() => {
    return selMonth && selDay ? history[selMonth]?.[selDay] || null : null;
  }, [history, selMonth, selDay]);

  const monthAgg = useMemo(() => {
    if (!selMonth || !history[selMonth]) return null;
    return aggregateKbanaRows(Object.values(history[selMonth]), kringuppgifterPct);
  }, [history, selMonth, kringuppgifterPct]);

  // Calendar month immediately before selMonth — used for the "vs föregående
  // månad" comparison. Always relative to whichever month is selected (not
  // hardcoded to "this real-world month"), so browsing older months still
  // gives a meaningful comparison.
  const prevMonthKey = useMemo(() => selMonth ? shiftMonthKey(selMonth, -1) : null, [selMonth]);

  const prevMonthAgg = useMemo(() => {
    if (!prevMonthKey || !history[prevMonthKey]) return null;
    return aggregateKbanaRows(Object.values(history[prevMonthKey]), kringuppgifterPct);
  }, [history, prevMonthKey, kringuppgifterPct]);

  const prevMonthLabel = prevMonthKey ? MONTHS_SHORT[parseInt(prevMonthKey.split("-")[1], 10) - 1] : "";

  const monthTotals = useMemo(() => {
    if (!selMonth || !history[selMonth]) return null;
    return aggregateTotals(Object.values(history[selMonth]));
  }, [history, selMonth]);

  const prevMonthTotals = useMemo(() => {
    if (!prevMonthKey || !history[prevMonthKey]) return null;
    return aggregateTotals(Object.values(history[prevMonthKey]));
  }, [history, prevMonthKey]);

  // All-time average across every stored day, in every month — the
  // "totalsnitt" baseline.
  const totalAgg = useMemo(() => {
    const allDays = Object.values(history).flatMap(m => Object.values(m));
    return allDays.length ? aggregateKbanaRows(allDays, kringuppgifterPct) : null;
  }, [history, kringuppgifterPct]);

  const allTimeTotals = useMemo(() => {
    const allDays = Object.values(history).flatMap(m => Object.values(m));
    return allDays.length ? aggregateTotals(allDays) : null;
  }, [history]);

  const totalDays = Object.values(history).reduce((s, m) => s + Object.keys(m).length, 0);

  const fmtDay = (ds) => {
    const parts = ds.split("-");
    return parseInt(parts[2], 10) + " " + MONTHS_SHORT[parseInt(parts[1], 10) - 1];
  };
  const fmtMonth = (ms) => {
    const parts = ms.split("-");
    return MONTHS_SV[parseInt(parts[1], 10) - 1] + " " + parts[0];
  };

  return (
    <div className="historik">
      <div className="historik__topbar">
        <div>
          <div className="historik__label">HISTORIK</div>
          <div className="historik__title">
            {allMonths.length} månad{allMonths.length !== 1 ? "er" : ""} — {totalDays} dagar
          </div>
          {kringuppgifterPct > 0 && (
            <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
              REK. BEM. inkl. {kringuppgifterPct}% kringuppgifter (ställs in i Live)
            </div>
          )}
        </div>
        <div className="historik__topbar-actions">
          {msg && <span className="historik__msg">{msg}</span>}
          {Object.keys(legacyLocal).length > 0 && (
            <ActionButton onClick={importLegacyLocal} disabled={uploading}>
              Importera min lokala historik
            </ActionButton>
          )}
          <label className="historik__upload">
            {uploading ? "Laddar..." : "Lägg till filer"}
            <input type="file" multiple accept=".xlsx" className="visually-hidden-input"
              onChange={e => { const f = Array.from(e.target.files); if (f.length) handleFiles(f); }} />
          </label>
          {allMonths.length > 0 && (
            <ActionButton onClick={async () => {
              if (!confirm("Ta bort ALL historik permanent (delas av hela teamet)? Går inte att ångra.")) return;
              await deleteAllDays();
              setHistory({}); setSelMonth(null); setSelDay(null);
            }}>
              Rensa
            </ActionButton>
          )}
        </div>
      </div>

      {loading ? (
        <div className="historik__empty">
          <div className="historik__empty-text">Laddar historik...</div>
        </div>
      ) : !allMonths.length ? (
        <div className="historik__empty">
          <div className="historik__empty-icon">&#128193;</div>
          <div className="historik__empty-text">
            Inga filer inlästa än.<br />Ladda upp dina Daily-filer ovan.
          </div>
        </div>
      ) : (
        <div className="historik__body">
          <div className="historik__sidebar">
            <div className="historik__sidebar-label">MÅNADER</div>
            {allMonths.map(m => (
              <button
                key={m}
                className={"historik__month-btn" + (m === selMonth ? " is-active" : "")}
                onClick={() => {
                  setSelMonth(m);
                  const days = Object.keys(history[m]).sort();
                  setSelDay(days[days.length - 1]);
                  setView("dag");
                }}
              >
                <span>{fmtMonth(m)}</span>
                <span className="historik__month-count">{Object.keys(history[m]).length}d</span>
              </button>
            ))}
          </div>

          <div className="historik__main">
            {selMonth && (
              <>
                <div className="historik__day-bar">
                  {monthDays.map(d => (
                    <button
                      key={d}
                      className={"historik__day-btn" + (d === selDay && view === "dag" ? " is-active" : "")}
                      onClick={() => { setSelDay(d); setView("dag"); }}
                    >
                      {fmtDay(d)}
                    </button>
                  ))}
                  <button
                    className={"historik__snitt-btn" + (view === "snitt" ? " is-active" : "")}
                    onClick={() => setView("snitt")}
                  >
                    Månadssnitt
                  </button>
                  <button
                    className={"historik__snitt-btn" + (view === "trend" ? " is-active" : "")}
                    onClick={() => setView("trend")}
                  >
                    Trender
                  </button>
                  <button
                    className={"historik__snitt-btn" + (view === "bemanning" ? " is-active" : "")}
                    onClick={() => setView("bemanning")}
                  >
                    Bemanning
                  </button>
                  <ActionButton
                    style={{ marginLeft: "auto" }}
                    onClick={async () => {
                      const nh = { ...history };
                      if (selDay && selMonth) {
                        await deleteDay(selDay);
                        delete nh[selMonth][selDay];
                        if (!Object.keys(nh[selMonth]).length) delete nh[selMonth];
                        setHistory(nh);
                        const months = Object.keys(nh).sort();
                        if (months.length) {
                          const lm = months[months.length - 1];
                          setSelMonth(lm);
                          const days = Object.keys(nh[lm]).sort();
                          setSelDay(days[days.length - 1] || null);
                        } else {
                          setSelMonth(null); setSelDay(null);
                        }
                      }
                    }}
                  >
                    Ta bort dag
                  </ActionButton>
                </div>

                {view === "dag" && dayData && (
                  <div key={selDay} className="anim-fade-up">
                    <MetricGrid columns={5}>
                      {[
                        { l: "PERS", v: dayData.summary.pers },
                        { l: "KOLLI", v: Math.round(dayData.summary.kolli) },
                        { l: "KART", v: Math.round(dayData.summary.kart) },
                        { l: "PREST", v: Math.round((dayData.summary.prest || 0) * 100) + "%", col: (dayData.summary.prest || 0) > 1 ? C.red : C.green },
                        { l: "GAP", v: ((dayData.summary.gap || 0) > 0 ? "+" : "") + (dayData.summary.gap || 0).toFixed(1) + "h", col: (dayData.summary.gap || 0) > 0 ? C.green : C.red },
                      ].map(s => (
                        <MetricCard key={s.l} label={s.l} value={s.v} tone={s.col} />
                      ))}
                    </MetricGrid>
                    <Panel title={dayData.fileName} flush>
                      <DagTabell rows={dayData.rows} kringuppgifterPct={kringuppgifterPct} />
                    </Panel>
                  </div>
                )}

                {view === "snitt" && monthAgg && (
                  <Panel key="snitt" title={"MÅNADSSNITT — " + fmtMonth(selMonth) + " (" + monthDays.length + " dagar)"} accent="blue" flush>
                    {monthTotals && (
                      <div style={{ padding: "14px 16px 4px" }}>
                        <TotalSnittRow totals={monthTotals} prevTotals={prevMonthTotals} prevLabel={prevMonthLabel} allTimeTotals={allTimeTotals} />
                      </div>
                    )}
                    <SnitTabell agg={monthAgg} prevAgg={prevMonthAgg} prevLabel={prevMonthLabel} totalAgg={totalAgg} />
                  </Panel>
                )}

                {view === "trend" && (
                  <TrendView key="trend" history={history} selMonth={selMonth} monthDays={monthDays} />
                )}

                {view === "bemanning" && (
                  <BemanningView
                    periodAgg={monthAgg}
                    periodLabel={"Vald period" + (selMonth ? " (" + fmtMonth(selMonth) + ")" : "")}
                    allAgg={totalAgg}
                    allLabel={"All historik (" + totalDays + " dagar)"}
                    kringuppgifterPct={kringuppgifterPct}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
