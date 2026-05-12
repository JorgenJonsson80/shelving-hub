import { useState, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
import { C } from "../shared/theme";
import {
  ActionButton,
  BedomingPill,
  DataTable,
  GapChip,
  MetricCard,
  MetricGrid,
  Panel,
  PrestBar,
} from "../shared/components";
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
    <DataTable headers={[
      "BANA",
      { label: "PERS", align: "right" },
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
            return (
              <tr key={k}>
                <td className="primary-cell">{r.kbana}</td>
                <td className="is-right mono-cell" style={{ color: C.textDim }}>{r.pers}</td>
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

function SnitTabell({ agg }) {
  return (
    <DataTable headers={[
      "BANA",
      { label: "DAGAR", align: "right" },
      { label: "SNITT KOLLI", align: "right" },
      { label: "SNITT KART", align: "right" },
      { label: "SNITT PREST", align: "right" },
      { label: "SNITT GAP", align: "right" },
    ]}>
          {KBANA_ORDER.map(k => {
            const r = agg.find(x => x.kbana === k);
            if (!r) return null;
            return (
              <tr key={k}>
                <td className="primary-cell">{r.kbana}</td>
                <td className="is-right mono-cell" style={{ color: C.dim }}>{r.n}</td>
                <td className="is-right mono-cell">{Math.round(r.ko)}</td>
                <td className="is-right mono-cell">{Math.round(r.ka)}</td>
                <td className="is-right"><PrestBar prest={r.prest} /></td>
                <td className="is-right"><GapChip gap={r.gap} /></td>
              </tr>
            );
          })}
    </DataTable>
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
    <div className="historik">
      <div className="historik__topbar">
        <div>
          <div className="historik__label">HISTORIK</div>
          <div className="historik__title">
            {allMonths.length} månad{allMonths.length !== 1 ? "er" : ""} — {totalDays} dagar
          </div>
        </div>
        <div className="historik__topbar-actions">
          {msg && <span className="historik__msg">{msg}</span>}
          <label className="historik__upload">
            {uploading ? "Laddar..." : "Lägg till filer"}
            <input type="file" multiple accept=".xlsx" className="visually-hidden-input"
              onChange={e => { const f = Array.from(e.target.files); if (f.length) handleFiles(f); }} />
          </label>
          {allMonths.length > 0 && (
            <ActionButton onClick={() => { saveHistory({}); setHistory({}); setSelMonth(null); setSelDay(null); }}>
              Rensa
            </ActionButton>
          )}
        </div>
      </div>

      {!allMonths.length ? (
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
                  <ActionButton
                    style={{ marginLeft: "auto" }}
                    onClick={() => {
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
                      <DagTabell rows={dayData.rows} />
                    </Panel>
                  </div>
                )}

                {view === "snitt" && monthAgg && (
                  <Panel key="snitt" title={"MÅNADSSNITT — " + fmtMonth(selMonth) + " (" + monthDays.length + " dagar)"} accent="blue" flush>
                    <SnitTabell agg={monthAgg} />
                  </Panel>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
