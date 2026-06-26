export const defaultBastid = def => def.line.startsWith("Stn") ? 2.8 : 1.8;

// K61-36 before K61-7 so longer prefix matches first
const KBANA_LOC_PREFIXES = ["K61-36", "K61-7", "K51", "K52", "K53", "K55", "K56", "K58", "K59", "K60", "K62"];

export function classifyLocation(loc) {
  if (!loc) return null;
  const s = String(loc).trim().toUpperCase();
  for (const kb of KBANA_LOC_PREFIXES) {
    if (s.startsWith(kb)) return kb;
  }
  return null;
}

export function readFlow(R, coords) {
  const g = ([r, c]) => +R[r]?.[c] || 0;
  return { iko: g(coords.iko), pavag: g(coords.pavag), klart: g(coords.klart), total: g(coords.total) };
}

export const normKbana = s => String(s).replace(/[-\s]/g, "").toUpperCase();

export function toMins(str) {
  if (!str) return null;
  const [h, m] = str.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function getShiftBounds(sched) {
  let lo = Infinity, hi = -Infinity;
  for (const w of sched) {
    const s = toMins(w.start), e = toMins(w.end);
    if (s == null || e == null || e <= s) continue;
    lo = Math.min(lo, s); hi = Math.max(hi, e);
  }
  return lo === Infinity ? null : { startMins: lo, endMins: hi };
}

export function getWorkerStatus(sched, nowMins) {
  let active = 0, planned = 0;
  for (const w of sched) {
    const s = toMins(w.start), e = toMins(w.end);
    if (s == null || e == null || e <= s) continue;
    planned++;
    if (nowMins >= s && nowMins < e) active++;
  }
  return { active, planned };
}

// Formula: arbetsminuter = kolli × bastid + kartonger × 0.6 + pallar × 12
export function calcWork(pafyll, kart, pallKvar, pallKlart, pers, sched, nowMins, bastidMins) {
  if (!pafyll || !sched || !sched.length || !pers || pers <= 0) return null;
  const bounds = getShiftBounds(sched);
  if (!bounds) return null;
  const elapsedH = Math.max(0, nowMins - bounds.startMins) / 60;
  const remainH  = Math.max(0, bounds.endMins - nowMins) / 60;

  const pafyllKvar  = pafyll.iko + pafyll.pavag;
  const kartKvar    = kart ? kart.iko + kart.pavag : 0;
  const pafyllKlart = pafyll.klart;
  const kartKlart   = kart ? kart.klart : 0;

  const remainWork = pafyllKvar * bastidMins + kartKvar * 0.6 + pallKvar * 12;
  const doneWork   = pafyllKlart * bastidMins + kartKlart * 0.6 + pallKlart * 12;

  const availMins = pers * remainH * 60;
  const buffer    = availMins - remainWork;

  const spentMins = elapsedH * 60 * pers;
  const efficiency = spentMins > 3 ? (doneWork / spentMins) * 100 : null;

  return { remainWork, doneWork, availMins, buffer, efficiency, remainH, elapsedH };
}

export function fmtMins(mins) {
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.round(Math.abs(mins) % 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

export function calcLaneMetrics(pafyll, kart, pallKvar, pallKlart, pers, sched, nowMins, bastidMins) {
  const w = calcWork(pafyll, kart, pallKvar, pallKlart, pers, sched, nowMins, bastidMins);
  const { active } = getWorkerStatus(sched, nowMins);
  return {
    sen:      w ? w.buffer / 60 : null,
    pr:       w?.efficiency != null ? w.efficiency / 100 : null,
    tk:       w ? w.remainH : null,
    jobbKvar: w ? w.remainWork / 60 : null,
    bem:      active,
  };
}
