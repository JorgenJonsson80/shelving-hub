import { useState, useEffect, useMemo } from "react";
import { C } from "../shared/theme";
import { ActionButton, Alert, Dropzone, PageHeader, Panel } from "../shared/components";
import { defaultBastid, normKbana, getWorkerStatus, calcLaneMetrics } from "../shared/liveUtils";
import { parseLive, parseStaffingFile } from "../shared/parsers";
import {
  FlowBar, StatusPill, AheadBehindPill, WorkCalc, ScheduleOverview, PassSettings,
} from "./live/LiveSubComponents";

const TROSKEL_TRIVIAL = 0.3;
const TROSKEL_KRIS    = -0.3;
const TROSKEL_LEDIG   =  0.5;

function fmtH(h) {
  if (h == null) return "–";
  const sign = h < 0 ? "–" : "+";
  return sign + Math.abs(h).toFixed(1) + "h";
}
function sigColor(sen) {
  if (sen == null) return C.dim;
  if (sen < -1)   return C.red;
  if (sen < -0.3) return C.yellow;
  if (sen >  0.5) return C.green;
  return C.textDim;
}
function pColor(pr) {
  if (pr == null) return C.dim;
  if (pr < 0.8)  return C.yellow;
  if (pr > 1.1)  return C.green;
  return C.text;
}

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

  const getBastid = (kb) => bastidPerK[kb.kbana] ?? defaultBastid(kb);

  // ── EN beräkningsmodell ───────────────────────────────────────────────────
  const analys = useMemo(() => {
    if (!data) return null;
    const banor = data.kbanor.filter(kb => !kb.isPL).map(kb => {
      const bastid   = bastidPerK[kb.kbana] ?? defaultBastid(kb);
      const sched    = schedule[kb.kbana] || [];
      const pers     = +(manualBemanning[kb.kbana] || 0);
      const pallFile = data.pallarPerK[kb.kbana];
      const pallMan  = manualPall[kb.kbana];
      const getPall  = f => { const m = pallMan?.[f]; return (m !== undefined && m !== "") ? +m : +(pallFile?.[f] || 0); };
      const pallKvar  = getPall("iko") + getPall("pavag");
      const pallKlart = getPall("klart");

      const { sen, pr, tk, jobbKvar, bem } = calcLaneMetrics(
        kb.pafyll, kb.kart, pallKvar, pallKlart, pers, sched, nowMins, bastid
      );
      if (sen === null) return { id: kb.kbana, sen: 0, pr, tk: 0, jobbKvar: 0, bem, kategori: "saknas" };

      const isLowPr  = pr != null && pr < 0.8;
      const isHighPr = pr != null && pr > 1.1;
      let kategori;
      if (sen < TROSKEL_KRIS) {
        if (isHighPr)     kategori = "overbelastad";
        else if (isLowPr) kategori = "struktur";
        else              kategori = "underbemannad";
      } else if (sen > TROSKEL_LEDIG) {
        kategori = (isLowPr && bem >= 2) ? "overbemannad" : "klar";
      } else {
        kategori = "balans";
      }
      return { id: kb.kbana, sen, pr, tk: tk ?? 0, jobbKvar: jobbKvar ?? 0, bem, kategori };
    });

    const lediga = banor
      .filter(b => (b.kategori === "klar" || b.kategori === "overbemannad") && b.sen >= TROSKEL_LEDIG && b.bem >= 2)
      .sort((a, b) => b.sen - a.sen);
    const kriser = banor
      .filter(b => b.sen < TROSKEL_KRIS)
      .sort((a, b) => a.sen - b.sen);

    return { banor, lediga, kriser };
  }, [data, manualBemanning, manualPall, schedule, nowMins, bastidPerK]);

  // ── Åtgärdsplan från EN matchningsloop ───────────────────────────────────
  const atgarder = useMemo(() => {
    if (!analys) return [];
    const out = [];
    const ledigaKvar = analys.lediga.map(b => ({ ...b }));

    analys.kriser.forEach(kris => {
      if (kris.kategori === "struktur") {
        out.push({
          typ: "undersok", prioritet: Math.abs(kris.sen) * 5, lane: kris.id,
          rubrik: `Undersök ${kris.id}`,
          text: `${kris.jobbKvar.toFixed(1)}h kvar, prestation ${kris.pr != null ? (kris.pr * 100).toFixed(0) + "%" : "–"}. Lågt tempo trots underskott — kolla godsfördelning, utrustning eller kompetens.`,
        });
        return;
      }
      const givare = ledigaKvar.find(l => l.sen >= 1.0);
      if (givare) {
        out.push({
          typ: "flytta", prioritet: Math.abs(kris.sen) * 10, lane: kris.id,
          rubrik: `Flytta ${givare.id} → ${kris.id}`,
          text: `${kris.id} saknar ${Math.abs(kris.sen).toFixed(1)}h (prest ${kris.pr != null ? (kris.pr * 100).toFixed(0) + "%" : "–"}). ${givare.id} har +${givare.sen.toFixed(1)}h över.`,
        });
        givare.sen -= Math.min(Math.abs(kris.sen), givare.sen);
        if (givare.sen < TROSKEL_LEDIG) {
          const i = ledigaKvar.indexOf(givare);
          if (i >= 0) ledigaKvar.splice(i, 1);
        }
      } else {
        out.push({
          typ: "olost", prioritet: Math.abs(kris.sen) * 9, lane: kris.id,
          rubrik: `${kris.id} saknar resurser`,
          text: `${kris.id} ligger back ${Math.abs(kris.sen).toFixed(1)}h och det finns ingen ledig bana att låna från.`,
          olostTimmar: Math.abs(kris.sen),
        });
      }
    });
    return out;
  }, [analys]);

  // ── Övertidsbeslut: EN gång, baserat på olösta ───────────────────────────
  const overtid = useMemo(() => {
    const olosta = atgarder.filter(a => a.typ === "olost");
    if (!olosta.length) return null;
    const timmar = olosta.reduce((s, a) => s + a.olostTimmar, 0);
    return {
      banor: olosta.map(a => a.lane), timmar,
      text: `Inga lediga resurser kvar — ${olosta.length} ${olosta.length === 1 ? "bana" : "banor"} ligger back (${olosta.map(a => a.lane).join(", ")}). Underskott ${timmar.toFixed(1)}h. Överväg övertid eller extra personal (~${timmar.toFixed(1)} persontimmar).`,
    };
  }, [atgarder]);
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

  // ── Härledda vyer ─────────────────────────────────────────────────────────
  const riskzon = analys?.banor
    .filter(b => b.sen < -TROSKEL_TRIVIAL)
    .sort((a, b) => a.sen - b.sen) ?? [];

  const synligaAtgarder = atgarder
    .filter(a => a.typ !== "olost")
    .sort((a, b) => b.prioritet - a.prioritet)
    .slice(0, 5);

  const dolda = atgarder.filter(a => a.typ !== "olost").length - synligaAtgarder.length;

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

          {/* ── Utsago-sektion v2 ── */}
          {(overtid || riskzon.length > 0 || synligaAtgarder.length > 0) && (
            <div style={{ marginBottom: 8 }}>
              {overtid && (
                <div className="alert-panel" style={{ marginBottom: 8 }}>
                  <div className="alert-panel__head">
                    <span>⏰ KAPACITETSGLAPP — ÖVERTID?</span>
                  </div>
                  <div style={{ padding: "10px 14px", fontSize: 13, color: C.text, lineHeight: 1.6 }}>
                    {overtid.text}
                  </div>
                </div>
              )}

              {riskzon.length > 0 && (
                <div className="section-card" style={{ marginBottom: 8 }}>
                  <div className="section-card__header section-card__header--accent">RISKZON</div>
                  <div className="section-card__body section-card__body--flush">
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ color: C.dim, borderBottom: `1px solid ${C.border}` }}>
                          <th style={{ padding: "6px 12px", textAlign: "left",  fontWeight: 600, fontSize: 11 }}>BANA</th>
                          <th style={{ padding: "6px 12px", textAlign: "right", fontWeight: 600, fontSize: 11 }}>BUFFERT</th>
                          <th style={{ padding: "6px 12px", textAlign: "right", fontWeight: 600, fontSize: 11 }}>JOBB KVAR</th>
                          <th style={{ padding: "6px 12px", textAlign: "right", fontWeight: 600, fontSize: 11 }}>TID</th>
                          <th style={{ padding: "6px 12px", textAlign: "right", fontWeight: 600, fontSize: 11 }}>PREST</th>
                        </tr>
                      </thead>
                      <tbody>
                        {riskzon.map(b => (
                          <tr key={b.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                            <td style={{ padding: "7px 12px", color: C.text, fontWeight: 700 }}>{b.id}</td>
                            <td style={{ padding: "7px 12px", textAlign: "right", color: sigColor(b.sen), fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtH(b.sen)}</td>
                            <td style={{ padding: "7px 12px", textAlign: "right", color: C.textDim, fontVariantNumeric: "tabular-nums" }}>{b.jobbKvar.toFixed(1)}h</td>
                            <td style={{ padding: "7px 12px", textAlign: "right", color: C.textDim, fontVariantNumeric: "tabular-nums" }}>{b.tk.toFixed(1)}h</td>
                            <td style={{ padding: "7px 12px", textAlign: "right", color: pColor(b.pr), fontVariantNumeric: "tabular-nums" }}>{b.pr != null ? (b.pr * 100).toFixed(0) + "%" : "–"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {synligaAtgarder.length > 0 && (
                <div className="section-card" style={{ marginBottom: 8 }}>
                  <div className="section-card__header section-card__header--accent">ÅTGÄRDER</div>
                  <div className="section-card__body">
                    {synligaAtgarder.map((a, i) => (
                      <div key={i} style={{ padding: "10px 0", borderBottom: i < synligaAtgarder.length - 1 ? `1px solid ${C.border}` : "none" }}>
                        <div style={{ fontWeight: 700, color: a.typ === "flytta" ? C.yellow : C.blue, marginBottom: 3, fontSize: 13 }}>
                          {a.rubrik}
                        </div>
                        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.55 }}>{a.text}</div>
                      </div>
                    ))}
                    {dolda > 0 && (
                      <div style={{ marginTop: 8, fontSize: 11, color: C.dim, textAlign: "center" }}>
                        + {dolda} fler åtgärder
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

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

          <ActionButton onClick={() => setData(null)}>Ladda ny fil</ActionButton>
        </div>
      )}
    </div>
  );
}
