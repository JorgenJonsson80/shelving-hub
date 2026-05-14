import { C } from "../../shared/theme";
import { Panel } from "../../shared/components";
import {
  calcWork, getShiftBounds, getWorkerStatus, fmtMins, toMins,
} from "../../shared/liveUtils";

export function FlowBar({ iko, pavag, klart, total }) {
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

export function StatusPill({ total, iko, klart }) {
  const label = klart === total && total > 0 ? "KLART" : iko > 0 ? "I KÖ" : "PÅ VÄG";
  const color = klart === total && total > 0 ? C.green : iko > 0 ? C.red : C.yellow;
  return (
    <span className="status-pill" style={{ color, background: color + "20", border: "1px solid " + color + "44" }}>
      {label}
    </span>
  );
}

export function AheadBehindPill({ flow, sched, nowMins }) {
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

export function WorkCalc({ pafyll, kart, pallKvar, pallKlart, pers, sched, nowMins, bastidMins }) {
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

export function ScheduleOverview({ kbanor, schedule, nowMins }) {
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

export function PassSettings({ passes, onChange }) {
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
