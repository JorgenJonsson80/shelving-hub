import { useState, useMemo, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { C } from "../shared/theme";
import { Alert, Panel, ActionButton } from "../shared/components";
import { fetchLedtidObservations, insertLedtidObservation, deleteLedtidObservation } from "../shared/ledtidDb";

const KBANOR = ["K51", "K52", "K53", "K55", "K56", "K58", "K59", "K60", "K61-7", "K61-36", "K62"];
const ORSAKER = ["", "Ko vid mezz", "Stor korning", "Utrustning", "Fel varutyp", "Personalbrist", "Annat"];
// Old localStorage key — no longer written to, only read once for the
// one-time "import my local observations into Supabase" migration button.
const LEGACY_STORAGE_KEY = "ledtid_obs_v1";

function loadLegacyLocalObs() {
  try { return JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? "null") ?? []; }
  catch { return []; }
}

function toMinsPF(str) {
  if (!str) return null;
  const [h, m] = str.split(":").map(Number);
  if (isNaN(h)) return null;
  return h * 60 + (m || 0);
}

function midnattsäker(diff) {
  return diff < 0 ? diff + 24 * 60 : diff;
}

function calcTider(obs) {
  const skickad = toMinsPF(obs.skickad);
  const klar    = toMinsPF(obs.klar);
  const system  = toMinsPF(obs.systemtid);

  if (skickad === null || klar === null) return null;

  const transportTid   = midnattsäker(klar - skickad);
  const mezzVantetid   = system !== null ? midnattsäker(skickad - system) : null;
  const totalLedtid    = mezzVantetid !== null ? mezzVantetid + transportTid : null;

  return { transportTid, mezzVantetid, totalLedtid, ledtid: transportTid };
}

