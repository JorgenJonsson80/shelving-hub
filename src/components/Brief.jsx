import { useState } from "react";
import * as XLSX from "xlsx";
import { C, shadow } from "../shared/theme";
import { PrestBar, BedomingPill, GapChip } from "../shared/components";
import { parseDailyRows } from "../shared/parseDailyRows";

function parseDailyFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets["Daily"];
        if (!sheet) throw new Error("Ingen Daily-flik");
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        const rows = parseDailyRows(raw);

        const statsSheet = wb.Sheets["stats"];
        const scanRates = {};
        let grandTotal = null;
        if (statsSheet) {
          const sraw = XLSX.utils.sheet_to_json(statsSheet, { header: 1, defval: "" });
          for (const row of sraw) {
            if (row[0] === "Grand Total") { grandTotal = +row[1]; break; }
            const val = row[1];
            if (typeof val === "number" && val > 0 && val <= 1 && row[0] !== "") {
              scanRates[String(row[0]).trim()] = val;
            }
          }
        }

        resolve({ rows, scanRates, grandTotal, fileName: file.name });
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function getScanRate(kbana, scanRates) {
  const stripped = String(kbana).replace(/^K/, "").trim();
  const candidates = [stripped, stripped.replace(/-/g, " "), stripped.replace(/-/g, "")];
  for (const k of candidates) {
    if (scanRates[k] != null) return scanRates[k];
  }
  return null;
}

