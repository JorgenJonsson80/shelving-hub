import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { C } from "../shared/theme";
import { ActionButton, Alert, Dropzone, PageHeader, Panel } from "../shared/components";
import { callAI } from "../shared/api";

const CELL_MAP = {
  kbanor: [
    { kbana: "K51",    line: "Line 1",   isPL: false,
      pafyll: { iko:[13,13], pavag:[15,13], klart:[17,13], total:[19,13] },
      kart:   { iko:[13,17], pavag:[15,17], klart:[17,17], total:[19,17] } },
    { kbana: "K52",    line: "Line 1/2", isPL: false,
      pafyll: { iko:[14,44], pavag:[16,44], klart:[18,44], total:[20,44] },
      kart:   { iko:[14,48], pavag:[16,48], klart:[18,48], total:[20,48] } },
    { kbana: "K53",    line: "Line 1/2", isPL: false,
      pafyll: { iko:[14,53], pavag:[16,53], klart:[18,53], total:[20,53] },
      kart:   { iko:[14,58], pavag:[16,58], klart:[18,58], total:[20,58] } },
    { kbana: "K56",    line: "Line 2/4", isPL: false,
      pafyll: { iko:[14,78], pavag:[16,78], klart:[18,78], total:[20,78] },
      kart:   { iko:[14,82], pavag:[16,82], klart:[18,82], total:[20,82] } },
    { kbana: "K58",    line: "Line 4/6", isPL: false,
      pafyll: { iko:[34,14], pavag:[35,14], klart:[36,14], total:[37,14] },
      kart:   { iko:[34,18], pavag:[35,18], klart:[36,18], total:[37,18] } },
    { kbana: "K59",    line: "Line 6/7", isPL: false,
      pafyll: { iko:[34,43], pavag:[35,43], klart:[36,43], total:[37,43] },
      kart:   { iko:[34,47], pavag:[35,47], klart:[36,47], total:[37,47] } },
    { kbana: "K60",    line: "Line 6/7", isPL: false,
      pafyll: { iko:[34,52], pavag:[35,52], klart:[36,52], total:[37,52] },
      kart:   { iko:[34,57], pavag:[35,57], klart:[36,57], total:[37,57] } },
    { kbana: "K61-7",  line: "Line 7",   isPL: false,
      pafyll: { iko:[34,80], pavag:[35,80], klart:[36,80], total:[37,80] },
      kart:   { iko:[34,84], pavag:[35,84], klart:[36,84], total:[37,84] } },
    { kbana: "K55",    line: "Stn 36",   isPL: false,
      pafyll: { iko:[51,11], pavag:[53,11], klart:[55,11], total:[58,11] },
      kart:   { iko:[51,15], pavag:[53,15], klart:[55,15], total:[58,15] } },
    { kbana: "K61-36", line: "Stn 36",   isPL: false,
      pafyll: { iko:[51,19], pavag:[53,19], klart:[55,19], total:[58,19] },
      kart:   { iko:[51,24], pavag:[53,24], klart:[55,24], total:[58,24] } },
    { kbana: "K62",    line: "Stn 50",   isPL: false,
      pafyll: { iko:[51,46], pavag:[53,46], klart:[55,46], total:[58,46] },
      kart:   { iko:[51,51], pavag:[53,51], klart:[55,51], total:[58,51] } },
    { kbana: "PL09",   line: "Pallar",   isPL: true,
      pafyll: { iko:[67,16], pavag:[68,16], klart:[69,16], total:[70,16] },
      kart:   null },
  ],
  pallarPerK: {
    "K51":   { iko:[67,22], pavag:[68,22], klart:[69,22], total:[70,22] },
    "K52":   { iko:[67,25], pavag:[68,25], klart:[69,25], total:[70,25] },
    "K53":   { iko:[67,41], pavag:[68,41], klart:[69,41], total:[70,41] },
    "K56":   { iko:[67,45], pavag:[68,45], klart:[69,45], total:[70,45] },
    "K58":   { iko:[67,50], pavag:[68,50], klart:[69,50], total:[70,50] },
    "K59":   { iko:[67,56], pavag:[68,56], klart:[69,56], total:[70,56] },
    "K60":   { iko:[67,61], pavag:[68,61], klart:[69,61], total:[70,61] },
    "K61-7": { iko:[67,74], pavag:[68,74], klart:[69,74], total:[70,74] },
  },
  total: {
    pafyll: { iko:[48,79], pavag:[50,79], klart:[52,79], total:[54,79] },
    kart:   { iko:[48,83], pavag:[50,83], klart:[52,83], total:[54,83] },
  },
};

