import { useState } from "react";
import * as XLSX from "xlsx";
import { C } from "../shared/theme";
import { ActionButton, Alert, Dropzone, PageHeader, Panel } from "../shared/components";

function parseLive(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const R = XLSX.utils.sheet_to_json(sheet, { defval: "", header: 1 });
        const n = (row, col) => +R[row]?.[col] || 0;

        const kbanor = [
          { kbana: "K51", line: "Line 1",
            pafyll: { iko: n(13,13), pavag: n(15,13), klart: n(17,13), total: n(19,13) },
            kart:   { iko: n(13,17), pavag: n(15,17), klart: n(17,17), total: n(19,17) } },
          { kbana: "K52", line: "Line 1/2",
            pafyll: { iko: n(14,44), pavag: n(16,44), klart: n(18,44), total: n(20,44) },
            kart:   { iko: n(14,48), pavag: n(16,48), klart: n(18,48), total: n(20,48) } },
          { kbana: "K53", line: "Line 1/2",
            pafyll: { iko: n(14,53), pavag: n(16,53), klart: n(18,53), total: n(20,53) },
            kart:   { iko: n(14,58), pavag: n(16,58), klart: n(18,58), total: n(20,58) } },
          { kbana: "K56", line: "Line 2/4",
            pafyll: { iko: n(14,78), pavag: n(16,78), klart: n(18,78), total: n(20,78) },
            kart:   { iko: n(14,82), pavag: n(16,82), klart: n(18,82), total: n(20,82) } },
          { kbana: "K58", line: "Line 4/6",
            pafyll: { iko: n(34,14), pavag: n(35,14), klart: n(36,14), total: n(37,14) },
            kart:   { iko: n(34,18), pavag: n(35,18), klart: n(36,18), total: n(37,18) } },
          { kbana: "K59", line: "Line 6/7",
            pafyll: { iko: n(34,43), pavag: n(35,43), klart: n(36,43), total: n(37,43) },
            kart:   { iko: n(34,47), pavag: n(35,47), klart: n(36,47), total: n(37,47) } },
          { kbana: "K60", line: "Line 6/7",
            pafyll: { iko: n(34,52), pavag: n(35,52), klart: n(36,52), total: n(37,52) },
            kart:   { iko: n(34,57), pavag: n(35,57), klart: n(36,57), total: n(37,57) } },
          { kbana: "K61-7", line: "Line 7",
            pafyll: { iko: n(34,80), pavag: n(35,80), klart: n(36,80), total: n(37,80) },
            kart:   { iko: n(34,84), pavag: n(35,84), klart: n(36,84), total: n(37,84) } },
          { kbana: "K55", line: "Stn 36",
            pafyll: { iko: n(51,11), pavag: n(53,11), klart: n(55,11), total: n(58,11) },
            kart:   { iko: n(51,15), pavag: n(53,15), klart: n(55,15), total: n(58,15) } },
          { kbana: "K61-36", line: "Stn 36",
            pafyll: { iko: n(51,19), pavag: n(53,19), klart: n(55,19), total: n(58,19) },
            kart:   { iko: n(51,24), pavag: n(53,24), klart: n(55,24), total: n(58,24) } },
          { kbana: "K62", line: "Stn 50",
            pafyll: { iko: n(51,46), pavag: n(53,46), klart: n(55,46), total: n(58,46) },
            kart:   { iko: n(51,51), pavag: n(53,51), klart: n(55,51), total: n(58,51) } },
          { kbana: "PL09", line: "Pallar", isPL: true,
            pafyll: { iko: n(67,16), pavag: n(68,16), klart: n(69,16), total: n(70,16) },
            kart: null },
        ];

        const pallarPerK = {
          "K51":  { iko: n(67,22), pavag: n(68,22), klart: n(69,22), total: n(70,22) },
          "K52":  { iko: n(67,25), pavag: n(68,25), klart: n(69,25), total: n(70,25) },
          "K53":  { iko: n(67,41), pavag: n(68,41), klart: n(69,41), total: n(70,41) },
          "K56":  { iko: n(67,45), pavag: n(68,45), klart: n(69,45), total: n(70,45) },
          "K58":  { iko: n(67,50), pavag: n(68,50), klart: n(69,50), total: n(70,50) },
          "K59":  { iko: n(67,56), pavag: n(68,56), klart: n(69,56), total: n(70,56) },
          "K60":  { iko: n(67,61), pavag: n(68,61), klart: n(69,61), total: n(70,61) },
          "K61":  { iko: n(67,74), pavag: n(68,74), klart: n(69,74), total: n(70,74) },
        };

        const total = {
          pafyll: { iko: n(48,79), pavag: n(50,79), klart: n(52,79), total: n(54,79) },
          kart:   { iko: n(48,83), pavag: n(50,83), klart: n(52,83), total: n(54,83) },
        };

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
        <span style={{ color: "var(--red)" }}>Iko {iko}</span>
        <span style={{ color: "var(--yellow)" }}>Väg {pavag}</span>
        <span style={{ color: "var(--green)" }}>Klart {klart}</span>
        <span className="flow-bar__total">Tot {total}</span>
      </div>
    </div>
  );
}

function StatusPill({ total, iko, klart }) {
  const label = klart === total && total > 0 ? "KLART" : iko > 0 ? "I KO" : "PÅ VÄG";
  const color = klart === total && total > 0 ? C.green : iko > 0 ? C.red : C.yellow;
  return (
    <span className="status-pill" style={{ color, background: color + "20", border: "1px solid " + color + "44" }}>{label}</span>
  );
}

export default function Live() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [drag, setDrag] = useState(false);

  const handleFile = (f) => {
    setErr(null);
    parseLive(f).then(setData).catch(e => setErr(e.message));
  };

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
