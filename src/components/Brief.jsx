import { useState } from "react";
import * as XLSX from "xlsx";
import { C } from "../shared/theme";
import {
  ActionButton,
  Alert,
  BedomingPill,
  DataTable,
  Dropzone,
  GapChip,
  MetricCard,
  MetricGrid,
  PageHeader,
  Panel,
  PrestBar,
} from "../shared/components";
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
      <PageHeader
        eyebrow="Daily Brief"
        title="Morgonanalys"
        subtitle="Summera gårdagens volym, prestation, gap och scan-avvikelser per bana."
      />

      {err && <Alert>{err}</Alert>}

      {!parsed && (
        <div
          onDragEnter={() => setDrag(true)}
          onDragLeave={() => setDrag(false)}
          onDrop={() => setDrag(false)}
        >
          <Dropzone
            icon="B"
            title="Släpp Daily-filen här"
            subtitle="NTR Daily Shelving .xlsx"
            dragging={drag}
            onFile={handleFile}
          />
        </div>
      )}

      {parsed && (
        <div className="anim-fade-up">
          <MetricGrid columns={4}>
            {[
              { l: "PERS", v: parsed.rows.reduce((s, r) => s + r.pers, 0).toFixed(1) },
              { l: "KOLLI", v: parsed.rows.reduce((s, r) => s + r.kolli, 0) },
              { l: "KARTONGER", v: parsed.rows.reduce((s, r) => s + r.kart, 0) },
              { l: "SCAN TOTALT", v: parsed.grandTotal ? (parsed.grandTotal * 100).toFixed(0) + "%" : "-" },
            ].map(s => (
              <MetricCard key={s.l} label={s.l} value={s.v} />
            ))}
          </MetricGrid>

          <Panel className="data-panel" flush>
            <DataTable headers={[
              "BANA",
              { label: "PERS", align: "right" },
              { label: "KOLLI", align: "right" },
              { label: "KART", align: "right" },
              { label: "PREST", align: "right" },
              { label: "GAP", align: "right" },
              { label: "SCAN", align: "right" },
              { label: "BEDÖMNING", align: "right" },
            ]}>
                {parsed.rows.map((r, i) => {
                  const scanRate = r.scannat != null ? r.scannat : getScanRate(r.kbana, parsed.scanRates);
                  const scanPct = scanRate != null ? Math.round(scanRate * 100) : null;
                  const scanColor = scanPct == null ? C.dim : scanPct < 20 ? C.dim : scanPct < 60 ? C.red : scanPct < 75 ? C.yellow : C.green;
                  return (
                    <tr key={i}>
                      <td className="primary-cell">{r.kbana}</td>
                      <td className="is-right mono-cell" style={{ color: C.textDim }}>{r.pers}</td>
                      <td className="is-right mono-cell">{r.kolli}</td>
                      <td className="is-right mono-cell">{r.kart}</td>
                      <td className="is-right"><PrestBar prest={r.prest} /></td>
                      <td className="is-right"><GapChip gap={r.gap} /></td>
                      <td className="is-right mono-cell" style={{ color: scanColor, fontWeight: scanPct !== null && scanPct < 75 ? 700 : 400 }}>
                        {scanPct != null ? scanPct + "%" : "-"}
                      </td>
                      <td className="is-right">
                        <BedomingPill text={r.bedoming} />
                      </td>
                    </tr>
                  );
                })}
            </DataTable>
          </Panel>

          {!brief && (
            <>
              <ActionButton onClick={generateBrief} disabled={loading} variant="primary" full>
                {loading ? "Analyserar..." : "Generera morgonbriefing"}
              </ActionButton>
              <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--dim)", textAlign: "center" }}>
                Driftdata skickas till Anthropic API för analys. Inga personuppgifter inkluderas.
              </p>
            </>
          )}

          {brief && (
            <Panel title="AI-ANALYS" className="ai-panel">
              <div className="brief-text">{brief}</div>
              <div className="brief-actions">
                <ActionButton onClick={generateBrief}>Ny analys</ActionButton>
                <ActionButton onClick={() => { setParsed(null); setBrief(null); }}>Ny fil</ActionButton>
              </div>
            </Panel>
          )}

          {!brief && (
            <ActionButton onClick={() => { setParsed(null); setBrief(null); }}>
              Ny fil
            </ActionButton>
          )}
        </div>
      )}
    </div>
  );
}
