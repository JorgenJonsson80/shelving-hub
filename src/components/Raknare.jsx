import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { C } from "../shared/theme";

const KBANA_LIST = ["K51","K52","K53","K55","K56","K58","K59","K60","K61-7","K61-36","K62","K63"];

function classifyLocation(loc) {
  if (!loc || typeof loc !== "string") return null;
  const s = loc.trim().toUpperCase();
  if (s.startsWith("PD")) return "K62";
  if (s.startsWith("PH")) return "K63";
  if (!/^P\d/.test(s)) return null;
  const stn = parseInt(s.substring(3, 5), 10);
  if (isNaN(stn)) return null;
  const afterDash = s.split("-")[1] || "";
  const lplMatch = afterDash.match(/^(\d+)/);
  const lpl = lplMatch ? parseInt(lplMatch[1], 10) : null;
  const lastDigit = lpl !== null ? lpl % 10 : null;
  const isEven = lastDigit !== null && lastDigit % 2 === 0;
  const isOdd = lastDigit !== null && lastDigit % 2 === 1;
  const t7 = s[6], t8 = s[7], t10 = s[9], t11 = s[10];
  const t1011 = (t10 || "") + (t11 || "");
  if (s.startsWith("P3")) {
    const t7d = /[0-9]/.test(t7 || "");
    const n = parseInt(t1011, 10);
    if (t7d || t8 === "A" || (t8 === "B" && !isNaN(n) && n >= 1 && n <= 13)) return "K55";
  }
  if (stn === 36) return "K61-36";
  if (s.startsWith("P101")) {
    if (isEven) return "K51";
    if (isOdd && stn >= 10 && stn <= 14) return "K52";
    if (isOdd && stn >= 15 && stn <= 18) return "K53";
  }
  if (s.startsWith("P102")) {
    if (isEven) return "K56";
    if (isOdd && stn >= 20 && stn <= 23) return "K53";
    if (isOdd && stn >= 24 && stn <= 27) return "K52";
  }
  if (s.startsWith("P4")) { if (isEven) return "K58"; if (isOdd) return "K56"; }
  if (s.startsWith("P6")) {
    if (isEven) return "K58";
    if (isOdd && stn >= 60 && stn <= 67) {
      if (lpl !== null) { if (lpl <= 43) return "K60"; if (lpl >= 45) return "K59"; }
    }
  }
  if (s.startsWith("P7")) {
    if (isEven) return "K61-7";
    if (isOdd && stn >= 71 && stn <= 77) {
      if (lpl !== null) { if (lpl <= 81) return "K59"; if (lpl >= 83) return "K60"; }
    }
  }
  return null;
}