// Default bastid by line type: spår (Line*) = 1.8 min, golv (Stn*) = 2.8 min
const defaultBastid = def =>
  def.line.startsWith("Stn") ? 2.8 : 1.8;

function readFlow(R, coords) {
  const g = ([r, c]) => +R[r]?.[c] || 0;
  return { iko: g(coords.iko), pavag: g(coords.pavag), klart: g(coords.klart), total: g(coords.total) };
}

const normKbana = s => String(s).replace(/[-\s]/g, "").toUpperCase();

function toMins(str) {
  if (!str) return null;
  const [h, m] = str.split(":").map(Number);
  return h * 60 + (m || 0);
}

function getShiftBounds(sched) {
  let lo = Infinity, hi = -Infinity;
  for (const w of sched) {
    const s = toMins(w.start), e = toMins(w.end);
    if (s == null || e == null || e <= s) continue;
    lo = Math.min(lo, s); hi = Math.max(hi, e);
  }
  return lo === Infinity ? null : { startMins: lo, endMins: hi };
}

function getWorkerStatus(sched, nowMins) {
  let active = 0, planned = 0;
  for (const w of sched) {
    const s = toMins(w.start), e = toMins(w.end);
    if (s == null || e == null || e <= s) continue;
    planned++;
    if (nowMins >= s && nowMins < e) active++;
  }
  return { active, planned };
}

/**
 * Formula: arbetsminuter = kolli × bastid + kartonger × 0.6 + pallar × 12
 * Returns { remainWork, doneWork, availMins, buffer, efficiency }
 * All in minutes (person-minutes for remain/done, minutes for avail/buffer).
 */
function calcWork(pafyll, kart, pallKvar, pallKlart, pers, sched, nowMins, bastidMins) {
  if (!pafyll || !sched || !sched.length || !pers || pers <= 0) return null;
  const bounds = getShiftBounds(sched);
  if (!bounds) return null;
  const elapsedH = Math.max(0, nowMins - bounds.startMins) / 60;
  const remainH  = Math.max(0, bounds.endMins - nowMins) / 60;

  const pafyllKvar  = pafyll.iko + pafyll.pavag;
  const kartKvar    = kart ? kart.iko + kart.pavag : 0;
  const pafyllKlart = pafyll.klart;
  const kartKlart   = kart ? kart.klart : 0;

  // person-minutes of work remaining and done
  const remainWork = pafyllKvar * bastidMins + kartKvar * 0.6 + pallKvar * 12;
  const doneWork   = pafyllKlart * bastidMins + kartKlart * 0.6 + pallKlart * 12;

  // available person-minutes left in shift
  const availMins = pers * remainH * 60;
  const buffer    = availMins - remainWork;

  // efficiency: done work vs time × persons spent
  const spentMins = elapsedH * 60 * pers;
  const efficiency = spentMins > 3 ? (doneWork / spentMins) * 100 : null;

  return { remainWork, doneWork, availMins, buffer, efficiency, remainH, elapsedH };
}

function fmtMins(mins) {
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.round(Math.abs(mins) % 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

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
          kbana: def.kbana, line: def.line, isPL: def.isPL,
          pafyll: readFlow(R, def.pafyll),
          kart:   def.kart ? readFlow(R, def.kart) : null,
        }));
        const pallarPerK = Object.fromEntries(
          Object.entries(CELL_MAP.pallarPerK).map(([k, coords]) => [k, readFlow(R, coords)])
        );
        const total = { pafyll: readFlow(R, CELL_MAP.total.pafyll), kart: readFlow(R, CELL_MAP.total.kart) };
        const allZero = kbanor.every(k => k.pafyll.total === 0 && !k.isPL);
        if (allZero) throw new Error("Alla värden är noll — fel fil eller flik? Kontrollera att det är Visualisering-filen (Infattning SDS).");
        resolve({ kbanor: kbanor.filter(k => k.pafyll.total > 0 || k.isPL), pallarPerK, total, fileName: file.name, loaded: new Date().toLocaleTimeString("sv-SE") });
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ── UI components ──────────────────────────────────────────

