import { useState, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
import { C, shadow } from "../shared/theme";
import { PrestBar, BedomingPill, GapChip } from "../shared/components";
import { parseDailyRows } from "../shared/parseDailyRows";

const KBANA_ORDER = ["K51","K52","K53","K55","K56","K58","K59","K60","K61-7","K61-36","K62","K63"];
const STORAGE_KEY = "shelving_history_v2";
const MONTHS_SV = ["Januari","Februari","Mars","April","Maj","Juni","Juli","Augusti","September","Oktober","November","December"];
const MONTHS_SHORT = ["jan","feb","mar","apr","maj","jun","jul","aug","sep","okt","nov","dec"];

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    return {};
  }
  return {};
}

function saveHistory(h) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(h));
  } catch {
    // localStorage can be unavailable in private or restricted browser contexts.
  }
}

function getLatestSelection(h) {
  const months = Object.keys(h).sort();
  if (!months.length) return { month: null, day: null };
  const month = months[months.length - 1];
  const days = Object.keys(h[month]).sort();
  return { month, day: days[days.length - 1] || null };
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
        const nm = file.name.match(/(\d+)[_\s](jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)/i);
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
        const sr = raw.find(r => String(r[0]).toLowerCase() === "summa") || [];
        resolve({
          dateStr,
          fileName: file.name,
          rows: kbanaRows,
          summary: {
            pers: +sr[5] || 0,
            kolli: +sr[2] || 0,
            kart: +sr[3] || 0,
            gap: +sr[9] || 0,
            prest: +sr[8] || 0,
          },
        });
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function DagTabell({ rows }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {["BANA","PERS","KOLLI","KART","PALL","PREST","GAP","SCAN","BEDOMNING"].map(h => (
              <th key={h} style={{ padding: "7px 12px", textAlign: h === "BANA" ? "left" : "right", fontSize: 10, letterSpacing: 1, color: C.dim, fontWeight: 700, borderBottom: "1px solid " + C.border2, whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {KBANA_ORDER.map(k => {
            const r = rows.find(x => x.kbana === k);
            if (!r) return null;
            const scanPct = r.scannat != null ? Math.round(r.scannat * 100) : null;
            const scanColor = scanPct == null ? C.dim : scanPct < 20 ? C.dim : scanPct < 60 ? C.red : scanPct < 75 ? C.yellow : C.green;
            return (
              <tr key={k} style={{ borderBottom: "1px solid " + C.border }}
                onMouseEnter={e => e.currentTarget.style.background = C.surface}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "8px 12px", fontWeight: 700, color: C.white }}>{r.kbana}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", color: C.textDim }}>{r.pers}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace" }}>{r.kolli}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace" }}>{r.kart}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace" }}>{r.helpall}</td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}><PrestBar prest={r.prest} /></td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}><GapChip gap={r.gap} /></td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", color: scanColor, fontWeight: scanPct !== null && scanPct < 75 ? 700 : 400 }}>
                  {scanPct != null ? scanPct + "%" : "-"}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}><BedomingPill text={r.bedoming} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SnitTabell({ agg }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {["BANA","DAGAR","SNITT KOLLI","SNITT KART","SNITT PREST","SNITT GAP"].map(h => (
              <th key={h} style={{ padding: "7px 12px", textAlign: h === "BANA" ? "left" : "right", fontSize: 10, letterSpacing: 1, color: C.dim, fontWeight: 700, borderBottom: "1px solid " + C.border2 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {KBANA_ORDER.map(k => {
            const r = agg.find(x => x.kbana === k);
            if (!r) return null;
            return (
              <tr key={k} style={{ borderBottom: "1px solid " + C.border }}
                onMouseEnter={e => e.currentTarget.style.background = C.surface}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "8px 12px", fontWeight: 700, color: C.white }}>{r.kbana}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace", color: C.dim }}>{r.n}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace" }}>{Math.round(r.ko)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontFamily: "monospace" }}>{Math.round(r.ka)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}><PrestBar prest={r.prest} /></td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}><GapChip gap={r.gap} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Historik() {
  const [initialState] = useState(() => {
    const history = loadHistory();
    const selection = getLatestSelection(history);
    return { history, selection };
  });

  const [history, setHistory] = useState(initialState.history);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const [selMonth, setSelMonth] = useState(initialState.selection.month);
  const [selDay, setSelDay] = useState(initialState.selection.day);
  const [view, setView] = useState("dag");

  const handleFiles = useCallback(async (files) => {
    setUploading(true);
    const nh = { ...history };
    let ok = 0, fail = 0;
    for (const f of files) {
      try {
        const d = await parseDailyFile(f);
        if (!d.dateStr || !d.rows.length) continue;
        const m = d.dateStr.substring(0, 7);
        if (!nh[m]) nh[m] = {};
        nh[m][d.dateStr] = d;
        ok++;
      } catch { fail++; }
    }
    saveHistory(nh);
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
    const byK = {};
    for (const d of Object.values(history[selMonth])) {
      for (const r of d.rows) {
        if (!byK[r.kbana]) byK[r.kbana] = { pa: [], ga: [], ko: 0, ka: 0, n: 0 };
        const b = byK[r.kbana];
        if (r.prest) b.pa.push(r.prest);
        b.ga.push(r.gap);
        b.ko += r.kolli;
        b.ka += r.kart;
        b.n++;
      }
    }
    return Object.entries(byK).map(([k, v]) => ({
      kbana: k,
      prest: v.pa.length ? v.pa.reduce((a, b) => a + b) / v.pa.length : 0,
      gap: v.ga.reduce((a, b) => a + b) / v.ga.length,
      ko: v.n ? v.ko / v.n : 0,
      ka: v.n ? v.ka / v.n : 0,
      n: v.n,
    }));
  }, [history, selMonth]);

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
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 58px)" }}>
      {/* Header */}
      <div style={{ background: C.surface, borderBottom: "1px solid " + C.border, padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 10, color: C.accent, letterSpacing: 3, fontWeight: 700, marginBottom: 2 }}>HISTORIK</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.white, fontFamily: "sans-serif" }}>
            {allMonths.length} månad{allMonths.length !== 1 ? "er" : ""} - {totalDays} dagar
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {msg && <span style={{ fontSize: 11, color: C.green }}>{msg}</span>}
          <label style={{ background: C.panel, border: "1px dashed " + C.border2, borderRadius: 6, padding: "7px 14px", fontSize: 11, color: C.textDim, cursor: "pointer" }}>
            {uploading ? "Laddar..." : "Lägg till filer"}
            <input type="file" multiple accept=".xlsx" style={{ display: "none" }}
              onChange={e => { const f = Array.from(e.target.files); if (f.length) handleFiles(f); }} />
          </label>
          {allMonths.length > 0 && (
            <button onClick={() => { saveHistory({}); setHistory({}); setSelMonth(null); setSelDay(null); }}
              style={{ background: "transparent", border: "1px solid " + C.border, color: C.dim, borderRadius: 6, padding: "7px 10px", fontSize: 10, fontFamily: "monospace", cursor: "pointer" }}>
              Rensa
            </button>
          )}
        </div>
      </div>

      {!allMonths.length ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 16, padding: 40 }}>
          <div style={{ fontSize: 48 }}>&#128193;</div>
          <div style={{ color: C.textDim, textAlign: "center", fontSize: 15 }}>
            Inga filer inlästa än.<br />Ladda upp dina Daily-filer ovan.
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", flex: 1, minHeight: 0 }}>
          {/* Sidebar */}
          <div style={{ background: C.surface, borderRight: "1px solid " + C.border, overflowY: "auto" }}>
            <div style={{ fontSize: 9, color: C.dim, letterSpacing: 2, padding: "14px 14px 8px", fontWeight: 700 }}>MÅNADER</div>
            {allMonths.map(m => (
              <button key={m} onClick={() => {
                setSelMonth(m);
                const days = Object.keys(history[m]).sort();
                setSelDay(days[days.length - 1]);
                setView("dag");
              }}
                style={{
                  width: "100%", background: m === selMonth ? C.accent + "15" : "transparent",
                  border: "none", borderLeft: "3px solid " + (m === selMonth ? C.accent : "transparent"),
                  padding: "10px 14px", textAlign: "left", cursor: "pointer",
                  color: m === selMonth ? C.white : C.textDim,
                  fontFamily: "monospace", fontSize: 11,
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                <span>{fmtMonth(m)}</span>
                <span style={{ fontSize: 10, color: m === selMonth ? C.accent : C.dim, background: m === selMonth ? C.accent + "22" : C.border, borderRadius: 10, padding: "1px 6px" }}>
                  {Object.keys(history[m]).length}d
                </span>
              </button>
            ))}
          </div>

          {/* Main */}
          <div style={{ overflowY: "auto", padding: "20px 24px" }}>
            {selMonth && (
              <>
                {/* Dag-knappar */}
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
                  {monthDays.map(d => (
                    <button key={d} onClick={() => { setSelDay(d); setView("dag"); }}
                      style={{
                        background: d === selDay && view === "dag" ? C.accent : C.panel,
                        border: "1px solid " + (d === selDay && view === "dag" ? C.accent : C.border2),
                        color: d === selDay && view === "dag" ? "#000" : C.textDim,
                        borderRadius: 5, padding: "5px 10px", fontSize: 11,
                        fontFamily: "monospace", fontWeight: d === selDay && view === "dag" ? 700 : 400,
                        cursor: "pointer",
                      }}>
                      {fmtDay(d)}
                    </button>
                  ))}
                  <button onClick={() => setView("snitt")}
                    style={{
                      background: view === "snitt" ? C.blue : C.panel,
                      border: "1px solid " + (view === "snitt" ? C.blue : C.border2),
                      color: view === "snitt" ? "#fff" : C.textDim,
                      borderRadius: 5, padding: "5px 10px", fontSize: 11,
                      fontFamily: "monospace", fontWeight: view === "snitt" ? 700 : 400,
                      cursor: "pointer", marginLeft: 6,
                    }}>
                    Månadssnitt
                  </button>
                  <button onClick={() => {
                    const nh = { ...history };
                    if (selDay && selMonth) {
                      delete nh[selMonth][selDay];
                      if (!Object.keys(nh[selMonth]).length) delete nh[selMonth];
                      saveHistory(nh);
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
                    style={{ background: "transparent", border: "1px solid " + C.border, color: C.dim, borderRadius: 5, padding: "5px 10px", fontSize: 10, fontFamily: "monospace", cursor: "pointer", marginLeft: "auto" }}>
                    Ta bort dag
                  </button>
                </div>

                {/* Dag-vy */}
                {view === "dag" && dayData && (
                  <div key={selDay} style={{ animation: "fade-up 0.2s ease" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 }}>
                      {[
                        { l: "PERS", v: dayData.summary.pers },
                        { l: "KOLLI", v: Math.round(dayData.summary.kolli) },
                        { l: "KART", v: Math.round(dayData.summary.kart) },
                        { l: "PREST", v: Math.round((dayData.summary.prest || 0) * 100) + "%", col: (dayData.summary.prest || 0) > 1 ? C.red : C.green },
                        { l: "GAP", v: ((dayData.summary.gap || 0) > 0 ? "+" : "") + (dayData.summary.gap || 0).toFixed(1) + "h", col: (dayData.summary.gap || 0) > 0 ? C.green : C.red },
                      ].map(s => (
                        <div key={s.l} style={{ background: C.panel, border: "1px solid " + C.border, borderRadius: 10, padding: "12px 14px", boxShadow: shadow.card }}>
                          <div style={{ fontSize: 9, color: C.dim, letterSpacing: 2, marginBottom: 6, fontWeight: 600 }}>{s.l}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: s.col || C.text, fontFamily: "sans-serif" }}>{s.v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ background: C.panel, border: "1px solid " + C.border, borderRadius: 12, overflow: "hidden", boxShadow: shadow.card }}>
                      <div style={{ padding: "12px 16px", borderBottom: "1px solid " + C.border, fontSize: 9, color: C.accent, letterSpacing: 3, fontWeight: 700, background: "rgba(255,255,255,0.02)" }}>
                        {dayData.fileName}
                      </div>
                      <DagTabell rows={dayData.rows} />
                    </div>
                  </div>
                )}

                {/* Snitt-vy */}
                {view === "snitt" && monthAgg && (
                  <div key="snitt" style={{ animation: "fade-up 0.2s ease", background: C.panel, border: "1px solid " + C.blue + "44", borderRadius: 12, overflow: "hidden", boxShadow: shadow.card }}>
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid " + C.border, fontSize: 9, color: C.blue, letterSpacing: 3, fontWeight: 700, background: "rgba(255,255,255,0.02)" }}>
                      MÅNADSSNITT - {fmtMonth(selMonth)} ({monthDays.length} dagar)
                    </div>
                    <SnitTabell agg={monthAgg} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