function fmtMin(m) {
  if (m == null) return "–";
  const h = Math.floor(m / 60);
  const min = m % 60;
  return h > 0 ? `${h}h ${min}min` : `${min}min`;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function larmNiva(values) {
  if (!values.length) return null;
  const med = median(values);
  return Math.ceil((med * 2.5) / 5) * 5;
}

function kbanaStats(obs, kbana) {
  const relevant = obs.filter(o => o.kbana === kbana);
  const tiders = relevant.map(o => calcTider(o)).filter(Boolean);

  const transports = tiders.map(t => t.transportTid);
  const mezzer     = tiders.map(t => t.mezzVantetid).filter(v => v != null);
  const totaler    = tiders.map(t => t.totalLedtid).filter(v => v != null);

  if (!transports.length) return null;

  const n = transports.length;
  const snittTransport = transports.reduce((s, v) => s + v, 0) / n;
  const snittMezz      = mezzer.length ? mezzer.reduce((s, v) => s + v, 0) / mezzer.length : null;
  const snittTotal     = totaler.length ? totaler.reduce((s, v) => s + v, 0) / totaler.length : null;

  // Time per kolli where available
  const kolli = relevant.filter(o => o.antalKolli > 0 && calcTider(o));
  const tidPerKolli = kolli.length
    ? kolli.reduce((s, o) => s + (calcTider(o).transportTid / o.antalKolli), 0) / kolli.length
    : null;

  const larmniva = larmNiva(totaler.length ? totaler : transports);

  return {
    kbana, n, snittTransport, snittMezz, snittTotal,
    medianTransport: median(transports),
    maxTransport: Math.max(...transports),
    tidPerKolli, larmniva,
  };
}

const EMPTY_FORM = { kbana: "K58", systemtid: "", skickad: "", klar: "", antalKolli: "", orsak: "", notering: "" };

export default function Ledtid() {
  const [obs, setObs]           = useState([]);
  const [legacyLocal]           = useState(() => loadLegacyLocalObs());
  const [importing, setImporting] = useState(false);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [formErr, setFormErr]   = useState(null);
  const [importErr, setImportErr] = useState(null);
  const [importMsg, setImportMsg] = useState(null);
  const [selKbana, setSelKbana] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    fetchLedtidObservations().then(setObs).catch(err => setImportErr("Kunde inte läsa observationer: " + err.message));
  }, []);

  const handleAdd = async () => {
    setFormErr(null);
    if (!form.skickad || !form.klar) { setFormErr("Fyll i Skickad och Klar."); return; }
    const tider = calcTider(form);
    if (!tider) { setFormErr("Ogiltigt tidsformat (använd HH:MM)."); return; }
    if (tider.transportTid > 8 * 60) {
      setFormErr("Transporttid > 8h — kontrollera tiderna.");
      return;
    }
    const nu = new Date();
    const datum = nu.toISOString().substring(0, 10);
    const veckodag = nu.getDay() || 7; // 1=mån, 7=sön
    const timme = toMinsPF(form.skickad) != null ? Math.floor(toMinsPF(form.skickad) / 60) : null;
    const nyObs = {
      datum, veckodag, timme,
      kbana: form.kbana,
      systemtid: form.systemtid || null,
      skickad: form.skickad,
      klar: form.klar,
      ...tider,
      antalKolli: form.antalKolli ? Number(form.antalKolli) : null,
      orsak: form.orsak || null,
      notering: form.notering || null,
    };
    try {
      const saved = await insertLedtidObservation(nyObs);
      setObs(prev => [...prev, saved]);
      setForm(prev => ({ ...EMPTY_FORM, kbana: prev.kbana }));
    } catch (err) {
      setFormErr("Kunde inte spara: " + err.message);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteLedtidObservation(id);
      setObs(prev => prev.filter(o => o.id !== id));
    } catch (err) {
      setImportErr("Kunde inte ta bort: " + err.message);
    }
  };

  const importLegacyLocal = async () => {
    if (!legacyLocal.length) return;
    setImporting(true);
    await mergeImported(legacyLocal);
    setImporting(false);
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(obs, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `ledtid_${new Date().toISOString().substring(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const mergeImported = async (imported) => {
    if (!Array.isArray(imported)) throw new Error("Datan är inte en array.");
    const dupeKey = o => `${o.kbana}|${o.skickad}|${o.klar}|${o.datum}`;
    const existing = new Set(obs.map(dupeKey));
    const nya = imported.filter(o => !existing.has(dupeKey(o)));
    let ok = 0, fail = 0;
    const saved = [];
    for (const o of nya) {
      try { saved.push(await insertLedtidObservation(o)); ok++; }
      catch { fail++; }
    }
    setObs(prev => [...prev, ...saved]);
    setImportMsg(`${ok} nya observationer importerade (${imported.length - nya.length} dubbletter hoppades över${fail ? `, ${fail} fel` : ""}).`);
  };

  const handleImport = (e) => {
    setImportErr(null);
    setImportMsg(null);
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();

    if (f.name.endsWith(".xlsx") || f.name.endsWith(".xls")) {
      reader.onload = ev => {
        try {
          const wb = XLSX.read(ev.target.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          // Collect all non-empty cell values and find the JSON array
          const cells = Object.values(ws)
            .filter(cell => cell && cell.v !== undefined && typeof cell.v === "string")
            .map(cell => cell.v.trim())
            .filter(v => v.startsWith("[") || v.startsWith("{"));
          if (!cells.length) throw new Error("Hittade ingen JSON-data i filen.");
          // Try each candidate cell (handles both single-cell and multi-cell JSON)
          const jsonStr = cells.length === 1 ? cells[0] : cells.join("");
          mergeImported(JSON.parse(jsonStr));
        } catch (err) { setImportErr(`Importfel: ${err.message}`); }
      };
      reader.readAsArrayBuffer(f);
    } else {
      reader.onload = ev => {
        try { mergeImported(JSON.parse(ev.target.result)); }
        catch (err) { setImportErr(`Importfel: ${err.message}`); }
      };
      reader.readAsText(f);
    }
    e.target.value = "";
  };

  const alleStats = useMemo(() => {
    return KBANOR.map(kb => kbanaStats(obs, kb)).filter(Boolean);
  }, [obs]);

  const selStats = useMemo(() => {
    return selKbana ? kbanaStats(obs, selKbana) : null;
  }, [obs, selKbana]);

  const selObs = obs.filter(o => o.kbana === selKbana).slice().reverse();

  const f = (field, val) => setForm(prev => ({ ...prev, [field]: val }));

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">LEDTID</div>
          <h1 className="page-title">PF-Ledtidsmätning</h1>
          <div className="page-subtitle">
            Mät tid från mezz till plockplats. {obs.length} observationer totalt.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {legacyLocal.length > 0 && (
            <ActionButton onClick={importLegacyLocal} disabled={importing}>
              {importing ? "Importerar..." : "Importera min lokala historik"}
            </ActionButton>
          )}
          {obs.length > 0 && (
            <ActionButton onClick={handleExport}>Exportera JSON</ActionButton>
          )}
          <label style={{ cursor: "pointer", padding: "6px 12px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, color: C.textDim }}>
            Importera JSON / Excel
            <input ref={fileRef} type="file" accept=".json,.xlsx,.xls" className="visually-hidden-input" onChange={handleImport} />
          </label>
        </div>
      </div>

      {importErr && <Alert>{importErr}</Alert>}
      {importMsg && (
        <div style={{ padding: "8px 12px", marginBottom: 8, background: C.green + "18", border: `1px solid ${C.green}44`, borderRadius: 6, fontSize: 12, color: C.text }}>
          {importMsg}
        </div>
      )}

      {/* Registration form */}
      <Panel title="REGISTRERA NY OBSERVATION">
        {formErr && <Alert>{formErr}</Alert>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="ledtid-kbana">K-BANA</label>
            <select id="ledtid-kbana" value={form.kbana} onChange={e => f("kbana", e.target.value)} style={inputStyle}>
              {KBANOR.map(kb => <option key={kb} value={kb}>{kb}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="ledtid-systemtid">SYSTEMTID (valfri)</label>
            <input id="ledtid-systemtid" type="time" value={form.systemtid} onChange={e => f("systemtid", e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="ledtid-skickad">SKICKAD <span style={{ color: C.red }}>*</span></label>
            <input id="ledtid-skickad" type="time" value={form.skickad} onChange={e => f("skickad", e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="ledtid-klar">KLAR <span style={{ color: C.red }}>*</span></label>
            <input id="ledtid-klar" type="time" value={form.klar} onChange={e => f("klar", e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="ledtid-antal-kolli">ANTAL KOLLI</label>
            <input id="ledtid-antal-kolli" type="number" min="0" value={form.antalKolli} onChange={e => f("antalKolli", e.target.value)} placeholder="–" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="ledtid-orsak">ORSAK</label>
            <select id="ledtid-orsak" value={form.orsak} onChange={e => f("orsak", e.target.value)} style={inputStyle}>
              {ORSAKER.map(o => <option key={o} value={o}>{o || "–"}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle} htmlFor="ledtid-notering">NOTERING</label>
          <input id="ledtid-notering" type="text" value={form.notering} onChange={e => f("notering", e.target.value)} placeholder="Fritext…" style={{ ...inputStyle, width: "100%" }} />
        </div>

        {/* Live preview of calculated times */}
        {form.skickad && form.klar && (() => {
          const t = calcTider(form);
          if (!t) return null;
          return (
            <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12, color: C.textDim }}>
              <span>Transport: <strong style={{ color: C.text }}>{fmtMin(t.transportTid)}</strong></span>
              {t.mezzVantetid != null && <span>Mezz-väntan: <strong style={{ color: C.text }}>{fmtMin(t.mezzVantetid)}</strong></span>}
              {t.totalLedtid  != null && <span>Total: <strong style={{ color: C.text }}>{fmtMin(t.totalLedtid)}</strong></span>}
            </div>
          );
        })()}

        <ActionButton variant="secondary" onClick={handleAdd}>Registrera</ActionButton>
      </Panel>

      {/* Per-kbana stats */}
      {alleStats.length > 0 && (
        <Panel title="STATISTIK PER BANA">
          <div className="data-table-wrap">
            <table className="data-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>BANA</th>
                  <th className="is-right">OBS</th>
                  <th className="is-right">SNITT TRANSPORT</th>
                  <th className="is-right">MEDIAN</th>
                  <th className="is-right">MAX</th>
                  <th className="is-right">SNITT MEZZ</th>
                  <th className="is-right">SNITT TOTAL</th>
                  <th className="is-right">LARMNIVÅ</th>
                </tr>
              </thead>
              <tbody>
                {alleStats.map(s => {
                  const overLarm = s.larmniva && s.snittTransport > s.larmniva;
                  return (
                    <tr key={s.kbana}
                      onClick={() => setSelKbana(selKbana === s.kbana ? null : s.kbana)}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelKbana(selKbana === s.kbana ? null : s.kbana); } }}
                      role="button" tabIndex={0} aria-pressed={selKbana === s.kbana}
                      style={{ cursor: "pointer", borderBottom: `1px solid ${C.border}`, background: selKbana === s.kbana ? C.panelRaised : "transparent" }}>
                      <td className="primary-cell" style={{ fontWeight: 700 }}>{s.kbana}</td>
                      <td className="is-right mono-cell" style={{ color: C.dim }}>{s.n}</td>
                      <td className="is-right mono-cell" style={{ color: overLarm ? C.red : C.text, fontWeight: overLarm ? 700 : 400 }}>
                        {fmtMin(Math.round(s.snittTransport))}
                      </td>
                      <td className="is-right mono-cell">{fmtMin(Math.round(s.medianTransport))}</td>
                      <td className="is-right mono-cell" style={{ color: C.textDim }}>{fmtMin(s.maxTransport)}</td>
                      <td className="is-right mono-cell" style={{ color: C.textDim }}>{s.snittMezz != null ? fmtMin(Math.round(s.snittMezz)) : "–"}</td>
                      <td className="is-right mono-cell" style={{ color: C.textDim }}>{s.snittTotal != null ? fmtMin(Math.round(s.snittTotal)) : "–"}</td>
                      <td className="is-right mono-cell" style={{ color: s.larmniva ? C.yellow : C.dim }}>
                        {s.larmniva ? fmtMin(s.larmniva) : "–"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: C.dim, padding: "6px 12px" }}>
            Larmnivå = median × 2,5 avrundat till närmaste 5 min · Klicka på bana för detaljer
          </div>
        </Panel>
      )}

      {/* Detail view for selected kbana */}
      {selKbana && selStats && (
        <Panel title={`OBSERVATIONER — ${selKbana}`}>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", padding: "8px 0 12px", borderBottom: `1px solid ${C.border}`, marginBottom: 10 }}>
            {[
              { l: "Observationer", v: selStats.n },
              { l: "Snitt transport", v: fmtMin(Math.round(selStats.snittTransport)) },
              { l: "Median transport", v: fmtMin(Math.round(selStats.medianTransport)) },
              { l: "Max transport", v: fmtMin(selStats.maxTransport) },
              ...(selStats.snittMezz  != null ? [{ l: "Snitt mezz-väntan", v: fmtMin(Math.round(selStats.snittMezz)) }] : []),
              ...(selStats.snittTotal != null ? [{ l: "Snitt total", v: fmtMin(Math.round(selStats.snittTotal)) }] : []),
              ...(selStats.tidPerKolli != null ? [{ l: "Tid/kolli", v: fmtMin(Math.round(selStats.tidPerKolli)) }] : []),
              ...(selStats.larmniva   != null ? [{ l: "Larmnivå", v: fmtMin(selStats.larmniva) }] : []),
            ].map(({ l, v }) => (
              <div key={l}>
                <div style={{ fontSize: 10, color: C.dim, marginBottom: 2 }}>{l.toUpperCase()}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead style={{ position: "sticky", top: 0, background: C.panel }}>
                <tr style={{ color: C.dim, fontSize: 10 }}>
                  <th style={{ padding: "4px 8px", textAlign: "left" }}>DATUM</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>SKICKAD</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>KLAR</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>TRANSPORT</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>MEZZ</th>
                  <th style={{ padding: "4px 8px", textAlign: "right" }}>TOTAL</th>
                  <th style={{ padding: "4px 8px", textAlign: "left" }}>ORSAK</th>
                  <th style={{ padding: "4px 8px" }}></th>
                </tr>
              </thead>
              <tbody>
                {selObs.map(o => {
                  const t = calcTider(o);
                  const larm = selStats.larmniva;
                  const overLarm = larm && t && t.transportTid > larm;
                  return (
                    <tr key={o.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "5px 8px", color: C.dim }}>{o.datum}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{o.skickad}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{o.klar}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: overLarm ? C.red : C.text, fontWeight: overLarm ? 700 : 400 }}>
                        {t ? fmtMin(t.transportTid) : "–"}
                      </td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: C.textDim, fontVariantNumeric: "tabular-nums" }}>
                        {t?.mezzVantetid != null ? fmtMin(t.mezzVantetid) : "–"}
                      </td>
                      <td style={{ padding: "5px 8px", textAlign: "right", color: C.textDim, fontVariantNumeric: "tabular-nums" }}>
                        {t?.totalLedtid != null ? fmtMin(t.totalLedtid) : "–"}
                      </td>
                      <td style={{ padding: "5px 8px", color: C.dim }}>{o.orsak || ""}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right" }}>
                        <button onClick={() => handleDelete(o.id)}
                          style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 14, padding: "0 4px" }}
                          title="Ta bort">×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {obs.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: C.dim }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏱</div>
          <div style={{ fontSize: 14 }}>Inga observationer ännu.</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Registrera en körning ovan eller importera en JSON-fil.</div>
        </div>
      )}
    </div>
  );
}

const labelStyle = {
  display: "block", fontSize: 10, color: "var(--dim)", letterSpacing: "0.07em",
  marginBottom: 4, fontWeight: 600,
};

const inputStyle = {
  width: "100%", padding: "6px 8px", fontSize: 13,
  background: "var(--surface)", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 6, outline: "none",
};