function FlowBar({ iko, pavag, klart, total }) {
  if (!total) return <div style={{ color: "var(--dim)", fontSize: 12 }}>Ingen data</div>;
  return (
    <div>
      <div className="flow-bar__track">
        <div className="flow-bar__segment" style={{ width: (iko / total * 100) + "%",   background: "var(--red)" }} />
        <div className="flow-bar__segment" style={{ width: (pavag / total * 100) + "%", background: "var(--yellow)" }} />
        <div className="flow-bar__segment" style={{ width: (klart / total * 100) + "%", background: "var(--green)" }} />
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
    <span className="status-pill" style={{ color, background: color + "20", border: "1px solid " + color + "44" }}>
      {label}
    </span>
  );
}

function AheadBehindPill({ flow, sched, nowMins }) {
  if (!sched || !sched.length || !flow || !flow.total) return null;
  const bounds = getShiftBounds(sched);
  if (!bounds) return null;
  const totalShiftMins = bounds.endMins - bounds.startMins;
  if (totalShiftMins <= 0) return null;
  const timeProg = Math.min(1, Math.max(0, nowMins - bounds.startMins) / totalShiftMins);
  const flowProg = flow.klart / flow.total;
  const delta = flowProg - timeProg;
  let label, color;
  if      (delta >  0.08) { label = `FÖRE +${Math.round(delta * 100)}%`; color = C.green;  }
  else if (delta < -0.08) { label = `EFTER ${Math.round(delta * 100)}%`; color = C.red;    }
  else                    { label = "I TID";                              color = C.yellow; }
  return (
    <span className="progress-pill" style={{ color, background: color + "20", border: "1px solid " + color + "44" }}>
      {label}
    </span>
  );
}

function WorkCalc({ pafyll, kart, pallKvar, pallKlart, pers, sched, nowMins, bastidMins }) {
  const w = calcWork(pafyll, kart, pallKvar, pallKlart, pers, sched, nowMins, bastidMins);
  if (!w) return null;

  const onTrack = w.buffer >= 0;
  const bufferColor = onTrack ? C.green : C.red;
  const effColor = w.efficiency == null ? "var(--dim)"
    : w.efficiency >= 90 ? C.green
    : w.efficiency >= 70 ? C.yellow
    : C.red;

  return (
    <div className="work-calc">
      <div className="work-calc__item">
        <span className="work-calc__lbl">Kvar</span>
        <span className="work-calc__val">{fmtMins(w.remainWork)}</span>
      </div>
      <div className="work-calc__item">
        <span className="work-calc__lbl">Buffert</span>
        <span className="work-calc__val" style={{ color: bufferColor }}>
          {onTrack ? "+" : "–"}{fmtMins(w.buffer)}
        </span>
      </div>
      {w.efficiency != null && (
        <div className="work-calc__item">
          <span className="work-calc__lbl">Effektivitet</span>
          <span className="work-calc__val" style={{ color: effColor }}>
            {Math.round(w.efficiency)}%
          </span>
        </div>
      )}
    </div>
  );
}

function ScheduleOverview({ kbanor, schedule, nowMins }) {
  const items = kbanor.filter(kb => !kb.isPL).map(kb => {
    const sched = schedule[kb.kbana] || [];
    if (!sched.length) return { kbana: kb.kbana, status: "none" };
    const bounds = getShiftBounds(sched);
    const { active, planned } = getWorkerStatus(sched, nowMins);
    if (!bounds) return { kbana: kb.kbana, status: "none" };
    if (nowMins < bounds.startMins) return { kbana: kb.kbana, status: "upcoming", active, planned, minsUntil: bounds.startMins - nowMins };
    if (nowMins >= bounds.endMins)  return { kbana: kb.kbana, status: "done",     active, planned };
    return { kbana: kb.kbana, status: active > 0 ? "active" : "missing", active, planned };
  });

  if (items.every(i => i.status === "none")) return null;

  const missing = items.filter(i => i.status === "missing").map(i => i.kbana);

  return (
    <Panel title="SCHEMAÖVERSIKT" className="schedule-overview">
      <div className="schedule-overview__grid">
        {items.map(({ kbana, status, active, planned, minsUntil }) => {
          let color, label;
          if      (status === "active")   { color = C.green;           label = `${active}/${planned} pers`; }
          else if (status === "missing")  { color = C.red;             label = "SAKNAS"; }
          else if (status === "upcoming") {
            color = C.yellow;
            const h = Math.floor(minsUntil / 60), m = minsUntil % 60;
            label = `om ${h > 0 ? h + "h " : ""}${m}min`;
          }
          else if (status === "done")     { color = "var(--dim)";      label = "Avslutat"; }
          else                            { color = "var(--border-2)"; label = "–"; }
          return (
            <div key={kbana} className="schedule-chip" style={{ borderColor: color + "55" }}>
              <span className="schedule-chip__name" style={{ color: "var(--text-dim)" }}>{kbana}</span>
              <span className="schedule-chip__val"  style={{ color }}>{label}</span>
            </div>
          );
        })}
      </div>
      {missing.length > 0 && (
        <div className="schedule-overview__alert">
          Obemannade nu: {missing.join(", ")}
        </div>
      )}
    </Panel>
  );
}

