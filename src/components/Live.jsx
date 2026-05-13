import { useState } from "react";
import * as XLSX from "xlsx";
import { C } from "../shared/theme";
import { ActionButton, Alert, Dropzone, PageHeader, Panel } from "../shared/components";

// Cell map for "Infattning SDS" Visualisering-filen.
// Rows and columns are 0-indexed. Update here if the Excel template changes.
// Format: [row, col] for each flow state per K-bana.
// Påfyllningar: rows iko/pavag/klart/total, Kartonger: same rows, different cols.
const CELL_MAP = {
  kbanor: [
    { kbana: "K51",   line: "Line 1",   isPL: false,
      pafyll: { iko:[13,13], pavag:[15,13], klart:[17,13], total:[19,13] },
      kart:   { iko:[13,17], pavag:[15,17], klart:[17,17], total:[19,17] } },
    { kbana: "K52",   line: "Line 1/2", isPL: false,
      pafyll: { iko:[14,44], pavag:[16,44], klart:[18,44], total:[20,44] },
      kart:   { iko:[14,48], pavag:[16,48], klart:[18,48], total:[20,48] } },
    { kbana: "K53",   line: "Line 1/2", isPL: false,
      pafyll: { iko:[14,53], pavag:[16,53], klart:[18,53], total:[20,53] },
      kart:   { iko:[14,58], pavag:[16,58], klart:[18,58], total:[20,58] } },
    { kbana: "K56",   line: "Line 2/4", isPL: false,
      pafyll: { iko:[14,78], pavag:[16,78], klart:[18,78], total:[20,78] },
      kart:   { iko:[14,82], pavag:[16,82], klart:[18,82], total:[20,82] } },
    { kbana: "K58",   line: "Line 4/6", isPL: false,
      pafyll: { iko:[34,14], pavag:[35,14], klart:[36,14], total:[37,14] },
      kart:   { iko:[34,18], pavag:[35,18], klart:[36,18], total:[37,18] } },
    { kbana: "K59",   line: "Line 6/7", isPL: false,
      pafyll: { iko:[34,43], pavag:[35,43], klart:[36,43], total:[37,43] },
      kart:   { iko:[34,47], pavag:[35,47], klart:[36,47], total:[37,47] } },
    { kbana: "K60",   line: "Line 6/7", isPL: false,
      pafyll: { iko:[34,52], pavag:[35,52], klart:[36,52], total:[37,52] },
      kart:   { iko:[34,57], pavag:[35,57], klart:[36,57], total:[37,57] } },
    { kbana: "K61-7", line: "Line 7",   isPL: false,
      pafyll: { iko:[34,80], pavag:[35,80], klart:[36,80], total:[37,80] },
      kart:   { iko:[34,84], pavag:[35,84], klart:[36,84], total:[37,84] } },
    { kbana: "K55",   line: "Stn 36",   isPL: false,
      pafyll: { iko:[51,11], pavag:[53,11], klart:[55,11], total:[58,11] },
      kart:   { iko:[51,15], pavag:[53,15], klart:[55,15], total:[58,15] } },
    { kbana: "K61-36",line: "Stn 36",  isPL: false,
      pafyll: { iko:[51,19], pavag:[53,19], klart:[55,19], total:[58,19] },
      kart:   { iko:[51,24], pavag:[53,24], klart:[55,24], total:[58,24] } },
    { kbana: "K62",   line: "Stn 50",  isPL: false,
      pafyll: { iko:[51,46], pavag:[53,46], klart:[55,46], total:[58,46] },
      kart:   { iko:[51,51], pavag:[53,51], klart:[55,51], total:[58,51] } },
    { kbana: "PL09",  line: "Pallar",  isPL: true,
      pafyll: { iko:[67,16], pavag:[68,16], klart:[69,16], total:[70,16] },
      kart:   null },
  ],
  pallarPerK: {
    "K51":  { iko:[67,22], pavag:[68,22], klart:[69,22], total:[70,22] },
    "K52":  { iko:[67,25], pavag:[68,25], klart:[69,25], total:[70,25] },
    "K53":  { iko:[67,41], pavag:[68,41], klart:[69,41], total:[70,41] },
    "K56":  { iko:[67,45], pavag:[68,45], klart:[69,45], total:[70,45] },
    "K58":  { iko:[67,50], pavag:[68,50], klart:[69,50], total:[70,50] },
    "K59":  { iko:[67,56], pavag:[68,56], klart:[69,56], total:[70,56] },
    "K60":  { iko:[67,61], pavag:[68,61], klart:[69,61], total:[70,61] },
    "K61-7":  { iko:[67,74], pavag:[68,74], klart:[69,74], total:[70,74] },
  },
  total: {
    pafyll: { iko:[48,79], pavag:[50,79], klart:[52,79], total:[54,79] },
    kart:   { iko:[48,83], pavag:[50,83], klart:[52,83], total:[54,83] },
  },
};

