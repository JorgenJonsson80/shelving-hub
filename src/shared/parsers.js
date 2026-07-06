// parsers.js — komplett, robust etikett-baserad live-parser (SLUTVERSION)
// Ersätter allt från importerna högst upp t.o.m. parseLiveByLabel i parsers.js.
// Verifierad mot fyra olika dagars exportfiler med olika layouter.
//
// Principer (gäller BÅDE huvudblock och pall-block):
//  • Hitta varje bana via dess etikett ("K-59") — aldrig fasta koordinater.
//  • Horisontell revir-gräns: sök aldrig förbi nästa banas kolumn.
//  • Vertikal blockgräns: sök aldrig förbi nästa blocks rad.
//  • Ankra raderna på "Total" (finns alltid) — I kö/På väg/Klart kan saknas
//    när de är tomma och läses då som 0 istället för att banan försvinner.

import * as XLSX from "xlsx";
import { normKbana } from "./liveUtils";

const LABEL_RE = /^K-?(\d{2})(-\d+)?$/i;

const KBANA_LINE = {
  K51: "Line 1", K52: "Line 1/2", K53: "Line 1/2", K56: "Line 2/4",
  K58: "Line 4/6", K59: "Line 6/7", K60: "Line 6/7", "K61-7": "Line 7",
  K55: "Stn 36", "K61-36": "Stn 36", K62: "Stn 50",
};

function cellStr(R, r, c) {
  return String(R[r]?.[c] ?? "").trim();
}

// "K-56" → "K56"; "K-61" → K61-7 (övre block) eller K61-36 (Stn-block, rad ≥ 45)
function normLabel(raw, row) {
  const s = raw.replace(/-/g, "").toUpperCase();
  if (s === "K61") return row < 45 ? "K61-7" : "K61-36";
  return s;
}

function sumFlow(flows) {
  return flows.reduce(
    (a, f) => ({ iko: a.iko + f.iko, pavag: a.pavag + f.pavag, klart: a.klart + f.klart, total: a.total + f.total }),
    { iko: 0, pavag: 0, klart: 0, total: 0 }
  );
}

// ── Pall-block: radetikett-ankrad (raderna kan saknas & banorna byter kolumn) ──
function parsePallBlock(R) {
  // 1. Hitta "Antal pallar"-rubriken
  let headerRow = -1;
  outer: for (let r = 0; r < R.length; r++) {
    for (let c = 0; c < (R[r]?.length || 0); c++) {
      if (cellStr(R, r, c).toLowerCase().includes("antal pallar")) { headerRow = r; break outer; }
    }
  }
  if (headerRow < 0) return {};

  // 2. Hitta K-etikettraden inom 6 rader under rubriken
  let lblRow = -1;
  const cols = {}; // kol → rå etikett
  for (let r = headerRow + 1; r <= headerRow + 6 && r < R.length; r++) {
    let found = false;
    for (let c = 0; c < (R[r]?.length || 0); c++) {
      if (LABEL_RE.test(cellStr(R, r, c))) { cols[c] = cellStr(R, r, c); found = true; }
    }
    if (found) { lblRow = r; break; }
  }
  if (lblRow < 0) return {};

  // 3. Hitta radetikett-kolumnen: första kolumn med "Total" inom 8 rader under etikettraden
  let rlCol = -1;
  for (let c = 0; c < (R[lblRow]?.length || 0); c++) {
    for (let r = lblRow + 1; r <= lblRow + 8 && r < R.length; r++) {
      if (cellStr(R, r, c) === "Total") { rlCol = c; break; }
    }
    if (rlCol >= 0) break;
  }
  if (rlCol < 0) return {};

  // 4. Mappa radetiketter → radnummer (saknad rad förblir -1 → läses som 0)
  let ikoRow = -1, pavagRow = -1, klartRow = -1, totalRow = -1;
  for (let r = lblRow + 1; r <= lblRow + 8 && r < R.length; r++) {
    const v = cellStr(R, r, rlCol);
    if (v === "1. I kö")                    ikoRow = r;
    else if (v === "2. På väg")             pavagRow = r;
    else if (/^3\./i.test(v))               klartRow = r;
    else if (v === "Total" && totalRow < 0) totalRow = r;
  }

  // 5. Läs värden per bana-kolumn
  const g = (r, c) => (r >= 0 ? +R[r]?.[c] || 0 : 0);
  const result = {};
  for (const [cStr, raw] of Object.entries(cols)) {
    const c = +cStr;
    const kbana = normLabel(raw, 0); // pall-K61 → alltid K61-7
    result[kbana] = {
      iko:   g(ikoRow,   c),
      pavag: g(pavagRow, c),
      klart: g(klartRow, c),
      total: g(totalRow, c),
    };
  }
  return result;
}