const DEFAULT_PASSES = {
  P1: { start: "06:00", end: "14:00" },
  P2: { start: "14:00", end: "22:00" },
  P3: { start: "22:00", end: "06:00" },
  P8: { start: "06:00", end: "14:00" },
};

function PassSettings({ passes, onChange }) {
  return (
    <Panel title="PASS-TIDER" className="pass-settings">
      <div className="pass-settings__grid">
        {Object.entries(passes).map(([name, { start, end }]) => (
          <div key={name} className="pass-settings__row">
            <span className="pass-settings__name">{name}</span>
            <input type="time" className="time-input" value={start}
              onChange={e => onChange(name, "start", e.target.value)} />
            <span className="schedule-dash">–</span>
            <input type="time" className="time-input" value={end}
              onChange={e => onChange(name, "end", e.target.value)} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

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

  const getBastid = (kb) => bastidPerK[kb.kbana] ?? defaultBastid(kb);
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
  const addPass = (kbana, passName) => {
    const pass = passes[passName];
    if (!pass?.start || !pass?.end) return;
    setSchedule(prev => {
      const cur = prev[kbana] || [];
      if (cur.some(w => w.start === pass.start && w.end === pass.end)) return prev;
      return { ...prev, [kbana]: [...cur, { start: pass.start, end: pass.end }] };
    });
  };
  const updatePass = (name, field, val) =>
    setPasses(prev => ({ ...prev, [name]: { ...prev[name], [field]: val } }));
  const removeWorker = (kbana, idx)       => setSchedule(prev => ({ ...prev, [kbana]: (prev[kbana] || []).filter((_, i) => i !== idx) }));
  const updateWorker = (kbana, idx, f, v) => setSchedule(prev => {
    const list = [...(prev[kbana] || [])]; list[idx] = { ...list[idx], [f]: v }; return { ...prev, [kbana]: list };
  });

  const analyzeNow = () => {
    if (!data) return;
    setAiLoading(true); setAiResult(null); setAiErr(null);

    const nowStr = now.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
    const activeKbanor = data.kbanor.filter(kb => !kb.isPL);
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
              const hasManualPall = pallMan && Object.values(pallMan).some(v => v !== "" && +v > 0);
              const src = hasManualPall ? pallMan : pallFile;
              const pallFlow = src && (+(src.iko||0) + +(src.pavag||0) + +(src.klart||0)) > 0
                ? { iko: +(src.iko||0), pavag: +(src.pavag||0), klart: +(src.klart||0), total: +(src.iko||0) + +(src.pavag||0) + +(src.klart||0) }
                : null;
              const pallKvar  = src ? +(src.iko||0) + +(src.pavag||0) : 0;
              const pallKlart = src ? +(src.klart||0) : 0;

              const sched = schedule[kb.kbana] || [];
              const { active: activeW, planned: plannedW } = getWorkerStatus(sched, nowMins);
              const workerColor = !plannedW ? "var(--dim)"
                : activeW === 0 ? C.red
                : activeW < plannedW ? C.yellow
                : C.green;

              const pers    = +(manualBemanning[kb.kbana] || 0);
              const bastid  = getBastid(kb);
              const isGolv  = bastid === 2.8;

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
                    {/* Quick-add pass buttons */}
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
