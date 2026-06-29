export const defaultBastid = def => def.line.startsWith("Stn") ? 2.8 : 1.8;

export function classifyLocation(loc) {
  if (!loc) return null;
  const s = String(loc).trim().toUpperCase();

  // K-prefix format (legacy)
  for (const kb of ["K61-36", "K61-7", "K51", "K52", "K53", "K55", "K56", "K58", "K59", "K60", "K62"]) {
    if (s.startsWith(kb)) return kb;
  }

  // P-prefix format
  if (s.startsWith("PD")) return "K62";
  if (!/^P\d/.test(s)) return null;
  const stn = parseInt(s.substring(3, 5), 10);
  if (isNaN(stn)) return null;
  const afterDash = s.split("-")[1] || "";
  const lplMatch = afterDash.match(/^(\d+)/);
  const lpl = lplMatch ? parseInt(lplMatch[1], 10) : null;
  const lastDigit = lpl !== null ? lpl % 10 : null;
  const isEven = lastDigit !== null && lastDigit % 2 === 0;
  const isOdd  = lastDigit !== null && lastDigit % 2 === 1;
  const t7 = s[6], t8 = s[7], t10 = s[9], t11 = s[10];
  const t1011 = (t10 || "") + (t11 || "");
  // P3 → allt till K55 tills vidare (K55/K61-36-split utkommenterad nedan)
  if (s.startsWith("P3")) return "K55";
  // if (s.startsWith("P3")) {
  //   const t7d = /[0-9]/.test(t7 || "");
  //   const n = parseInt(t1011, 10);
  //   if (t7d || t8 === "A" || (t8 === "B" && !isNaN(n) && n >= 1 && n <= 13)) return "K55";
  // }
  // if (stn === 36) return "K61-36";
  if (s.startsWith("P101")) {
    if (isEven) return "K51";
    if (isOdd && stn >= 10 && stn <= 14) return "K52";
    if (isOdd && stn >= 15 && stn <= 18) return "K53";
  }
  if (s.startsWith("P102")) {
    if (isEven) return "K56";
    if (isOdd && stn >= 20 && stn <= 23) return "K53";
    if (isOdd && stn >= 24 && stn <= 27) return "K52";
  }
  if (s.startsWith("P4")) { if (isEven) return "K58"; if (isOdd) return "K56"; }
  if (s.startsWith("P6")) {
    if (isEven) return "K58";
    if (isOdd && stn >= 60 && stn <= 67) {
      if (lpl !== null) { if (lpl <= 43) return "K60"; if (lpl >= 45) return "K59"; }
    }
  }
  if (s.startsWith("P7")) {
    if (isEven) return "K61-7";
    if (isOdd && stn >= 71 && stn <= 77) {
      if (lpl !== null) { if (lpl <= 81) return "K59"; if (lpl >= 83) return "K60"; }
    }
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