function readFlow(R, coords) {
  const g = ([r, c]) => +R[r]?.[c] || 0;
  return { iko: g(coords.iko), pavag: g(coords.pavag), klart: g(coords.klart), total: g(coords.total) };
}

const normKbana = s => String(s).replace(/[-\s]/g, "").toUpperCase();

function parseStaffingFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets["K-BANA"];
        if (!sheet) throw new Error("Ingen K-BANA-flik — är det rätt fil?");
        const R = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
        const hi = R.findIndex(r => String(r[1]).trim().toUpperCase() === "K-BANA");
        if (hi === -1) throw new Error("Hittade inte K-BANA-rubriken");
        const rows = [];
        for (let i = hi + 1; i < R.length; i++) {
          const r = R[i];
          const kbana = String(r[1] || "").trim();
          if (!kbana || kbana.toUpperCase() === "TOTAL") break;
          rows.push({ kbana, p1: +r[2]||0, p2: +r[3]||0, p3: +r[4]||0, p8: +r[5]||0, bemanning: +r[7]||0 });
        }
        if (!rows.length) throw new Error("Ingen bemanningsdata hittades");
        resolve(rows);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function parseLive(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const R = XLSX.utils.sheet_to_json(sheet, { defval: "", header: 1 });

        const kbanor = CELL_MAP.kbanor.map(def => ({
          kbana: def.kbana,
          line:  def.line,
          isPL:  def.isPL,
          pafyll: readFlow(R, def.pafyll),
          kart:   def.kart ? readFlow(R, def.kart) : null,
        }));

        const pallarPerK = Object.fromEntries(
          Object.entries(CELL_MAP.pallarPerK).map(([k, coords]) => [k, readFlow(R, coords)])
        );

        const total = {
          pafyll: readFlow(R, CELL_MAP.total.pafyll),
          kart:   readFlow(R, CELL_MAP.total.kart),
        };

        const allZero = kbanor.every(k => k.pafyll.total === 0 && !k.isPL);
        if (allZero) throw new Error("Alla värden är noll — fel fil eller fel fliik? Kontrollera att det är Visualisering-filen (Infattning SDS).");

        const active = kbanor.filter(k => k.pafyll.total > 0 || k.isPL);
        resolve({ kbanor: active, pallarPerK, total, fileName: file.name, loaded: new Date().toLocaleTimeString("sv-SE") });
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function FlowBar({ iko, pavag, klart, total }) {
  if (!total) return <div style={{ color: "var(--dim)", fontSize: 12 }}>Ingen data</div>;
  const pI = (iko / total) * 100;
  const pP = (pavag / total) * 100;
  const pK = (klart / total) * 100;
  return (
    <div>
      <div className="flow-bar__track">
        <div className="flow-bar__segment" style={{ width: pI + "%", background: "var(--red)" }} />
        <div className="flow-bar__segment" style={{ width: pP + "%", background: "var(--yellow)" }} />
        <div className="flow-bar__segment" style={{ width: pK + "%", background: "var(--green)" }} />
      </div>
      <div className="flow-bar__legend">
        <span style={{ color: "var(--red)" }}>I kö {iko}</span>
        <span style={{ color: "var(--yellow)" }}>På väg {pavag}</span>
        <span style={{ color: "var(--green)" }}>Klart {klart}</span>
        <span className="flow-bar__total">Tot {total}</span>
      </div>
    </div>
  );
}

function StatusPill({ total, iko, klart }) {
  const label = klart === total && total > 0 ? "KLART" : iko > 0 ? "I KÖ" : "PÅ VÄG";
  const color = klart === total && total > 0 ? C.green : iko > 0 ? C.red : C.yellow;
  return (
    <span className="status-pill" style={{ color, background: color + "20", border: "1px solid " + color + "44" }}>{label}</span>
  );
}

export default function Live() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [drag, setDrag] = useState(false);
  const [staffing, setStaffing] = useState(null);
  const [staffErr, setStaffErr] = useState(null);
  const [manualBemanning, setManualBemanning] = useState({});

  const handleFile = (f) => {
    setErr(null);
    parseLive(f).then(d => { setData(d); setManualBemanning({}); }).catch(e => setErr(e.message));
  };

  const handleStaffingFile = (f) => {
    setStaffErr(null);
    parseStaffingFile(f).then(rows => {
      setStaffing(rows);
      const nm = Object.fromEntries(rows.map(r => [normKbana(r.kbana), r]));
      setManualBemanning(prev => {
        const next = { ...prev };
        if (data) {
          for (const kb of data.kbanor) {
            const s = nm[normKbana(kb.kbana)];
            if (s) next[kb.kbana] = s.bemanning;
          }
        }
        return next;
      });
    }).catch(e => setStaffErr(e.message));
  };

  const staffingMap = staffing
    ? Object.fromEntries(staffing.map(r => [normKbana(r.kbana), r]))
    : null;

  return (
    <div className="dashboard-page">
      <PageHeader
        live
        eyebrow="Live - nuläge"
        title="Infattningsstatus"
        subtitle="Följ K-banor, påfyllningar, kartonger och helpallar från Visualisering-filen."
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
              {" "}·{" "}
              <label className="file-meta__change" style={staffing ? { color: "var(--green)" } : undefined}>
                {staffing ? "Bemanning ✓" : "+ Bemanning"}
                <input type="file" accept=".xlsx" className="visually-hidden-input"
                  onChange={e => { if (e.target.files[0]) handleStaffingFile(e.target.files[0]); }} />
              </label>
            </div>
          </div>
        )}
      />

      {err && <Alert>{err}</Alert>}
      {staffErr && <Alert>{staffErr}</Alert>}

      {!data && (
        <div
          onDragEnter={() => setDrag(true)}
          onDragLeave={() => setDrag(false)}
          onDrop={() => setDrag(false)}
        >
          <Dropzone
            icon="L"
            title="Släpp Visualisering-filen här"
            subtitle="Infattning SDS .xlsx"
            dragging={drag}
            onFile={handleFile}
          />
        </div>
      )}

      {data && (
        <div className="anim-fade-up">
          <div className="kbana-grid">
            {data.kbanor.map(kb => (
              <Panel key={kb.kbana} className="kbana-card" flush>
                <div className="kbana-card__head">
                  <div>
                    <span className="kbana-card__title">{kb.kbana}</span>
                    <span className="kbana-card__meta">{kb.line}</span>
                  </div>
                  <StatusPill {...kb.pafyll} />
                </div>
                <div className="kbana-card__staffing">
                  {staffingMap?.[normKbana(kb.kbana)]?.p1 > 0 && <span className="staffing-shift">P1</span>}
                  {staffingMap?.[normKbana(kb.kbana)]?.p2 > 0 && <span className="staffing-shift">P2</span>}
                  {staffingMap?.[normKbana(kb.kbana)]?.p3 > 0 && <span className="staffing-shift">P3</span>}
                  {staffingMap?.[normKbana(kb.kbana)]?.p8 > 0 && <span className="staffing-shift">P8</span>}
                  <div className="staffing-manual">
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      className="staffing-input"
                      value={manualBemanning[kb.kbana] ?? ""}
                      placeholder="–"
                      onChange={e => setManualBemanning(prev => ({
                        ...prev,
                        [kb.kbana]: e.target.value === "" ? "" : +e.target.value,
                      }))}
                    />
                    <span className="staffing-label">pers</span>
                  </div>
                </div>
                <div className="kbana-card__body">
                  <div className="block-label">
                    {kb.isPL ? "PALLAR" : "PÅFYLLNINGAR"}
                  </div>
                  <FlowBar {...kb.pafyll} />
                  {kb.kart && (
                    <div className="block-spacer">
                      <div className="block-label">KARTONGER</div>
                      <FlowBar {...kb.kart} />
                    </div>
                  )}
                  {data.pallarPerK[kb.kbana] && data.pallarPerK[kb.kbana].total > 0 && (
                    <div className="block-spacer">
                      <div className="block-label">HELPALLAR</div>
                      <FlowBar {...data.pallarPerK[kb.kbana]} />
                    </div>
                  )}
                </div>
              </Panel>
            ))}
          </div>

          {data.total && data.total.pafyll.total > 0 && (
            <Panel title="TOTALT" className="live-total">
              <div className="live-total__grid">
                <div>
                  <div className="block-label">PÅFYLLNINGAR</div>
                  <FlowBar {...data.total.pafyll} />
                </div>
                <div>
                  <div className="block-label">KARTONGER</div>
                  <FlowBar {...data.total.kart} />
                </div>
              </div>
            </Panel>
          )}

          <ActionButton onClick={() => setData(null)}>
            Ladda ny fil
          </ActionButton>
        </div>
      )}
    </div>
  );
}
