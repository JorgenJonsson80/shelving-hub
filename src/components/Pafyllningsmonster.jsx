import { useState, useMemo } from "react";
import { C } from "../shared/theme";
import { Alert, Dropzone, Panel } from "../shared/components";
import { parsePFExport } from "../shared/parsers";
import { classifyLocation } from "../shared/liveUtils";

const KBANA_ORDER = ["K58", "K55", "K61-36", "K56", "K62", "K61-7", "K51", "K60", "K59", "K52", "K53"];

function lsGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}

// Horizontal bar showing proportion (0–1)
function PropBar({ value, color = C.blue, max = 1 }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

// Stacked source bar (GM/Mezz/ULC/PL09)
function SourceBar({ kallor }) {
  const total = (kallor.GM || 0) + (kallor.Mezz || 0) + (kallor.ULC || 0) + (kallor.PL09 || 0) + (kallor.Udda || 0);
  if (!total) return null;
  const segs = [
    { key: "GM",   color: C.yellow, label: "GM" },
    { key: "Mezz", color: C.blue,   label: "M" },
    { key: "ULC",  color: C.green,  label: "U" },
    { key: "PL09", color: C.red,    label: "P" },
  ];
  return (
    <div title={segs.map(s => `${s.label}: ${Math.round((kallor[s.key] || 0) / total * 100)}%`).join(", ")}
      style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", width: 80, gap: 1 }}>
      {segs.map(s => {
        const w = ((kallor[s.key] || 0) / total) * 100;
        return w > 0 ? (
          <div key={s.key} style={{ width: `${w}%`, background: s.color }} />
        ) : null;
      })}
    </div>
  );
}

// Small hour-distribution sparkline
function HourSpark({ perTimme, w = 60, h = 20 }) {
  const max = Math.max(...perTimme, 1);
  const relevant = perTimme.slice(4, 18); // hour 4–17
  const pts = relevant.map((v, i) => [
    (i / (relevant.length - 1)) * w,
    h - 2 - (v / max) * (h - 4),
  ]);
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} style={{ overflow: "visible", display: "block" }}>
      <path d={d} fill="none" stroke={C.blue} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function aggDays(days) {
  const n = days.length;
  if (!n) return [];

  // Per kbana per dag
  const kbanaPerDag = {}; // kbana → array of day-objects {pf, labels, fm, perTimme, kallor}

  for (const day of days) {
    const kbanaDay = {}; // kbana → {pf, labels, fmPF, perTimme:[24], kallor}

    for (const row of day.rows) {
      const kb = classifyLocation(row.toLoc);
      if (!kb) continue;

      if (!kbanaDay[kb]) {
        kbanaDay[kb] = { pf: 0, labels: 0, fmPF: 0, perTimme: Array(24).fill(0), kallor: { GM: 0, Mezz: 0, ULC: 0, PL09: 0, Udda: 0 } };
      }
      const k = kbanaDay[kb];
      k.pf++;
      k.labels += row.labels;
      if (row.hour < 12) k.fmPF++;
      if (row.hour >= 0 && row.hour < 24) k.perTimme[row.hour]++;
      k.kallor[row.kalla] = (k.kallor[row.kalla] || 0) + 1;
    }

    for (const [kb, d] of Object.entries(kbanaDay)) {
      if (!kbanaPerDag[kb]) kbanaPerDag[kb] = [];
      kbanaPerDag[kb].push(d);
    }
  }

  // Aggregate
  return Object.entries(kbanaPerDag).map(([kbana, dagArr]) => {
    const nd = dagArr.length;
    const pfPerDag     = dagArr.reduce((s, d) => s + d.pf, 0) / n;
    const labelsPerDag = dagArr.reduce((s, d) => s + d.labels, 0) / n;
    const totalPF      = dagArr.reduce((s, d) => s + d.pf, 0);
    const totalLabels  = dagArr.reduce((s, d) => s + d.labels, 0);
    const labelsPerPF  = totalPF ? totalLabels / totalPF : 0;
    const totalFM      = dagArr.reduce((s, d) => s + d.fmPF, 0);
    const fmAndel      = totalPF ? (totalFM / totalPF) * 100 : 0;

    // Summed per-hour across all days (for sparkline)
    const perTimme = Array(24).fill(0);
    for (const d of dagArr) d.perTimme.forEach((v, h) => { perTimme[h] += v; });

    // Source distribution (pct)
    const kallor = { GM: 0, Mezz: 0, ULC: 0, PL09: 0, Udda: 0 };
    for (const d of dagArr) {
      for (const k of Object.keys(kallor)) kallor[k] += d.kallor[k] || 0;
    }

    // Volatility (cv) if ≥3 days of data for this kbana
    let cv = null;
    if (dagArr.length >= 3) {
      const pfValues = dagArr.map(d => d.pf);
      const mean = pfValues.reduce((s, v) => s + v, 0) / pfValues.length;
      const std  = Math.sqrt(pfValues.reduce((s, v) => s + (v - mean) ** 2, 0) / pfValues.length);
      cv = mean > 0 ? (std / mean) * 100 : null;
    }

    return {
      kbana,
      pfPerDag: Math.round(pfPerDag * 10) / 10,
      labelsPerDag: Math.round(labelsPerDag),
      labelsPerPF: Math.round(labelsPerPF * 10) / 10,
      fmAndel: Math.round(fmAndel),
      perTimme,
      kallor,
      cv,
      nd,
      daysData: dagArr,
    };
  }).sort((a, b) => b.pfPerDag - a.pfPerDag);
}

export default function Pafyllningsmonster() {
  const [drag, setDrag]     = useState(false);
  const [err, setErr]       = useState(null);
  const [storedDays, setStoredDays] = useState(() => lsGet("pafyll_days_v1", []));
  const [expandedKb, setExpandedKb] = useState(null);

  const handleFiles = (fileOrFiles) => {
    setErr(null);
    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    parsePFExport(files).then(days => {
      if (!days.length) { setErr("Inga rader hittades i filerna."); return; }
      setStoredDays(prev => {
        const existing = new Set(prev.map(d => d.datum));
        const nyaDagar = days.filter(d => !existing.has(d.datum));
        if (!nyaDagar.length) return prev;
        const next = [...prev, ...nyaDagar].slice(-90);
        try { localStorage.setItem("pafyll_days_v1", JSON.stringify(next)); } catch {}
        return next;
      });
    }).catch(e => setErr(e.message));
  };

  const { agg, tunga } = useMemo(() => {
    if (!storedDays.length) return { agg: [], tunga: [] };
    const rows = aggDays(storedDays);
    const tunga = rows.slice(0, 3);
    return { agg: rows, tunga };
  }, [storedDays]);

  const maxPF     = agg[0]?.pfPerDag ?? 1;
  const maxLabels = Math.max(...agg.map(r => r.labelsPerDag), 1);

  // Level classification: top 3 = tung, bottom 3 = lätt, rest = medel
  const nivå = (i) => i < 3 ? "tung" : i >= agg.length - 3 ? "lätt" : "medel";
  const nivåColor = (n) => n === "tung" ? C.red : n === "lätt" ? C.green : C.yellow;

  const clearData = () => {
    try { localStorage.removeItem("pafyll_days_v1"); } catch {}
    setStoredDays([]);
  };

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">PÅFYLLNINGSMÖNSTER</div>
          <h1 className="page-title">Belastning per K-bana</h1>
          <div className="page-subtitle">
            {storedDays.length
              ? `${storedDays.length} dag${storedDays.length !== 1 ? "ar" : ""} i underlaget · ${agg.reduce((s, r) => s + r.pfPerDag, 0).toFixed(0)} PF/dag totalt`
              : "Importera en eller flera PF-exportfiler för att bygga upp mönsteranalysen."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <label style={{ cursor: "pointer", padding: "6px 12px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, color: C.textDim }}>
            + Lägg till filer
            <input type="file" accept=".xlsx" multiple className="visually-hidden-input"
              onChange={e => { const f = Array.from(e.target.files); if (f.length) handleFiles(f); }} />
          </label>
          {storedDays.length > 0 && (
            <button onClick={clearData}
              style={{ padding: "6px 12px", background: "none", border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, color: C.dim, cursor: "pointer" }}>
              Rensa
            </button>
          )}
        </div>
      </div>

      {err && <Alert>{err}</Alert>}

      {!storedDays.length && (
        <div onDragEnter={() => setDrag(true)} onDragLeave={() => setDrag(false)} onDrop={() => setDrag(false)}>
          <Dropzone icon="M" title="Släpp PF-exportfil(er) här" subtitle="En eller flera dagar · .xlsx" dragging={drag} multiple onFile={handleFiles} />
        </div>
      )}

      {agg.length > 0 && (
        <div className="anim-fade-up">
          {/* Flaskhals-varning om tunga banor toppar samma timme */}
          {tunga.length === 3 && (() => {
            const top3Hours = tunga.map(t => {
              const idx = t.perTimme.indexOf(Math.max(...t.perTimme));
              return idx;
            });
            const same = top3Hours.every(h => Math.abs(h - top3Hours[0]) <= 1);
            return same ? (
              <div style={{ padding: "10px 14px", marginBottom: 10, background: C.red + "18", border: `1px solid ${C.red}44`, borderRadius: 8, fontSize: 13, color: C.text }}>
                ⚠ Flaskhals: {tunga.map(t => t.kbana).join(", ")} toppar samtidigt (~kl {top3Hours[0]}) — 55% av volymen.
              </div>
            ) : null;
          })()}

          {/* Belastningstabell */}
          <Panel title="BELASTNING PER BANA">
            <div className="data-table-wrap">
              <table className="data-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>BANA</th>
                    <th style={{ color: C.dim, fontWeight: 600, fontSize: 10, textAlign: "right" }}>NIVÅ</th>
                    <th style={{ color: C.dim, fontWeight: 600, fontSize: 10, textAlign: "right" }}>PF/DAG</th>
                    <th style={{ color: C.dim, fontWeight: 600, fontSize: 10 }}></th>
                    <th style={{ color: C.dim, fontWeight: 600, fontSize: 10, textAlign: "right" }}>LABELS/DAG</th>
                    <th style={{ color: C.dim, fontWeight: 600, fontSize: 10 }}></th>
                    <th style={{ color: C.dim, fontWeight: 600, fontSize: 10, textAlign: "right" }}>LBL/PF</th>
                    <th style={{ color: C.dim, fontWeight: 600, fontSize: 10, textAlign: "right" }}>FM%</th>
                    <th style={{ color: C.dim, fontWeight: 600, fontSize: 10 }}>KÄLLMIX</th>
                    <th style={{ color: C.dim, fontWeight: 600, fontSize: 10 }}>DYGN</th>
                  </tr>
                </thead>
                <tbody>
                  {agg.map((r, i) => {
                    const nv = nivå(i);
                    const nc = nivåColor(nv);
                    const expanded = expandedKb === r.kbana;
                    return (
                      <>
                        <tr key={r.kbana}
                          onClick={() => setExpandedKb(expanded ? null : r.kbana)}
                          style={{ cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>
                          <td className="primary-cell" style={{ fontWeight: 700 }}>{r.kbana}</td>
                          <td style={{ textAlign: "right" }}>
                            <span style={{ fontSize: 10, color: nc, fontWeight: 700, background: nc + "18", padding: "1px 5px", borderRadius: 4 }}>
                              {nv.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: C.text, fontWeight: 600 }}>{r.pfPerDag}</td>
                          <td style={{ width: 80 }}>
                            <PropBar value={r.pfPerDag} max={maxPF} color={nc} />
                          </td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: C.text }}>{r.labelsPerDag}</td>
                          <td style={{ width: 80 }}>
                            <PropBar value={r.labelsPerDag} max={maxLabels} color={C.blue} />
                          </td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: C.textDim }}>
                            <span style={{ color: r.labelsPerPF > 4 ? C.accent : C.textDim }}>{r.labelsPerPF}</span>
                          </td>
                          <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: C.textDim }}>{r.fmAndel}%</td>
                          <td><SourceBar kallor={r.kallor} /></td>
                          <td><HourSpark perTimme={r.perTimme} /></td>
                        </tr>
                        {expanded && (
                          <tr key={r.kbana + "-exp"}>
                            <td colSpan={10} style={{ padding: "10px 16px", background: C.panel, fontSize: 12 }}>
                              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                                <div>
                                  <div style={{ color: C.dim, fontSize: 10, marginBottom: 4 }}>KÄLLMIX</div>
                                  {Object.entries(r.kallor).filter(([, v]) => v > 0).map(([k, v]) => {
                                    const tot = Object.values(r.kallor).reduce((s, x) => s + x, 0);
                                    return (
                                      <div key={k} style={{ fontSize: 12, color: C.textDim }}>
                                        {k}: {Math.round(v / tot * 100)}%
                                      </div>
                                    );
                                  })}
                                </div>
                                <div>
                                  <div style={{ color: C.dim, fontSize: 10, marginBottom: 4 }}>FM/EM-SPLIT</div>
                                  <div style={{ color: C.textDim }}>Förmiddag: {r.fmAndel}%</div>
                                  <div style={{ color: C.textDim }}>Eftermiddag: {100 - r.fmAndel}%</div>
                                </div>
                                {r.cv != null && (
                                  <div>
                                    <div style={{ color: C.dim, fontSize: 10, marginBottom: 4 }}>VOLATILITET</div>
                                    <div style={{ color: r.cv > 30 ? C.red : r.cv > 15 ? C.yellow : C.green }}>
                                      CV {Math.round(r.cv)}% {r.cv > 30 ? "(hög)" : r.cv > 15 ? "(medel)" : "(stabil)"}
                                    </div>
                                  </div>
                                )}
                                <div>
                                  <div style={{ color: C.dim, fontSize: 10, marginBottom: 4 }}>INSIKT</div>
                                  <div style={{ color: C.textDim, maxWidth: 260 }}>
                                    {r.labelsPerPF > 4
                                      ? `Få PF men stora laster (${r.labelsPerPF} lbl/PF) — underskattas lätt av PF-antal.`
                                      : `Många PF, relativt små laster (${r.labelsPerPF} lbl/PF).`}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: C.dim, padding: "8px 12px" }}>
              Klicka på en bana för källmix och detaljer · Baserat på {storedDays.length} dag(ar)
            </div>
          </Panel>

          {/* Tunga banor djupdyk */}
          {tunga.length > 0 && (
            <Panel title="TUNGA BANOR — DJUPDYK">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, padding: "4px 0" }}>
                {tunga.map(t => (
                  <div key={t.kbana} style={{ background: C.panelRaised, borderRadius: 8, padding: 14 }}>
                    <div style={{ fontWeight: 800, color: C.white, fontSize: 15, marginBottom: 8 }}>{t.kbana}</div>
                    <div style={{ fontSize: 12, color: C.textDim, marginBottom: 4 }}>{t.pfPerDag} PF/dag · {t.labelsPerDag} labels/dag</div>
                    <div style={{ fontSize: 12, color: C.textDim, marginBottom: 8 }}>FM: {t.fmAndel}% · {t.labelsPerPF} lbl/PF</div>
                    <SourceBar kallor={t.kallor} />
                    <div style={{ marginTop: 10 }}>
                      <HourSpark perTimme={t.perTimme} w={100} h={28} />
                    </div>
                    {t.cv != null && (
                      <div style={{ fontSize: 11, color: t.cv > 30 ? C.red : t.cv > 15 ? C.yellow : C.green, marginTop: 6 }}>
                        CV {Math.round(t.cv)}% variation dag-till-dag
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: C.dim, padding: "8px 0 0" }}>
                Dessa 3 banor = ~{Math.round(tunga.reduce((s, t) => s + t.pfPerDag, 0) / Math.max(agg.reduce((s, r) => s + r.pfPerDag, 0), 1) * 100)}% av total volym.
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
