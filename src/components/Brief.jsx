import { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import { C } from "../shared/theme";
import {
  ActionButton,
  Alert,
  BedomingPill,
  DataTable,
  DeltaChip,
  Dropzone,
  GapChip,
  MetricCard,
  MetricGrid,
  PageHeader,
  Panel,
  PrestBar,
} from "../shared/components";
import { parseDailyRows } from "../shared/parseDailyRows";
import { callAI } from "../shared/api";
import { pctDelta, rekommenderadBemanning } from "../shared/liveUtils";
import { fetchHistorikDays, buildKbanaNormals } from "../shared/kbanaNormals";

const MONTH_MAP = { jan:1,feb:2,mar:3,apr:4,maj:5,jun:6,jul:7,aug:8,sep:9,okt:10,nov:11,dec:12 };

// Brief is explicitly about "gårdagens" (yesterday's) data. Try to read the
// real date from the filename (same convention Historik.jsx uses) so the
// weekday-tiered "normalt" comparison below matches the right day; fall
// back to yesterday if the filename doesn't carry a date.
function dateStrFromFileName(name) {
  const m = name.match(/(\d+)[_\s]?(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)/i);
  if (!m) {
    const y = new Date(Date.now() - 86400000);
    return y.toISOString().substring(0, 10);
  }
  const year = new Date().getFullYear();
  const month = MONTH_MAP[m[2].toLowerCase()];
  const day = parseInt(m[1], 10);
  return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

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

        resolve({ rows, scanRates, grandTotal, fileName: file.name, dateStr: dateStrFromFileName(file.name) });
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
  const [historikDays, setHistorikDays] = useState([]);

  // Bonus context for the comparison chips + AI prompt below — not on the
  // critical path, so a failed fetch (e.g. offline) just means no "vs
  // normalt" signal rather than a broken tab.
  useEffect(() => {
    fetchHistorikDays().then(setHistorikDays).catch(() => {});
  }, []);

  const kbanaNormals = useMemo(() => {
    if (!parsed?.dateStr || !historikDays.length) return {};
    const weekday = new Date(parsed.dateStr + "T12:00:00").getDay();
    return buildKbanaNormals(historikDays, weekday);
  }, [historikDays, parsed]);

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
      ", Prod=" + (r.produktivitet != null ? r.produktivitet.toFixed(1) : "okand") +
      ", Scan=" + (r.scannat != null ? (r.scannat * 100).toFixed(0) + "%" : "okand") +
      ", Bedomning=" + (r.bedoming || "-")
    ).join("\n");

    const normalsEntries = Object.entries(kbanaNormals);
    const normalsText = normalsEntries.length
      ? "\n\nHistoriskt snitt per bana (for jamforelse, samma veckodag nar mojligt):\n" +
        normalsEntries.map(([kb, n]) => `${kb}: Kolli~${Math.round(n.kolli)}, Kart~${Math.round(n.kart)}`).join("\n")
      : "";

    const prompt = "Du ar operativ analytiker pa ett svensk lager. Analysera gardagens shelving-data och ge en kort direkt morgenbriefing pa svenska.\n\nPer bana:\n" + banorText + normalsText + "\n\nGrand total scan: " + (parsed.grandTotal ? (parsed.grandTotal * 100).toFixed(0) + "%" : "okand") + "\n\nScan-rate och prestation ar SEPARATA matt. Under 75% = lag, under 60% = kritisk. Prod = shelving-rader per person och timme (snitt ca 6, over 8 = bra, under 4 = lag). Bedomning kombinerar status och scan-rate. Om historiskt snitt finns, kommentera konkret nar en banas volym avviker tydligt (t.ex. +/-20%) fran sitt snitt.\n\nGe: 1) Lagestord 2) Kritiska banor 3) Overskott 4) Scan- och produktivitetsavvikelser 5) Rekommendation. Max 280 ord. Kort och direkt.";

    callAI([{ role: "user", content: prompt }], 1000)
      .then(text => { setBrief(text); setLoading(false); })
      .catch(e => { setErr("API-fel: " + e.message); setLoading(false); });
  };

  const alerts = parsed ? parsed.rows.flatMap(r => {
    const res = [];
    if (r.gap < -1.5) res.push({ level: "critical", msg: r.kbana + ": gap " + r.gap.toFixed(1) + "h" });
    else if (r.gap < -0.5) res.push({ level: "warning", msg: r.kbana + ": gap " + r.gap.toFixed(1) + "h" });
    if (r.scannat != null) {
      const pct = Math.round(r.scannat * 100);
      if (pct < 60) res.push({ level: "critical", msg: r.kbana + ": scan " + pct + "%" });
      else if (pct < 75) res.push({ level: "warning", msg: r.kbana + ": scan " + pct + "%" });
    }
    return res;
  }) : [];
  const hasCritical = alerts.some(a => a.level === "critical");
  const copyAlerts = () => {
    const lines = alerts.map(a => (a.level === "critical" ? "KRITISK" : "VARNING") + ": " + a.msg);
    navigator.clipboard.writeText(lines.join("\n")).catch(() => {});
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

          {alerts.length > 0 && (
            <div className={"alert-panel" + (hasCritical ? "" : " alert-panel--warn")}>
              <div className="alert-panel__head">
                <span>{hasCritical ? "KRITISKA AVVIKELSER" : "VARNINGAR"}</span>
                <button className="alert-panel__copy" onClick={copyAlerts}>KOPIERA</button>
              </div>
              <div className="alert-panel__body">
                {alerts.map((a, i) => (
                  <span key={i} className={"alert-item alert-item--" + a.level}>{a.msg}</span>
                ))}
              </div>
            </div>
          )}

          <Panel className="data-panel" flush>
            <DataTable headers={[
              "BANA",
              { label: "PERS", align: "right" },
              { label: "REK. BEM.", align: "right" },
              { label: "KOLLI", align: "right" },
              { label: "KART", align: "right" },
              { label: "PREST", align: "right" },
              { label: "GAP", align: "right" },
              { label: "PROD", align: "right" },
              { label: "SCAN", align: "right" },
              { label: "BEDÖMNING", align: "right" },
            ]}>
                {parsed.rows.map((r, i) => {
                  const scanRate = r.scannat != null ? r.scannat : getScanRate(r.kbana, parsed.scanRates);
                  const scanPct = scanRate != null ? Math.round(scanRate * 100) : null;
                  const scanColor = scanPct == null ? C.dim : scanPct < 20 ? C.dim : scanPct < 60 ? C.red : scanPct < 75 ? C.yellow : C.green;
                  const rekBem = rekommenderadBemanning(r.kbana, r.kolli, r.kart, r.helpall);
                  const rekColor = r.pers >= rekBem ? C.green : r.pers >= rekBem * 0.9 ? C.yellow : C.red;
                  const normal = kbanaNormals[r.kbana];
                  const kolliPct = normal?.n >= 3 ? pctDelta(r.kolli, normal.kolli) : null;
                  const kartPct  = normal?.n >= 3 ? pctDelta(r.kart,  normal.kart)  : null;
                  return (
                    <tr key={i}>
                      <td className="primary-cell">{r.kbana}</td>
                      <td className="is-right mono-cell" style={{ color: C.textDim }}>{r.pers}</td>
                      <td className="is-right mono-cell" style={{ color: rekColor, fontWeight: 700 }}>{rekBem.toFixed(1)}</td>
                      <td className="is-right mono-cell">
                        {r.kolli}
                        {kolliPct != null && <div style={{ marginTop: 2 }}><DeltaChip pct={kolliPct} label="vs snitt" /></div>}
                      </td>
                      <td className="is-right mono-cell">
                        {r.kart}
                        {kartPct != null && <div style={{ marginTop: 2 }}><DeltaChip pct={kartPct} label="vs snitt" /></div>}
                      </td>
                      <td className="is-right"><PrestBar prest={r.prest} /></td>
                      <td className="is-right"><GapChip gap={r.gap} /></td>
                      <td className="is-right mono-cell" style={{ color: r.produktivitet != null && r.produktivitet < 4 ? C.yellow : C.textDim }}>
                        {r.produktivitet != null ? r.produktivitet.toFixed(1) : "-"}
                      </td>
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
