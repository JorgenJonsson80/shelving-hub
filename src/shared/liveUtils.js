import { CELL_MAP } from "./cellMap";

// Kalibrerad 2026-07-08 mot ~20 dagars historik + användarens egna
// ingenjörsmål (60 kartonger/timme). Kolli-bastiderna (Spår/Golv) väntar
// kvar på mer historik innan de omkalibreras — se minnesanteckningar.
export const KARTONG_MIN = 1.0;

export const defaultBastid = def => def.line.startsWith("Stn") ? 2.8 : 1.8;

// Bastid lookup from just a K-bana code (no `line` info available, e.g. in
// Historik/Brief's daily-file rows). K63 är bekräftat Golv men saknas i
// CELL_MAP (ingen cell-koordinat-mappning finns för den i Live-flikens
// Excel-format), så den specialhanteras här istället för att läggas in i
// CELL_MAP med påhittade koordinater. Övriga okända K-banor faller
// tillbaka på 1.8 (Spår), matchar defaultBastid:s eget default.
export function bastidForKbana(kbana) {
  if (kbana === "K63") return 2.8;
  const def = CELL_MAP.kbanor.find(kb => kb.kbana === kbana);
  return def ? defaultBastid(def) : 1.8;
}

// Samma formel som rekommenderadBemanning, men uppdelad per drivare (kolli/
// kart/pall) så att man kan visa *varför* en K-bana behöver den bemanning
// den gör, inte bara totalen. kolliPers+kartPers+pallPers === total.
export function rekommenderadBemanningBreakdown(kbana, kolli, kart, helpall, shiftMins = 8 * 60) {
  const bastid = bastidForKbana(kbana);
  const kolliPers = (kolli * bastid) / shiftMins;
  const kartPers = (kart * KARTONG_MIN) / shiftMins;
  const pallPers = (helpall * 12) / shiftMins;
  return { kolliPers, kartPers, pallPers, total: kolliPers + kartPers + pallPers };
}

// Rekommenderad bemanning för en hel dags volym på en K-bana, givet en
// standard skiftlängd (8h). arbetsminuter-formeln matchar calcWork nedan.
export function rekommenderadBemanning(kbana, kolli, kart, helpall, shiftMins = 8 * 60) {
  return rekommenderadBemanningBreakdown(kbana, kolli, kart, helpall, shiftMins).total;
}

