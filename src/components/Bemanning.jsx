import { useState } from "react";
import * as XLSX from "xlsx";
import { C } from "../shared/theme";
import {
  ActionButton, Alert, DataTable, Dropzone, MetricCard, MetricGrid, PageHeader, Panel,
} from "../shared/components";

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

  const handleFile = (f) => {
    setErr(null);
    parseBemanningFile(f).then(setData).catch(e => setErr(e.message));
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
            ]}>
              {data.rows.map((r, i) => (
                <tr key={i}>
                  <td className="primary-cell">{r.kbana}</td>
                  <td className="is-right mono-cell" style={{ color: r.p1 > 0 ? C.text : C.dim }}>{r.p1 || "–"}</td>
                  <td className="is-right mono-cell" style={{ color: r.p2 > 0 ? C.text : C.dim }}>{r.p2 || "–"}</td>
                  <td className="is-right mono-cell" style={{ color: r.p3 > 0 ? C.text : C.dim }}>{r.p3 || "–"}</td>
                  {data.hasP8 && <td className="is-right mono-cell" style={{ color: r.p8 > 0 ? C.text : C.dim }}>{r.p8 || "–"}</td>}
                  <td className="is-right mono-cell" style={{ color: C.accent, fontWeight: 700 }}>{r.bemanning}</td>
                </tr>
              ))}
            </DataTable>
          </Panel>

          <ActionButton onClick={() => setData(null)}>Ladda ny fil</ActionButton>
        </div>
      )}
    </div>
  );
}