export default function Brief() {
  const [parsed, setParsed] = useState(null);
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [drag, setDrag] = useState(false);

  const handleFile = (f) => {
    setErr(null); setParsed(null); setBrief(null);
    parseDailyFile(f).then(setParsed).catch(e => setErr(e.message));
  };

  const generateBrief = () => {
    if (!parsed) return;
    setLoading(true); setBrief(null);

    const banorText = parsed.rows.map(r =>
      r.kbana + ": Pers=" + r.pers +
      ", Gap=" + r.gap.toFixed(2) + "h" +
      ", Status=" + r.status +
      ", Prest=" + (r.prest * 100).toFixed(1) + "%" +
      ", Kolli=" + r.kolli +
      ", Kart=" + r.kart +
      ", Scan=" + (r.scannat != null ? (r.scannat * 100).toFixed(0) + "%" : "okand") +
      ", Bedomning=" + (r.bedoming || "-")
    ).join("\n");

    const prompt = "Du ar operativ analytiker pa ett svensk lager. Analysera gardagens shelving-data och ge en kort direkt morgenbriefing pa svenska.\n\nPer bana:\n" + banorText + "\n\nGrand total scan: " + (parsed.grandTotal ? (parsed.grandTotal * 100).toFixed(0) + "%" : "okand") + "\n\nScan-rate och prestation ar SEPARATA matt. Under 75% = lag, under 60% = kritisk. Bedomning kombinerar status och scan-rate.\n\nGe: 1) Lagestord 2) Kritiska banor 3) Overskott 4) Scan-avvikelser 5) Rekommendation. Max 280 ord. Kort och direkt.";

    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    })
      .then(r => r.json())
      .then(d => {
        setBrief(d.content?.map(b => b.text || "").join("") || "Inget svar.");
        setLoading(false);
      })
      .catch(e => { setErr("API-fel: " + e.message); setLoading(false); });
  };

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">Daily Brief</div>
          <h1 className="page-title">Morgonanalys</h1>
          <div className="page-subtitle">Summera gårdagens volym, prestation, gap och scan-avvikelser per bana.</div>
        </div>
      </div>

      {err && (
        <div style={{ color: C.red, background: C.red + "12", border: "1px solid " + C.red + "44", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, boxShadow: shadow.sm }}>
          {err}
        </div>
      )}

      {!parsed && (
        <label
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          className={"dropzone" + (drag ? " is-dragging" : "")}
        >
          <div className="dropzone__icon">B</div>
          <div className="dropzone__title">Släpp Daily-filen här</div>
          <div className="dropzone__subtitle">NTR Daily Shelving .xlsx</div>
          <input type="file" accept=".xlsx" style={{ display: "none" }}
            onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
        </label>
      )}

      {parsed && (
        <div style={{ animation: "fade-up 0.25s ease" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
            {[
              { l: "PERS", v: parsed.rows.reduce((s, r) => s + r.pers, 0).toFixed(1) },
              { l: "KOLLI", v: parsed.rows.reduce((s, r) => s + r.kolli, 0) },
              { l: "KARTONGER", v: parsed.rows.reduce((s, r) => s + r.kart, 0) },
              { l: "SCAN TOTALT", v: parsed.grandTotal ? (parsed.grandTotal * 100).toFixed(0) + "%" : "-" },
            ].map(s => (
              <div key={s.l} style={{ background: C.panel, border: "1px solid " + C.border, borderRadius: 10, padding: "12px 16px", boxShadow: shadow.card }}>
                <div style={{ fontSize: 9, color: C.dim, letterSpacing: 2, marginBottom: 6, fontWeight: 600 }}>{s.l}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: C.white, fontFamily: "sans-serif" }}>{s.v}</div>
              </div>
            ))}
          </div>

          <div style={{ background: C.panel, border: "1px solid " + C.border, borderRadius: 12, overflow: "hidden", marginBottom: 16, boxShadow: shadow.card }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                  {["BANA","PERS","KOLLI","KART","PREST","GAP","SCAN","BEDOMNING"].map(h => (
                    <th key={h} style={{ padding: "10px 12px", textAlign: h === "BANA" ? "left" : "right", fontSize: 9, letterSpacing: 1.5, color: C.dim, fontWeight: 700, borderBottom: "1px solid " + C.border2 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.map((r, i) => {
                  const scanRate = r.scannat != null ? r.scannat : getScanRate(r.kbana, parsed.scanRates);
                  const scanPct = scanRate != null ? Math.round(scanRate * 100) : null;
                  const scanColor = scanPct == null ? C.dim : scanPct < 20 ? C.dim : scanPct < 60 ? C.red : scanPct < 75 ? C.yellow : C.green;
                  return (
                    <tr key={i} style={{ borderBottom: i < parsed.rows.length - 1 ? "1px solid " + C.border : "none", transition: "background 0.1s" }}
                      onMouseEnter={e => e.currentTarget.style.background = C.surface}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <td style={{ padding: "9px 12px", fontWeight: 700, color: C.white, fontFamily: "sans-serif" }}>{r.kbana}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "monospace", color: C.textDim }}>{r.pers}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "monospace" }}>{r.kolli}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "monospace" }}>{r.kart}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right" }}><PrestBar prest={r.prest} /></td>
                      <td style={{ padding: "9px 12px", textAlign: "right" }}><GapChip gap={r.gap} /></td>
                      <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "monospace", color: scanColor, fontWeight: scanPct !== null && scanPct < 75 ? 700 : 400 }}>
                        {scanPct != null ? scanPct + "%" : "-"}
                      </td>
                      <td style={{ padding: "9px 12px", textAlign: "right" }}>
                        <BedomingPill text={r.bedoming} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!brief && (
            <button onClick={generateBrief} disabled={loading}
              style={{
                width: "100%", background: loading ? C.surface : C.accent,
                color: loading ? C.textDim : "#000",
                border: "1px solid " + (loading ? C.border : "transparent"),
                borderRadius: 10, padding: 14, fontSize: 13, fontWeight: 800,
                fontFamily: "monospace", cursor: loading ? "not-allowed" : "pointer",
                marginBottom: 12, transition: "all 0.2s ease",
                opacity: loading ? 0.7 : 1,
              }}>
              {loading ? "Analyserar..." : "Generera morgonbriefing"}
            </button>
          )}

          {brief && (
            <div style={{ background: C.panel, border: "1px solid " + C.accent + "44", borderRadius: 12, padding: 20, marginBottom: 12, boxShadow: shadow.card, animation: "fade-up 0.3s ease" }}>
              <div style={{ fontSize: 9, color: C.accent, letterSpacing: 3, marginBottom: 14, fontWeight: 700 }}>AI-ANALYS</div>
              <div style={{ fontSize: 13, lineHeight: 1.9, color: C.text, whiteSpace: "pre-wrap", fontFamily: "sans-serif" }}>{brief}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 16, paddingTop: 14, borderTop: "1px solid " + C.border }}>
                <button onClick={generateBrief}
                  style={{ background: "transparent", border: "1px solid " + C.border, color: C.textDim, borderRadius: 6, padding: "7px 14px", fontSize: 12, fontFamily: "monospace", cursor: "pointer", transition: "border-color 0.15s, color 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.textDim; e.currentTarget.style.color = C.text; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textDim; }}>
                  Ny analys
                </button>
                <button onClick={() => { setParsed(null); setBrief(null); }}
                  style={{ background: "transparent", border: "1px solid " + C.border, color: C.textDim, borderRadius: 6, padding: "7px 14px", fontSize: 12, fontFamily: "monospace", cursor: "pointer", transition: "border-color 0.15s, color 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = C.textDim; e.currentTarget.style.color = C.text; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textDim; }}>
                  Ny fil
                </button>
              </div>
            </div>
          )}

          {!brief && (
            <button onClick={() => { setParsed(null); setBrief(null); }}
              style={{ background: "transparent", border: "1px solid " + C.border, color: C.dim, borderRadius: 6, padding: "8px 14px", fontSize: 12, fontFamily: "monospace", cursor: "pointer", transition: "border-color 0.15s, color 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.textDim; e.currentTarget.style.color = C.text; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.dim; }}>
              Ny fil
            </button>
          )}
        </div>
      )}
    </div>
  );
}