export function classifyLocation(loc) {
  if (!loc) return null;
  const s = String(loc).trim().toUpperCase();

  // K-prefix format (legacy). K61-36 (Stn 36) was permanently retired
  // 2026-09 — that line's volume now belongs to K55, so any leftover
  // legacy-format code still tagged K61-36 is remapped here too.
  for (const kb of ["K61-36", "K61-7", "K51", "K52", "K53", "K55", "K56", "K58", "K59", "K60", "K62"]) {
    if (s.startsWith(kb)) return kb === "K61-36" ? "K55" : kb;
  }

  // P-prefix format
  if (s.startsWith("PD")) return "K62";
  if (s.startsWith("PH")) return "K63";
  if (!/^P\d/.test(s)) return null;
  const stn = parseInt(s.substring(3, 5), 10);
  if (isNaN(stn)) return null;
  const afterDash = s.split("-")[1] || "";
  const lplMatch = afterDash.match(/^(\d+)/);
  const lpl = lplMatch ? parseInt(lplMatch[1], 10) : null;
  const lastDigit = lpl !== null ? lpl % 10 : null;
  const isEven = lastDigit !== null && lastDigit % 2 === 0;
  const isOdd  = lastDigit !== null && lastDigit % 2 === 1;
  // P3 → allt till K55. Det fanns tidigare en uppdelningslogik som gav vissa
  // P3-koder K61-36 istället (bevarad i git-historiken, commit a6b655e och
  // tidigare) — borttagen helt (inte bara avstängd) sen K61-36 permanent
  // lades ned 2026-09, det finns inget kvar att dela upp mot.
  if (s.startsWith("P3")) return "K55";
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

// "% above/below a baseline" — shared by every DeltaChip caller so the guard
// (no divide-by-zero/negative-baseline surprises) only needs maintaining in
// one place. Previously reimplemented independently at ~7 call sites across
// Historik/Prognos/Brief/Live, each with its own slightly-different guard.
export function pctDelta(value, base) {
  return (base != null && base > 0) ? ((value - base) / base) * 100 : null;
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

// Person-minutes actually worked between startMins and nowMins, honoring any
// recorded pers-changes in between instead of assuming today's current
// headcount applied for the whole elapsed shift. Without that, bumping the
// headcount mid-shift retroactively (and wrongly) drags measured efficiency
// down for hours nobody was understaffed, and removing someone inflates it —
// see persHistory shape: [{ mins, pers }, ...], already filtered to today.
export function spentPersonMins(persHistory, startMins, nowMins, currentPers) {
  const points = (persHistory || [])
    .filter(h => h.mins > startMins && h.mins <= nowMins)
    .sort((a, b) => a.mins - b.mins);
  const before = (persHistory || [])
    .filter(h => h.mins <= startMins)
    .sort((a, b) => b.mins - a.mins)[0];
  // No record covering the start of the shift — best guess is whatever the
  // earliest known value is (or the current one if there's no history at all).
  const startPers = before ? before.pers : (points[0]?.pers ?? currentPers);

  const bounds = [{ mins: startMins, pers: startPers }, ...points, { mins: nowMins, pers: currentPers }];
  let total = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    const dur = bounds[i + 1].mins - bounds[i].mins;
    if (dur > 0) total += dur * bounds[i].pers;
  }
  return Math.max(0, total);
}

// Formula: arbetsminuter = kolli × bastid + kartonger × 0.6 + pallar × 12
//
// `forecastKolli` / `forecastKart` (optional) are expected-remaining PF /
// cartons for this K-bana for the rest of today, from Prognos.jsx's
// per-K-bana forecast — otherwise remainWork only ever reflects what's
// already sitting in queue right now, so a lane looks comfortably ahead all
// morning and then falls off a cliff the moment a forecasted wave (e.g. a
// midday release) actually lands.
export function calcWork(pafyll, kart, pallKvar, pallKlart, pers, sched, nowMins, bastidMins, persHistory, forecastKolli = 0, forecastKart = 0) {
  if (!pafyll || !sched || !sched.length || !pers || pers <= 0) return null;
  const bounds = getShiftBounds(sched);
  if (!bounds) return null;
  const elapsedH = Math.max(0, nowMins - bounds.startMins) / 60;
  const remainH  = Math.max(0, bounds.endMins - nowMins) / 60;

  const pafyllKvar  = pafyll.iko + pafyll.pavag;
  const kartKvar    = kart ? kart.iko + kart.pavag : 0;
  const pafyllKlart = pafyll.klart;
  const kartKlart   = kart ? kart.klart : 0;
  const forecastKvar     = Math.max(0, forecastKolli || 0);
  const forecastKartKvar = Math.max(0, forecastKart || 0);

  const remainWork = (pafyllKvar + forecastKvar) * bastidMins + (kartKvar + forecastKartKvar) * KARTONG_MIN + pallKvar * 12;
  // Queue only, no forecast — what "Klart vid nuv. takt" projects forward.
  // remainWork above is deliberately forecast-inclusive (a shift-level "will
  // today's expected volume fit" check, see Buffert), but forecastKvar/
  // forecastKartKvar are PF/cartons Prognos expects to *arrive later today*,
  // not stuff sitting in queue now. Projecting an ETA off remainWork treats
  // that not-yet-arrived volume as if it were already queued and had to be
  // cleared starting this instant, which produced absurd finish times (e.g.
  // "01:15" with a handful of cartons actually in queue) — see 2026-08-24
  // report. queueWork keeps the ETA meaning "at this pace, when do I clear
  // what I can actually see right now."
  const queueWork  = pafyllKvar * bastidMins + kartKvar * KARTONG_MIN + pallKvar * 12;
  const doneWork   = pafyllKlart * bastidMins + kartKlart * KARTONG_MIN + pallKlart * 12;

  const availMins = pers * remainH * 60;
  const buffer    = availMins - remainWork;

  const spentMins = spentPersonMins(persHistory, bounds.startMins, nowMins, pers);
  const efficiency = spentMins > 3 ? (doneWork / spentMins) * 100 : null;

  return { remainWork, queueWork, doneWork, availMins, buffer, efficiency, remainH, elapsedH, endMins: bounds.endMins, forecastKvar, forecastKartKvar };
}

export function fmtMins(mins) {
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.round(Math.abs(mins) % 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

// Clock-time formatting for an absolute minutes-since-midnight value that may
// roll past 24h (e.g. an ETA computed from a large remaining workload).
export function fmtClock(mins) {
  const rolled = mins >= 1440;
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}${rolled ? " (+1d)" : ""}`;
}

export function calcLaneMetrics(pafyll, kart, pallKvar, pallKlart, pers, sched, nowMins, bastidMins, persHistory, forecastKolli, forecastKart) {
  const w = calcWork(pafyll, kart, pallKvar, pallKlart, pers, sched, nowMins, bastidMins, persHistory, forecastKolli, forecastKart);
  const { active } = getWorkerStatus(sched, nowMins);
  return {
    sen:      w ? w.buffer / 60 : null,
    pr:       w?.efficiency != null ? w.efficiency / 100 : null,
    tk:       w ? w.remainH : null,
    jobbKvar: w ? w.remainWork / 60 : null,
    bem:      active,
  };
}
