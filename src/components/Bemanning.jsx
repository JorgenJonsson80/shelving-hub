import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { C } from "../shared/theme";
import {
  ActionButton, Alert, DataTable, Dropzone, MetricCard, MetricGrid, PageHeader, Panel,
} from "../shared/components";
import { callAI } from "../shared/api";
import { rekommenderadBemanning } from "../shared/liveUtils";
import { fetchHistorikDays, buildKbanaNormals } from "../shared/kbanaNormals";

const WEEKDAYS_SV = ["Söndag", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag"];

function parseBemanningFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets["K-BANA"];
        if (!sheet) throw new Error("Ingen K-BANA-flik — är det rätt fil?");
        const R = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        const hi = R.findIndex(r => String(r[1]).trim().toUpperCase() === "K-BANA");
        if (hi === -1) throw new Error("Hittade inte K-BANA-rubriken i filen");

        const rows = [];
        let totals = null;
        for (let i = hi + 1; i < R.length; i++) {
          const r = R[i];
          const kbana = String(r[1] || "").trim();
          if (!kbana) continue;
          const entry = {
            kbana,
            p1: +r[2] || 0,
            p2: +r[3] || 0,
            p3: +r[4] || 0,
            p8: +r[5] || 0,
            bemanning: +r[7] || 0,
          };
          if (kbana.toUpperCase() === "TOTAL") { totals = entry; break; }
          rows.push(entry);
        }

        if (rows.length === 0) throw new Error("Ingen K-bana-data hittades");
        if (!totals) {
          totals = rows.reduce(
            (acc, r) => ({ p1: acc.p1 + r.p1, p2: acc.p2 + r.p2, p3: acc.p3 + r.p3, p8: acc.p8 + r.p8, bemanning: acc.bemanning + r.bemanning }),
            { p1: 0, p2: 0, p3: 0, p8: 0, bemanning: 0 }
          );
        }

        const hasP8 = rows.some(r => r.p8 > 0) || totals.p8 > 0;
        resolve({ rows, totals, hasP8, fileName: file.name, loaded: new Date().toLocaleTimeString("sv-SE") });
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export default function Bemanning() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [drag, setDrag] = useState(false);
  const [historikDays, setHistorikDays] = useState([]);
  const [weekday, setWeekday] = useState(() => new Date(Date.now() + 86400000).getDay());
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportErr, setReportErr] = useState(null);

  // Bonus context for the staffing report below — not on the critical path,
  // so a failed fetch (e.g. offline) just means the REK. BEM. column and
  // report button stay disabled rather than a broken tab.
  useEffect(() => {
    fetchHistorikDays().then(setHistorikDays).catch(() => {});
  }, []);

  const kbanaNormals = useMemo(
    () => (historikDays.length ? buildKbanaNormals(historikDays, weekday) : {}),
    [historikDays, weekday]
  );
  const hasNormals = Object.keys(kbanaNormals).length > 0;

  const handleFile = (f) => {
    setErr(null);
    setReport(null); setReportErr(null);
    parseBemanningFile(f).then(setData).catch(e => setErr(e.message));
  };

  const generateReport = () => {
    if (!data) return;
    setReportLoading(true); setReport(null); setReportErr(null);

    const rowsText = data.rows.map(r => {
      const n = kbanaNormals[r.kbana];
      const rekBem = n ? rekommenderadBemanning(r.kbana, n.kolli, n.kart, n.helpall) : null;
      return r.kbana + ": Planerad=" + r.bemanning +
        (rekBem != null
          ? ", Rek.=" + rekBem.toFixed(1) +
            " (hist. snitt kolli=" + Math.round(n.kolli) + ", kart=" + Math.round(n.kart) +
            ", pall=" + Math.round(n.helpall) + ", " + n.n + " dagar, " + n.tier + ")"
          : ", Rek.=okänd (ingen historik för denna bana)");
    }).join("\n");

    const prompt =
      "Du är bemanningsansvarig på ett svenskt lager. Utifrån planerad bemanning och historiskt volymsnitt per K-bana för " +
      WEEKDAYS_SV[weekday].toLowerCase() + ", ge en kort rekommendation på svenska för hur bemanningen bör läggas och varför.\n\n" +
      "Rek. = rekommenderad bemanning beräknad från historiskt snitt (kolli/kart/pall) för samma veckodag (poolat över alla veckodagar om det inte finns nog historik för just den veckodagen). Planerad = vad som faktiskt är schemalagt just nu enligt planeringsfilen.\n\n" +
      rowsText +
      "\n\nTotal planerad bemanning: " + data.totals.bemanning + "\n\n" +
      "Ge: 1) Övergripande läge (över- eller underbemannat totalt, och med hur mycket) 2) Vilka banor har störst avvikelse mellan planerad och rekommenderad bemanning, och vad blir konsekvensen om det inte justeras 3) Konkreta förslag på omfördelning mellan banor om möjligt 4) Kort motivering utifrån det historiska mönstret. Max 280 ord. Kort och direkt.";

    callAI([{ role: "user", content: prompt }], 1000)
      .then(text => { setReport(text); setReportLoading(false); })
      .catch(e => { setReportErr("API-fel: " + e.message); setReportLoading(false); });
  };

  return (
    <div className="dashboard-page">
      <PageHeader
        eyebrow="Bemanning"
        title="Personal per pass"
        subtitle="Bemanningsstatus per K-bana och skift från Shelving-planeringsfilen."
        actions={data && (
          <div className="file-meta">
            <div className="file-meta__name">{data.fileName}</div>
            <div className="file-meta__loaded">
              Laddad {data.loaded} ·{" "}
              <label className="file-meta__change">
                Byt fil
                <input type="file" accept=".xlsx" className="visually-hidden-input"
                  onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
              </label>
            </div>
          </div>
        )}
      />

      {err && <Alert>{err}</Alert>}

      {!data && (
        <div
          onDragEnter={() => setDrag(true)}
          onDragLeave={() => setDrag(false)}
          onDrop={() => setDrag(false)}
        >
          <Dropzone
            icon="B"
            title="Släpp planeringsfilen här"
            subtitle="Shelving framtid .xlsx (K-BANA-fliken)"
            dragging={drag}
            onFile={handleFile}
          />
        </div>
      )}

      {data && (
        <div className="anim-fade-up">
          <MetricGrid columns={data.hasP8 ? 5 : 4}>
            <MetricCard label="TOTAL BEMANNING" value={data.totals.bemanning} tone={C.accent} />
            <MetricCard label="P1  07:00–15:30" value={data.totals.p1} />
            <MetricCard label="P2  07:30–16:00" value={data.totals.p2} />
            <MetricCard label="P3  09:00–17:30" value={data.totals.p3} />
            {data.hasP8 && <MetricCard label="P8" value={data.totals.p8} />}
          </MetricGrid>

          <Panel className="data-panel" flush>
            <DataTable headers={[
              "BANA",
              { label: "P1 · 07:00", align: "right" },
              { label: "P2 · 07:30", align: "right" },
              { label: "P3 · 09:00", align: "right" },
              ...(data.hasP8 ? [{ label: "P8", align: "right" }] : []),
              { label: "TOTAL", align: "right" },
              { label: "REK. BEM.", align: "right" },
            ]}>
              {data.rows.map((r, i) => {
                const n = kbanaNormals[r.kbana];
                const rekBem = n ? rekommenderadBemanning(r.kbana, n.kolli, n.kart, n.helpall) : null;
                const rekColor = rekBem == null ? C.dim : r.bemanning >= rekBem ? C.green : r.bemanning >= rekBem * 0.9 ? C.yellow : C.red;
                return (
                  <tr key={i}>
                    <td className="primary-cell">{r.kbana}</td>
                    <td className="is-right mono-cell" style={{ color: r.p1 > 0 ? C.text : C.dim }}>{r.p1 || "–"}</td>
                    <td className="is-right mono-cell" style={{ color: r.p2 > 0 ? C.text : C.dim }}>{r.p2 || "–"}</td>
                    <td className="is-right mono-cell" style={{ color: r.p3 > 0 ? C.text : C.dim }}>{r.p3 || "–"}</td>
                    {data.hasP8 && <td className="is-right mono-cell" style={{ color: r.p8 > 0 ? C.text : C.dim }}>{r.p8 || "–"}</td>}
                    <td className="is-right mono-cell" style={{ color: C.accent, fontWeight: 700 }}>{r.bemanning}</td>
                    <td className="is-right mono-cell" style={{ color: rekColor, fontWeight: 700 }}>{rekBem != null ? rekBem.toFixed(1) : "–"}</td>
                  </tr>
                );
              })}
            </DataTable>
          </Panel>

          {reportErr && <Alert>{reportErr}</Alert>}

          {!report && (
            <>
              <div className="form-row" style={{ alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--dim)" }}>Bemanna för:</span>
                <select
                  aria-label="Veckodag för bemanningsrapport"
                  value={weekday}
                  onChange={e => setWeekday(+e.target.value)}
                  className="select-field select-field--compact"
                >
                  {WEEKDAYS_SV.map((w, i) => <option key={i} value={i}>{w}</option>)}
                </select>
              </div>
              <ActionButton onClick={generateReport} disabled={reportLoading || !hasNormals} variant="primary" full>
                {reportLoading ? "Analyserar..." : "Rapport"}
              </ActionButton>
              <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--dim)", textAlign: "center" }}>
                {hasNormals
                  ? "Driftdata skickas till Anthropic API för analys. Inga personuppgifter inkluderas."
                  : "Ingen historik tillgänglig ännu — ladda upp Daily-filer i Historik-fliken först."}
              </p>
            </>
          )}

          {report && (
            <Panel title="BEMANNINGSRAPPORT" className="ai-panel">
              <div className="brief-text">{report}</div>
              <div className="brief-actions">
                <ActionButton onClick={generateReport}>Ny rapport</ActionButton>
                <ActionButton onClick={() => setReport(null)}>Stäng</ActionButton>
              </div>
            </Panel>
          )}

          <ActionButton onClick={() => { setData(null); setReport(null); setReportErr(null); }}>Ladda ny fil</ActionButton>
        </div>
      )}
    </div>
  );
}