function mapInfattningKbana(rawK, line) {
  const k = String(rawK).trim().toUpperCase();
  const l = String(line).trim();
  if (l === "KG" || l === "KYL") return null;
  if (k === "VA") return "K58";
  if (k === "61 7" || k === "617") return "K61-7";
  if (k === "61 36" || k === "6136") return "K61-36";
  if (k === "61" && l === "Stn 36") return "K61-36";
  if (k === "61" && l === "Line 7") return "K61-7";
  return "K" + k.replace(/\s/g, "");
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function Section({ title, children }) {
  return (
    <div className="section-card">
      <div className="section-card__header">{title}</div>
      <div className="section-card__body">{children}</div>
    </div>
  );
}

function DropLabel({ id, title, subtitle, onFile }) {
  const [drag, setDrag] = useState(false);
  return (
    <label htmlFor={id}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className={"dropzone" + (drag ? " is-dragging" : "")}
      style={{ minHeight: 150, padding: "30px 16px" }}>
      <div className="dropzone__title">{title}</div>
      <div className="dropzone__subtitle">{subtitle}</div>
      <input id={id} type="file" accept=".xlsx" style={{ display: "none" }}
        onChange={e => { if (e.target.files[0]) onFile(e.target.files[0]); }} />
    </label>
  );
}

export default function Raknare() {
  const [pallRaw, setPallRaw] = useState(null);
  const [locCol, setLocCol] = useState(() => localStorage.getItem("e1_loc_col") || "");
  const [vnrCol, setVnrCol] = useState(() => localStorage.getItem("e1_vnr_col") || "");
  const [manualK, setManualK] = useState({});
  const [infattning, setInfattning] = useState(null);
  const [userScan, setUserScan] = useState(null);
  const [threshold, setThreshold] = useState(10);
  const [pallTextVisible, setPallTextVisible] = useState(false);
  const [infTextVisible, setInfTextVisible] = useState(false);
  const [userTextVisible, setUserTextVisible] = useState(false);

  const handlePallFile = (f) => {
    readFile(f).then(buf => {
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (!rows.length) return;
      setPallRaw({ rows, columns: Object.keys(rows[0]), total: rows.length });
      setManualK({});
    }).catch(console.error);
  };

  const handleInfattningFile = (f) => {
    readFile(f).then(buf => {
      const wb = XLSX.read(buf, { type: "array" });

      // Format A: Sheet1 med headers
      const sheet1 = wb.Sheets["Sheet1"];
      if (sheet1) {
        const rows = XLSX.utils.sheet_to_json(sheet1, { defval: "" });
        if (rows.length > 0) {
          const keys = Object.keys(rows[0]);
          const kollinKey = keys.find(k => k.toLowerCase().includes("kollin") || k.toLowerCase().includes("antal"));
          const typKey = keys.find(k => k.toLowerCase().includes("shelvad"));
          const kbanaKey = keys.find(k => k.toLowerCase().includes("k-bana") || k.toLowerCase().includes("bana"));
          const lineKey = keys.find(k => k.toLowerCase().includes("line") || k.toLowerCase().includes("stn"));
          if (typKey && kbanaKey) {
            const valid = [];
            for (const r of rows) {
              const kollin = parseInt(r[kollinKey] || 1, 10);
              const typRaw = String(r[typKey] || "").trim();
              const rawK = String(r[kbanaKey] || "").trim();
              const line = lineKey ? String(r[lineKey] || "").trim() : "";
              let typ;
              if (typRaw === "Shelvad av scanner") typ = "scanner";
              else if (typRaw === "Shelvad av E1") typ = "e1";
              else continue;
              const kbana = mapInfattningKbana(rawK, line);
              if (!kbana) continue;
              valid.push({ kollin: isNaN(kollin) ? 1 : kollin, typ, kbana });
            }
            setInfattning({ rows: valid, total: rows.length });
            return;
          }
        }
      }

      // Format B: Sheet3 utan headers
      const sheetName = wb.SheetNames.find(n => n === "Sheet3") || wb.SheetNames[1] || wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", header: 1 });
      const valid = [];
      for (const r of rows) {
        const kollin = parseInt(r[1], 10);
        const typRaw = String(r[4] || "").trim();
        const rawK = String(r[6] || "").trim();
        const line = String(r[7] || "").trim();
        if (isNaN(kollin) || !typRaw || !rawK) continue;
        let typ;
        if (typRaw === "Shelvad av scanner") typ = "scanner";
        else if (typRaw === "Shelvad av E1") typ = "e1";
        else continue;
        const kbana = mapInfattningKbana(rawK, line);
        if (!kbana) continue;
        valid.push({ kollin, typ, kbana });
      }
      setInfattning({ rows: valid, total: rows.length });
    }).catch(console.error);
  };

  const handleUserFile = (f) => {
    readFile(f).then(buf => {
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (!rows.length) return;
      const keys = Object.keys(rows[0]);
      const locKey = keys.find(k => /to\s*location/i.test(k));
      const userKey = keys.find(k => /butema\s*user/i.test(k));
      if (!locKey || !userKey) return;
      const valid = rows.map(r => {
        const loc = String(r[locKey] || "").trim();
        const user = String(r[userKey] || "").trim();
        if (!loc || !user) return null;
        const kbana = classifyLocation(loc);
        return kbana ? { user, kbana } : null;
      }).filter(Boolean);
      setUserScan({ rows: valid, total: rows.length });
    }).catch(console.error);
  };

  const pallRows = useMemo(() => {
    if (!pallRaw || !locCol) return null;
    return pallRaw.rows.map((r, i) => {
      const to = String(r[locCol] || "").trim();
      const vnr = vnrCol ? String(r[vnrCol] || "").trim() : "";
      const isP = /^P[A-Z\d]/i.test(to);
      const isNum = /^\d{4,}$/.test(to);
      let kbana = null;
      if (isP) kbana = classifyLocation(to);
      else if (isNum) kbana = manualK[i] || null;
      return { to, vnr, kbana, isP, isNum, index: i };
    }).filter(r => r.to);
  }, [pallRaw, locCol, vnrCol, manualK]);

  const pallSummary = useMemo(() => {
    if (!pallRows) return null;
    const counts = {};
    const unassigned = [];
    for (const r of pallRows) {
      if (r.kbana) counts[r.kbana] = (counts[r.kbana] || 0) + 1;
      else if (r.isNum) unassigned.push(r);
    }
    return { counts, unassigned };
  }, [pallRows]);

  const infattningSummary = useMemo(() => {
    if (!infattning) return null;
    const counts = {};
    let tAnv = 0, tE1 = 0, tKart = 0;
    for (const r of infattning.rows) {
      if (!counts[r.kbana]) counts[r.kbana] = { idAnv: 0, idE1: 0, kart: 0 };
      if (r.typ === "scanner") { counts[r.kbana].idAnv++; tAnv++; }
      else { counts[r.kbana].idE1++; tE1++; }
      counts[r.kbana].kart += r.kollin; tKart += r.kollin;
    }
    return { counts, tAnv, tE1, tKart };
  }, [infattning]);

  const userSummary = useMemo(() => {
    if (!userScan) return null;
    const perUser = {}, perK = {};
    for (const r of userScan.rows) {
      perUser[r.user] = (perUser[r.user] || 0) + 1;
      if (!perK[r.kbana]) perK[r.kbana] = {};
      perK[r.kbana][r.user] = (perK[r.kbana][r.user] || 0) + 1;
    }
    const userList = Object.entries(perUser).map(([u, t]) => ({ u, t })).sort((a, b) => b.t - a.t);
    const kList = Object.entries(perK).map(([kbana, users]) => {
      const arr = Object.entries(users).map(([u, c]) => ({ u, c })).sort((a, b) => b.c - a.c);
      return { kbana, aktiva: arr.filter(x => x.c > threshold), drops: arr.filter(x => x.c <= threshold), tot: arr.reduce((s, x) => s + x.c, 0) };
    }).sort((a, b) => a.kbana.localeCompare(b.kbana));
    return { userList, kList, total: userScan.rows.length };
  }, [userScan, threshold]);

  const pallText = useMemo(() => {
    if (!pallSummary) return "";
    const lines = ["K-bana\tHelpallar"];
    KBANA_LIST.forEach(k => lines.push(k + "\t" + (pallSummary.counts[k] || 0)));
    const total = KBANA_LIST.reduce((s, k) => s + (pallSummary.counts[k] || 0), 0);
    lines.push("Totalt\t" + total);
    return lines.join("\n");
  }, [pallSummary]);

  const infText = useMemo(() => {
    if (!infattningSummary) return "";
    const lines = ["K-bana\tID Anv\tID E1\t% Scan\tKartonger"];
    KBANA_LIST.forEach(k => {
      const c = infattningSummary.counts[k];
      if (!c) return;
      const tot = c.idAnv + c.idE1;
      const pct = tot > 0 ? Math.round(c.idAnv / tot * 100) : 0;
      lines.push(k + "\t" + c.idAnv + "\t" + c.idE1 + "\t" + pct + "%\t" + c.kart);
    });
    const totId = infattningSummary.tAnv + infattningSummary.tE1;
    const totPct = totId > 0 ? Math.round(infattningSummary.tAnv / totId * 100) : 0;
    lines.push("Totalt\t" + infattningSummary.tAnv + "\t" + infattningSummary.tE1 + "\t" + totPct + "%\t" + infattningSummary.tKart);
    return lines.join("\n");
  }, [infattningSummary]);

  const userText = useMemo(() => {
    if (!userSummary) return "";
    const lines = ["#\tAnvändare\tScans\tStatus"];
    userSummary.userList.forEach((u, i) => {
      lines.push((i + 1) + "\t" + u.u + "\t" + u.t + "\t" + (u.t > threshold ? "Aktiv" : "Drop-in"));
    });
    return lines.join("\n");
  }, [userSummary, threshold]);

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">Räknare</div>
          <h1 className="page-title">Pallar - Infattning - Bemanning</h1>
          <div className="page-subtitle">Tre snabba verktyg för att räkna volym, scan-andel och bemanning från Excel-utdrag.</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>

        {/* ── PALLAR ── */}
        <Section title="HELPALLAR PER K-BANA">
          {!pallRaw ? (
            <DropLabel id="pallFile" title="E1 Pall-utdrag" subtitle=".xlsx" onFile={handlePallFile} />
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <select value={locCol} onChange={e => { setLocCol(e.target.value); localStorage.setItem("e1_loc_col", e.target.value); }}
                  style={{ flex: 1, background: C.bg, color: C.text, border: "1px solid " + C.border, borderRadius: 4, padding: "5px 8px", fontSize: 11, fontFamily: "monospace" }}>
                  <option value="">Lagerplats...</option>
                  {pallRaw.columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={vnrCol} onChange={e => { setVnrCol(e.target.value); localStorage.setItem("e1_vnr_col", e.target.value); }}
                  style={{ flex: 1, background: C.bg, color: C.text, border: "1px solid " + C.border, borderRadius: 4, padding: "5px 8px", fontSize: 11, fontFamily: "monospace" }}>
                  <option value="">VNR (valfritt)</option>
                  {pallRaw.columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {pallSummary && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 8 }}>
                  {KBANA_LIST.map(k => (
                    <div key={k} style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: 5, padding: "5px 10px", display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: C.textDim }}>{k}</span>
                      <span style={{ fontFamily: "monospace", fontWeight: 700, color: pallSummary.counts[k] ? C.text : C.dim }}>{pallSummary.counts[k] || 0}</span>
                    </div>
                  ))}
                </div>
              )}

              {pallSummary && (
                <>
                  <button onClick={() => setPallTextVisible(v => !v)}
                    style={{ background: "transparent", border: "1px solid " + C.accent + "66", color: C.accent, borderRadius: 4, padding: "3px 10px", fontSize: 10, fontFamily: "monospace", cursor: "pointer", marginBottom: 6 }}>
                    {pallTextVisible ? "Dölj text" : "Visa text"}
                  </button>
                  {pallTextVisible && (
                    <textarea readOnly value={pallText} onClick={e => e.target.select()}
                      style={{ width: "100%", height: 100, background: C.bg, color: C.text, border: "1px solid " + C.accent + "44", borderRadius: 6, padding: 8, fontSize: 10, fontFamily: "monospace", resize: "vertical", marginBottom: 8, boxSizing: "border-box" }} />
                  )}
                </>
              )}

              {pallSummary?.unassigned?.length > 0 && (
                <div style={{ background: C.yellow + "10", border: "1px solid " + C.yellow + "33", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: C.yellow, marginBottom: 8, fontWeight: 700 }}>Crisplant ({pallSummary.unassigned.length}) - valj K-bana:</div>
                  {pallSummary.unassigned.map(r => (
                    <div key={r.index} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 10, color: C.textDim, flex: 1 }}>{r.vnr || r.to}</span>
                      <select value={manualK[r.index] || ""} onChange={e => setManualK({ ...manualK, [r.index]: e.target.value })}
                        style={{ background: C.bg, color: C.text, border: "1px solid " + C.border, borderRadius: 4, padding: "3px 6px", fontSize: 10, fontFamily: "monospace" }}>
                        <option value="">K-bana...</option>
                        {KBANA_LIST.map(k => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => { setPallRaw(null); setManualK({}); setPallTextVisible(false); }}
                style={{ background: "transparent", border: "1px solid " + C.border, color: C.dim, borderRadius: 5, padding: "5px 10px", fontSize: 10, fontFamily: "monospace", cursor: "pointer" }}>
                Ny fil
              </button>
            </>
          )}
        </Section>

        {/* ── INFATTNING ── */}
        <Section title="INFATTNING">
          {!infattning ? (
            <DropLabel id="infattningFile" title="Infattning Statistik" subtitle=".xlsx" onFile={handleInfattningFile} />
          ) : (
            <>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginBottom: 8 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid " + C.border2 }}>
                    {["K-BANA","ID ANV","ID E1","% SCAN","KART"].map(h => (
                      <th key={h} style={{ padding: "5px 8px", textAlign: h === "K-BANA" ? "left" : "right", fontSize: 9, color: C.dim, fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {KBANA_LIST.map(k => {
                    const c = infattningSummary?.counts?.[k];
                    if (!c) return null;
                    const tot = c.idAnv + c.idE1;
                    const pct = tot > 0 ? Math.round(c.idAnv / tot * 100) : 0;
                    const pc = pct >= 75 ? C.green : pct >= 60 ? C.yellow : C.red;
                    return (
                      <tr key={k} style={{ borderBottom: "1px solid " + C.border + "40" }}>
                        <td style={{ padding: "5px 8px", fontWeight: 700, color: C.white }}>{k}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>{c.idAnv}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", color: C.textDim }}>{c.idE1}</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", color: pc, fontWeight: 700 }}>{pct}%</td>
                        <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>{c.kart}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div style={{ fontSize: 10, color: C.dim, marginBottom: 8 }}>
                {infattningSummary?.tAnv} scanner - {infattningSummary?.tE1} E1 - {infattningSummary?.tKart} kart
              </div>

              <button onClick={() => setInfTextVisible(v => !v)}
                style={{ background: "transparent", border: "1px solid " + C.accent + "66", color: C.accent, borderRadius: 4, padding: "3px 10px", fontSize: 10, fontFamily: "monospace", cursor: "pointer", marginBottom: 6 }}>
                {infTextVisible ? "Dölj text" : "Visa text"}
              </button>
              {infTextVisible && (
                <textarea readOnly value={infText} onClick={e => e.target.select()}
                  style={{ width: "100%", height: 120, background: C.bg, color: C.text, border: "1px solid " + C.accent + "44", borderRadius: 6, padding: 8, fontSize: 10, fontFamily: "monospace", resize: "vertical", marginBottom: 8, boxSizing: "border-box" }} />
              )}

              <button onClick={() => { setInfattning(null); setInfTextVisible(false); }}
                style={{ background: "transparent", border: "1px solid " + C.border, color: C.dim, borderRadius: 5, padding: "5px 10px", fontSize: 10, fontFamily: "monospace", cursor: "pointer" }}>
                Ny fil
              </button>
            </>
          )}
        </Section>

        {/* ── BEMANNING ── */}
        <Section title="BEMANNING">
          {!userScan ? (
            <DropLabel id="userFile" title="Användarscan" subtitle=".xlsx - Butema User + To Location" onFile={handleUserFile} />
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 11, color: C.textDim }}>Tröskel:</span>
                <input type="range" min="1" max="50" value={threshold} onChange={e => setThreshold(+e.target.value)}
                  style={{ flex: 1, accentColor: C.accent }} />
                <span style={{ fontFamily: "monospace", color: C.accent, fontWeight: 700, minWidth: 24 }}>{threshold}</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                {userSummary?.kList.map(kb => (
                  <div key={kb.kbana} style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: 7, padding: "10px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, color: C.white, fontSize: 12 }}>{kb.kbana}</span>
                      <span style={{ fontSize: 11, color: C.accent }}>
                        <strong>{kb.aktiva.length}</strong>
                        <span style={{ color: C.dim }}> pers - {kb.tot} scans</span>
                      </span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {kb.aktiva.map(u => (
                        <span key={u.u} style={{ background: C.green + "20", color: C.green, border: "1px solid " + C.green + "44", borderRadius: 3, padding: "2px 7px", fontSize: 10, fontFamily: "monospace" }}>
                          {u.u}: {u.c}
                        </span>
                      ))}
                      {kb.drops.map(u => (
                        <span key={u.u} style={{ color: C.dim, border: "1px solid " + C.border, borderRadius: 3, padding: "2px 7px", fontSize: 10, fontFamily: "monospace" }}>
                          {u.u}: {u.c}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 10, color: C.dim, marginBottom: 8 }}>
                {userSummary?.userList.length} unika - {userSummary?.total} scans
              </div>

              <div style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 9, color: C.dim, letterSpacing: 2, fontWeight: 700 }}>TOPPLISTA</div>
                  <button onClick={() => setUserTextVisible(v => !v)}
                    style={{ background: "transparent", border: "1px solid " + C.accent + "66", color: C.accent, borderRadius: 4, padding: "3px 10px", fontSize: 10, fontFamily: "monospace", cursor: "pointer" }}>
                    {userTextVisible ? "Dölj text" : "Visa text"}
                  </button>
                </div>
                {userTextVisible && (
                  <textarea readOnly value={userText} onClick={e => e.target.select()}
                    style={{ width: "100%", height: 120, background: C.bg, color: C.text, border: "1px solid " + C.accent + "44", borderRadius: 6, padding: 8, fontSize: 10, fontFamily: "monospace", resize: "vertical", marginBottom: 8, boxSizing: "border-box" }} />
                )}
                <div style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: 7, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 60px", padding: "5px 10px", borderBottom: "1px solid " + C.border2, fontSize: 9, color: C.dim, fontWeight: 700 }}>
                    <span>#</span><span>ANVÄNDARE</span><span style={{ textAlign: "right" }}>SCANS</span>
                  </div>
                  {userSummary?.userList.map((u, i) => (
                    <div key={u.u} style={{ display: "grid", gridTemplateColumns: "24px 1fr 60px", padding: "5px 10px", borderBottom: i < userSummary.userList.length - 1 ? "1px solid " + C.border + "40" : "none", background: i % 2 === 0 ? "transparent" : C.bg + "60", alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: C.dim, fontFamily: "monospace" }}>{i + 1}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: u.t > threshold ? C.text : C.textDim }}>{u.u}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: u.t > threshold ? C.green : C.dim, textAlign: "right" }}>{u.t}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={() => { setUserScan(null); setUserTextVisible(false); }}
                style={{ background: "transparent", border: "1px solid " + C.border, color: C.dim, borderRadius: 5, padding: "5px 10px", fontSize: 10, fontFamily: "monospace", cursor: "pointer" }}>
                Ny fil
              </button>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}
