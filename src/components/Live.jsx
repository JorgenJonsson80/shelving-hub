import { useState, useEffect } from "react";
import { C } from "../shared/theme";
import { ActionButton, Alert, Dropzone, PageHeader, Panel } from "../shared/components";
import { callAI } from "../shared/api";
import { defaultBastid, normKbana, getWorkerStatus, calcWork, fmtMins } from "../shared/liveUtils";
import { parseLive, parseStaffingFile } from "../shared/parsers";
import {
  FlowBar, StatusPill, AheadBehindPill, WorkCalc, ScheduleOverview, PassSettings,
} from "./live/LiveSubComponents";

const DEFAULT_PASSES = {
  P1: { start: "06:00", end: "14:00" },
  P2: { start: "14:00", end: "22:00" },
  P3: { start: "22:00", end: "06:00" },
  P8: { start: "06:00", end: "14:00" },
};

function ls(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}

export default function Live() {
  const [data,            setData]            = useState(null);
  const [err,             setErr]             = useState(null);
  const [drag,            setDrag]            = useState(false);
  const [staffing,        setStaffing]        = useState(null);
  const [staffErr,        setStaffErr]        = useState(null);
  const [manualBemanning, setManualBemanning] = useState(() => ls("live_bemanning", {}));
  const [manualPall,      setManualPall]      = useState(() => ls("live_pall", {}));
  const [schedule,        setSchedule]        = useState(() => ls("live_schedule", {}));
  const [bastidPerK,      setBastidPerK]      = useState(() => ls("live_bastid", {}));
  const [passes,          setPasses]          = useState(() => ls("live_passes", DEFAULT_PASSES));
  const [aiResult,        setAiResult]        = useState(null);
  const [aiLoading,       setAiLoading]       = useState(false);
  const [aiErr,           setAiErr]           = useState(null);
  const [now,             setNow]             = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { localStorage.setItem("live_bemanning", JSON.stringify(manualBemanning)); }, [manualBemanning]);
  useEffect(() => { localStorage.setItem("live_pall",      JSON.stringify(manualPall));      }, [manualPall]);
  useEffect(() => { localStorage.setItem("live_schedule",  JSON.stringify(schedule));        }, [schedule]);
  useEffect(() => { localStorage.setItem("live_bastid",    JSON.stringify(bastidPerK));      }, [bastidPerK]);
  useEffect(() => { localStorage.setItem("live_passes",    JSON.stringify(passes));           }, [passes]);

  const nowMins = now.getHours() * 60 + now.getMinutes();

  const getBastid    = (kb) => bastidPerK[kb.kbana] ?? defaultBastid(kb);
  const toggleBastid = (kbana, current) =>
    setBastidPerK(prev => ({ ...prev, [kbana]: current === 1.8 ? 2.8 : 1.8 }));

  const handleFile = (f) => {
    setErr(null);
    parseLive(f).then(setData).catch(e => setErr(e.message));
  };

  const handleStaffingFile = (f) => {
    setStaffErr(null);
    parseStaffingFile(f).then(rows => {
      setStaffing(rows);
      const nm = Object.fromEntries(rows.map(r => [normKbana(r.kbana), r]));
      setManualBemanning(prev => {
        const next = { ...prev };
        if (data) for (const kb of data.kbanor) {
          const s = nm[normKbana(kb.kbana)];
          if (s) next[kb.kbana] = s.bemanning;
        }
        return next;
      });
    }).catch(e => setStaffErr(e.message));
  };

  const staffingMap = staffing
    ? Object.fromEntries(staffing.map(r => [normKbana(r.kbana), r]))
    : null;

  const setPallVal = (kbana, field, val) =>
    setManualPall(prev => ({ ...prev, [kbana]: { ...(prev[kbana] || {}), [field]: val === "" ? "" : +val } }));

  const addWorker    = (kbana)            => setSchedule(prev => ({ ...prev, [kbana]: [...(prev[kbana] || []), { start: "", end: "" }] }));
  const addPass      = (kbana, passName)  => {
    const pass = passes[passName];
    if (!pass?.start || !pass?.end) return;
    setSchedule(prev => {
      const cur = prev[kbana] || [];
      if (cur.some(w => w.start === pass.start && w.end === pass.end)) return prev;
      return { ...prev, [kbana]: [...cur, { start: pass.start, end: pass.end }] };
    });
  };
  const updatePass   = (name, field, val) =>
    setPasses(prev => ({ ...prev, [name]: { ...prev[name], [field]: val } }));
  const removeWorker = (kbana, idx)       => setSchedule(prev => ({ ...prev, [kbana]: (prev[kbana] || []).filter((_, i) => i !== idx) }));
  const updateWorker = (kbana, idx, f, v) => setSchedule(prev => {
    const list = [...(prev[kbana] || [])]; list[idx] = { ...list[idx], [f]: v }; return { ...prev, [kbana]: list };
  });

  const analyzeNow = () => {
    if (!data) return;
    setAiLoading(true); setAiResult(null); setAiErr(null);

    const nowStr = now.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
    const activeKbanor  = data.kbanor.filter(kb => !kb.isPL);
    const allUnstaffed  = activeKbanor.every(kb => !manualBemanning[kb.kbana] || +manualBemanning[kb.kbana] === 0);
    const allNoSchedule = activeKbanor.every(kb => !(schedule[kb.kbana] || []).length);

    const banorText = data.kbanor.map(kb => {
      const sched    = schedule[kb.kbana] || [];
      const pers     = +(manualBemanning[kb.kbana] || 0);
      const bastid   = getBastid(kb);
      const { active, planned } = getWorkerStatus(sched, nowMins);
      const pallFile = data.pallarPerK[kb.kbana];
      const pallMan  = manualPall[kb.kbana];
      const src      = (pallMan && Object.values(pallMan).some(v => +v > 0)) ? pallMan : pallFile;
      const pallKvar  = src ? (+(src.iko||0) + +(src.pavag||0)) : 0;
      const pallKlart = src ? +(src.klart||0) : 0;
      const w = calcWork(kb.pafyll, kb.kart, pallKvar, pallKlart, pers, sched, nowMins, bastid);
      const workStr = w
        ? `Kvar ${fmtMins(w.remainWork)}, Buffert ${w.buffer >= 0 ? "+" : "–"}${fmtMins(w.buffer)}, Eff ${w.efficiency != null ? Math.round(w.efficiency) + "%" : "?"}`
        : "Inget schema/bemanning";
      const flowPct = kb.pafyll.total > 0 ? ((kb.pafyll.klart / kb.pafyll.total) * 100).toFixed(0) + "%" : "?";
      return `${kb.kbana}: Påfyll ${kb.pafyll.klart}/${kb.pafyll.total}(${flowPct}), Kart ${kb.kart?.klart ?? 0}/${kb.kart?.total ?? 0}, Pall kvar=${pallKvar} klart=${pallKlart}, Pers=${pers}, Schema=${planned > 0 ? active + "/" + planned + " aktiva" : "saknas"}, Bastid=${bastid}min, ${workStr}`;
    }).join("\n");

    let warnings = "";
    if (allUnstaffed)  warnings += "\nVARNING: Ingen K-bana har bemanning registrerad!";
    if (allNoSchedule) warnings += "\nVARNING: Inga arbetstider inlagda — buffert kan inte beräknas.";

    const prompt = `Du är operativ ledare på ett lager. Klockan är ${nowStr}.
Formel: arbetsminuter = kolli × bastid + kartonger × 0,6 + pallar × 12. Bastid 1,8 min = spår, 2,8 min = golv.
Positiv buffert = hinner klart. Negativ buffert = hinner inte.
${warnings}

K-bana status:
${banorText}

Ge: 1) Snabb lägesbild (max 2 meningar) 2) Vilka K-banor som är i riskzonen 3) Konkreta åtgärder. Max 200 ord.`;

    callAI([{ role: "user", content: prompt }], 600)
      .then(text => { setAiResult(text); setAiLoading(false); })
      .catch(e => { setAiErr("API-fel: " + e.message); setAiLoading(false); });
  };

  return (
    <div className="dashboard-page">
      <PageHeader
        live
        eyebrow="Live - nuläge"
        title="Infattningsstatus"
        subtitle={data
          ? `${now.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })} — uppdateras var 30:e sekund`
          : "Följ K-banor, påfyllningar, kartonger och pallar."}
        actions={data && (
          <div className="file-meta">
            <div className="file-meta__name">{data.fileName}</div>
            <div className="file-meta__loaded">
              Laddad {data.loaded} ·{" "}
              <label className="file-meta__change">Byt fil
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

      {err      && <Alert>{err}</Alert>}
      {staffErr && <Alert>{staffErr}</Alert>}

      {!data && (
        <div onDragEnter={() => setDrag(true)} onDragLeave={() => setDrag(false)} onDrop={() => setDrag(false)}>
          <Dropzone icon="L" title="Släpp Visualisering-filen här" subtitle="Infattning SDS .xlsx" dragging={drag} onFile={handleFile} />
        </div>
      )}

      {data && (
        <div className="anim-fade-up">
          <PassSettings passes={passes} onChange={updatePass} />
          <ScheduleOverview kbanor={data.kbanor} schedule={schedule} nowMins={nowMins} />

          <div className="kbana-grid">
            {data.kbanor.map(kb => {
              const pallFile = data.pallarPerK[kb.kbana];
              const pallMan  = manualPall[kb.kbana];
              const getPall = field => {
                const m = pallMan?.[field];
                return (m !== undefined && m !== "") ? +m : +(pallFile?.[field] || 0);
              };
              const ikoVal   = getPall("iko");
              const pavagVal = getPall("pavag");
              const klartVal = getPall("klart");
              const pallTotal = ikoVal + pavagVal + klartVal;
              const pallFlow = pallTotal > 0
                ? { iko: ikoVal, pavag: pavagVal, klart: klartVal, total: pallTotal }
                : null;
              const pallKvar  = ikoVal + pavagVal;
              const pallKlart = klartVal;

              const sched = schedule[kb.kbana] || [];
              const { active: activeW, planned: plannedW } = getWorkerStatus(sched, nowMins);
              const workerColor = !plannedW ? "var(--dim)"
                : activeW === 0 ? C.red
                : activeW < plannedW ? C.yellow
                : C.green;

              const pers   = +(manualBemanning[kb.kbana] || 0);
              const bastid = getBastid(kb);
              const isGolv = bastid === 2.8;

              return (
                <Panel key={kb.kbana} className="kbana-card" flush>
                  <div className="kbana-card__head">
                    <div>
                      <span className="kbana-card__title">{kb.kbana}</span>
                      <span className="kbana-card__meta">{kb.line}</span>
                    </div>
                    <div className="kbana-card__pills">
                      <AheadBehindPill flow={kb.pafyll} sched={sched} nowMins={nowMins} />
                      <StatusPill {...kb.pafyll} />
                    </div>
                  </div>

                  {/* Staffing strip */}
                  <div className="kbana-card__staffing">
                    {staffingMap?.[normKbana(kb.kbana)]?.p1 > 0 && <span className="staffing-shift">P1</span>}
                    {staffingMap?.[normKbana(kb.kbana)]?.p2 > 0 && <span className="staffing-shift">P2</span>}
                    {staffingMap?.[normKbana(kb.kbana)]?.p3 > 0 && <span className="staffing-shift">P3</span>}
                    {staffingMap?.[normKbana(kb.kbana)]?.p8 > 0 && <span className="staffing-shift">P8</span>}
                    {plannedW > 0 && (
                      <span className="staffing-shift" style={{ borderColor: workerColor + "44", background: workerColor + "15", color: workerColor }}>
                        {activeW}/{plannedW} nu
                      </span>
                    )}
                    {!kb.isPL && (
                      <button
                        className={"bastid-toggle" + (isGolv ? " bastid-toggle--golv" : "")}
                        onClick={() => toggleBastid(kb.kbana, bastid)}
                        title={`Bastid: ${bastid} min/kolli — klicka för att byta`}
                      >
                        {isGolv ? "Golv 2,8" : "Spår 1,8"}
                      </button>
                    )}
                    <div className="staffing-manual">
                      <input type="number" min="0" step="0.5" className="staffing-input"
                        value={manualBemanning[kb.kbana] ?? ""} placeholder="–"
                        onChange={e => setManualBemanning(prev => ({ ...prev, [kb.kbana]: e.target.value === "" ? "" : +e.target.value }))}
                      />
                      <span className="staffing-label">pers</span>
                    </div>
                  </div>

                  {/* Schedule / arbetstider */}
                  <div className="kbana-card__schedule">
                    <div className="pass-buttons">
                      {Object.entries(passes).map(([name, pass]) => {
                        if (!pass.start || !pass.end) return null;
                        const added = sched.some(w => w.start === pass.start && w.end === pass.end);
                        return (
                          <button key={name}
                            className={"pass-btn" + (added ? " pass-btn--active" : "")}
                            onClick={() => addPass(kb.kbana, name)}
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>
                    {sched.map((w, i) => (
                      <div key={i} className="schedule-row">
                        <input type="time" className="time-input" value={w.start}
                          onChange={e => updateWorker(kb.kbana, i, "start", e.target.value)} />
                        <span className="schedule-dash">–</span>
                        <input type="time" className="time-input" value={w.end}
                          onChange={e => updateWorker(kb.kbana, i, "end", e.target.value)} />
                        <button className="remove-worker-btn" onClick={() => removeWorker(kb.kbana, i)}>×</button>
                      </div>
                    ))}
                    <button className="add-worker-btn" onClick={() => addWorker(kb.kbana)}>+ Anpassad tid</button>
                  </div>

                  {/* Flow body */}
                  <div className="kbana-card__body">
                    <div className="block-label">{kb.isPL ? "PALLAR" : "PÅFYLLNINGAR"}</div>
                    <FlowBar {...kb.pafyll} />

                    {!kb.isPL && (
                      <WorkCalc
                        pafyll={kb.pafyll} kart={kb.kart}
                        pallKvar={pallKvar} pallKlart={pallKlart}
                        pers={pers} sched={sched} nowMins={nowMins} bastidMins={bastid}
                      />
                    )}

                    {kb.kart && (
                      <div className="block-spacer">
                        <div className="block-label">KARTONGER</div>
                        <FlowBar {...kb.kart} />
                      </div>
                    )}

                    {!kb.isPL && (
                      <div className="block-spacer">
                        <div className="block-label">HELPALLAR</div>
                        <div className="pall-manual__inputs">
                          <div className="pall-manual__field">
                            <span className="pall-manual__lbl" style={{ color: "var(--red)" }}>I KÖ</span>
                            <input type="number" min="0" className="pall-input"
                              value={pallMan?.iko ?? ""} placeholder={pallFile?.iko ?? "0"}
                              onChange={e => setPallVal(kb.kbana, "iko", e.target.value)} />
                          </div>
                          <div className="pall-manual__field">
                            <span className="pall-manual__lbl" style={{ color: "var(--yellow)" }}>PÅ VÄG</span>
                            <input type="number" min="0" className="pall-input"
                              value={pallMan?.pavag ?? ""} placeholder={pallFile?.pavag ?? "0"}
                              onChange={e => setPallVal(kb.kbana, "pavag", e.target.value)} />
                          </div>
                          <div className="pall-manual__field">
                            <span className="pall-manual__lbl" style={{ color: "var(--green)" }}>KLART</span>
                            <input type="number" min="0" className="pall-input"
                              value={pallMan?.klart ?? ""} placeholder={pallFile?.klart ?? "0"}
                              onChange={e => setPallVal(kb.kbana, "klart", e.target.value)} />
                          </div>
                        </div>
                        {pallFlow && <FlowBar {...pallFlow} />}
                      </div>
                    )}
                  </div>
                </Panel>
              );
            })}
          </div>

          {data.total && data.total.pafyll.total > 0 && (
            <Panel title="TOTALT" className="live-total">
              <div className="live-total__grid">
                <div><div className="block-label">PÅFYLLNINGAR</div><FlowBar {...data.total.pafyll} /></div>
                <div><div className="block-label">KARTONGER</div><FlowBar {...data.total.kart} /></div>
              </div>
            </Panel>
          )}

          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <ActionButton onClick={analyzeNow} disabled={aiLoading} style={{ flex: 1 }}>
              {aiLoading ? "Analyserar..." : "Analysera nuläge med AI"}
            </ActionButton>
            <ActionButton onClick={() => setData(null)}>Ladda ny fil</ActionButton>
          </div>

          {aiErr    && <Alert>{aiErr}</Alert>}
          {aiResult && (
            <Panel title="AI-ANALYS" className="ai-panel">
              <div style={{ whiteSpace: "pre-wrap", color: "var(--text)", fontSize: 13, lineHeight: 1.65 }}>
                {aiResult}
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