// ── Huvudblock: etikett + revir + Total-ankare ────────────────────────────────
function parseLiveByLabel(R) {
  // 1. Skanna alla celler efter K-bana-etiketter
  const labels = [];
  for (let r = 0; r < R.length; r++) {
    for (let c = 0; c < (R[r]?.length || 0); c++) {
      if (LABEL_RE.test(cellStr(R, r, c))) labels.push({ raw: cellStr(R, r, c), row: r, col: c });
    }
  }
  if (!labels.length) throw new Error("Hittade inga K-banor — fel fil eller flik?");
  labels.sort((a, b) => a.row - b.row || a.col - b.col);

  // Revir-gränser
  const nextLabelCol = (labelRow, labelCol) => {
    let bound = Infinity;
    for (const l of labels) {
      if (Math.abs(l.row - labelRow) <= 3 && l.col > labelCol && l.col < bound) bound = l.col;
    }
    return bound;
  };
  const nextBlockRow = (labelRow) => {
    let bound = Infinity;
    for (const l of labels) {
      if (l.row > labelRow + 2 && l.row < bound) bound = l.row;
    }
    return bound;
  };

  const kbanor = [];
  for (const { raw, row: labelRow, col: labelCol } of labels) {
    const colLimRaw = nextLabelCol(labelRow, labelCol);
    const colLim = colLimRaw === Infinity ? Number.MAX_SAFE_INTEGER : colLimRaw;
    const rowEndRaw = nextBlockRow(labelRow);
    const rowEnd = Math.min(rowEndRaw === Infinity ? R.length : rowEndRaw, R.length);

    // 2. "Påfyllningar"-header: första träffen, inom revir
    let pafyllCol = -1, kartCol = -1, headerRow = -1;
    outer: for (let r = labelRow + 1; r <= labelRow + 8 && r < rowEnd; r++) {
      for (let c = labelCol; c < Math.min(labelCol + 16, colLim); c++) {
        if (cellStr(R, r, c).toLowerCase().includes("påfyllning")) {
          pafyllCol = c; headerRow = r; break outer;
        }
      }
    }
    if (pafyllCol < 0) continue; // pall-block eller orelaterad etikett

    for (let c = pafyllCol + 1; c < Math.min(pafyllCol + 16, colLim); c++) {
      if (cellStr(R, headerRow, c).toLowerCase().includes("kartong")) { kartCol = c; break; }
    }

    // 3. Radetikett-kolumn: närmaste kolumn till vänster om pafyllCol med "Total",
    //    sökning begränsad till blockets rader
    let lblCol = -1, totalRow = -1;
    for (let c = pafyllCol - 1; c >= 0; c--) {
      for (let r = headerRow + 1; r < rowEnd; r++) {
        if (cellStr(R, r, c) === "Total") { lblCol = c; totalRow = r; break; }
      }
      if (lblCol >= 0) break;
    }
    if (lblCol < 0) { console.warn(`K-bana ${raw}: ingen radetikett-kolumn med Total`); continue; }

    // 4. Läs övriga rader i samma kolumn (saknad rad → -1 → läses som 0)
    let ikoRow = -1, pavagRow = -1, klartRow = -1;
    for (let r = headerRow + 1; r < rowEnd; r++) {
      const v = cellStr(R, r, lblCol);
      if (v === "1. I kö")        ikoRow = r;
      else if (v === "2. På väg") pavagRow = r;
      else if (/^3\./i.test(v))   klartRow = r;
    }

    // 5. Läs värden — saknad rad = 0
    const g = (r, c) => (r >= 0 ? +R[r]?.[c] || 0 : 0);
    const kbana = normLabel(raw, labelRow);
    kbanor.push({
      kbana,
      line: KBANA_LINE[kbana] || "",
      isPL: false,
      pafyll: {
        iko:   g(ikoRow,   pafyllCol),
        pavag: g(pavagRow, pafyllCol),
        klart: g(klartRow, pafyllCol),
        total: g(totalRow, pafyllCol),
      },
      kart: kartCol >= 0 ? {
        iko:   g(ikoRow,   kartCol),
        pavag: g(pavagRow, kartCol),
        klart: g(klartRow, kartCol),
        total: g(totalRow, kartCol),
      } : null,
    });
  }

  const pallarPerK = parsePallBlock(R);
  const total = {
    pafyll: sumFlow(kbanor.map(k => k.pafyll)),
    kart:   sumFlow(kbanor.filter(k => k.kart).map(k => k.kart)),
  };

  const allZero = kbanor.every(k => k.pafyll.total === 0);
  if (allZero) throw new Error("Alla värden är noll — fel fil eller flik? Kontrollera att det är Visualisering-filen (Infattning SDS).");

  return { kbanor: kbanor.filter(k => k.pafyll.total > 0 || k.isPL), pallarPerK, total };
}

export { parseLiveByLabel, normKbana };

export function parseStaffingFile(file) {
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

export function parseLive(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const R = XLSX.utils.sheet_to_json(sheet, { defval: "", header: 1 });
        const result = parseLiveByLabel(R);
        resolve({ ...result, fileName: file.name, loaded: new Date().toLocaleTimeString("sv-SE") });
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ── PF-export parser ──────────────────────────────────────────────────────────

export function kategoriPF(ref) {
  const s = String(ref ?? "").trim();
  if (s === "" || s === "nan") return "GM";
  if (s.startsWith("PBM")) return "Mezz";
  if (s.startsWith("PBU")) return "ULC";
  if (s.startsWith("PL0")) return "PL09";
  return "Udda";
}

export function creationHourPF(t) {
  const n = parseInt(String(t ?? ""), 10);
  if (isNaN(n) || n < 0) return null;
  const hh = Math.floor(n / 10000);
  return (hh - 1 + 24) % 24;
}

function normDatePF(d) {
  if (d === null || d === undefined || d === "") return null;
  if (typeof d === "number" && d > 40000) {
    // Excel serial date (epoch = 1899-12-30)
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(epoch.getTime() + d * 86400000);
    return dt.toISOString().substring(0, 10);
  }
  const s = String(d).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
    const [day, month, year] = s.split("/");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  if (/^\d{2}\.\d{2}\.\d{4}/.test(s)) {
    const [day, month, year] = s.split(".");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return s.substring(0, 10) || null;
}

function findColPF(headers, ...needles) {
  const h = headers.map(c => String(c).toLowerCase().replace(/[^a-z0-9]/g, ""));
  for (const n of needles) {
    const norm = n.toLowerCase().replace(/[^a-z0-9]/g, "");
    const idx = h.findIndex(c => c === norm || c.includes(norm));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parsePFExport(files) {
  const fileArr = Array.isArray(files) ? files : [files];
  return Promise.all(fileArr.map(file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

        // Find header row: look for "creation" or "user ref"
        const hi = raw.findIndex(r => r.some(c => {
          const s = String(c).toLowerCase();
          return s.includes("creation") || s.includes("user ref") || s.includes("userref");
        }));
        if (hi === -1) throw new Error("Hittade inte kolumnrubriker — är det rätt PF-exportfil?");

        const headers = raw[hi];
        const cRef  = findColPF(headers, "userreference", "user reference");
        const cDate = findColPF(headers, "creationdate",  "creation date");
        const cTime = findColPF(headers, "creationtime",  "creation time");
        const cLoc  = findColPF(headers, "tolocation",    "to location");
        const cLbl  = findColPF(headers, "numberoflabels", "number of labels");
        const cVnr  = findColPF(headers, "2nditemnumber", "2nd item number");

        if (cDate === -1 || cTime === -1) {
          throw new Error("Saknar kolumner Creation Date eller Creation Time i filen.");
        }

        const dayMap = {};
        for (let i = hi + 1; i < raw.length; i++) {
          const r = raw[i];
          const ref    = cRef  >= 0 ? r[cRef]  : "";
          const kalla  = kategoriPF(ref);
          const hour   = creationHourPF(r[cTime]);
          const datum  = normDatePF(r[cDate]);
          const toLoc  = cLoc  >= 0 ? String(r[cLoc] ?? "")  : "";
          const labels = cLbl  >= 0 ? Number(r[cLbl]) || 0   : 0;
          const vnr    = cVnr  >= 0 ? String(r[cVnr] ?? "").trim() : "";

          if (!datum || hour === null) continue;

          if (!dayMap[datum]) {
            dayMap[datum] = {
              datum,
              total: 0,
              perKalla: { GM: 0, Mezz: 0, ULC: 0, PL09: 0, Udda: 0 },
              perTimme: Array(24).fill(0),
              perTimmeKalla: {
                GM:   Array(24).fill(0),
                Mezz: Array(24).fill(0),
                ULC:  Array(24).fill(0),
                PL09: Array(24).fill(0),
              },
              rows: [],
            };
          }

          const d = dayMap[datum];
          d.total++;
          d.perKalla[kalla]++;
          d.perTimme[hour]++;
          if (d.perTimmeKalla[kalla]) d.perTimmeKalla[kalla][hour]++;
          d.rows.push({ kalla, hour, toLoc, labels, vnr });
        }

        resolve(Object.values(dayMap));
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  }))).then(results => results.flat());
}
