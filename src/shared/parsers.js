import * as XLSX from "xlsx";
import { normKbana } from "./liveUtils";

// ── etikett-baserad live-parser ───────────────────────────────────────────────

const LABEL_RE = /^K-?(\d{2})(-\d+)?$/i;

const KBANA_LINE = {
  K51: "Line 1", K52: "Line 1/2", K53: "Line 1/2", K56: "Line 2/4",
  K58: "Line 4/6", K59: "Line 6/7", K60: "Line 6/7", "K61-7": "Line 7",
  K55: "Stn 36", "K61-36": "Stn 36", K62: "Stn 50",
};

function cellStr(R, r, c) {
  return String(R[r]?.[c] ?? "").trim();
}

// "K-56" → "K56", "K-61" → "K61-7" or "K61-36" based on row position
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

function parsePallBlock(R) {
  // Find "antal pallar" header row
  let headerRow = -1;
  outer: for (let r = 0; r < R.length; r++) {
    for (let c = 0; c < (R[r]?.length || 0); c++) {
      if (cellStr(R, r, c).toLowerCase().includes("antal pallar")) { headerRow = r; break outer; }
    }
  }
  if (headerRow < 0) return {};

  const result = {};
  // Find K-label row within 6 rows of header
  for (let r = headerRow + 1; r <= headerRow + 6 && r < R.length; r++) {
    let found = false;
    for (let c = 0; c < (R[r]?.length || 0); c++) {
      if (LABEL_RE.test(cellStr(R, r, c))) {
        const kbana = normLabel(cellStr(R, r, c), 0); // pall K61 → always K61-7
        result[kbana] = {
          iko:   +R[r + 1]?.[c] || 0,
          pavag: +R[r + 2]?.[c] || 0,
          klart: +R[r + 3]?.[c] || 0,
          total: +R[r + 4]?.[c] || 0,
        };
        found = true;
      }
    }
    if (found) break;
  }
  return result;
}

function parseLiveByLabel(R) {
  // 1. Scan all cells for K-bana labels
  const labels = [];
  for (let r = 0; r < R.length; r++) {
    for (let c = 0; c < (R[r]?.length || 0); c++) {
      if (LABEL_RE.test(cellStr(R, r, c))) labels.push({ raw: cellStr(R, r, c), row: r, col: c });
    }
  }
  if (!labels.length) throw new Error("Hittade inga K-banor — fel fil eller flik?");

  const kbanor = [];
  for (const { raw, row: labelRow, col: labelCol } of labels) {
    // 2. Search downward (max 8 rows) for "Påfyllningar" header
    let pafyllCol = -1, kartCol = -1, headerRow = -1;
    outer: for (let r = labelRow + 1; r <= labelRow + 8 && r < R.length; r++) {
      for (let c = labelCol; c <= labelCol + 16; c++) {
        const v = cellStr(R, r, c).toLowerCase();
        if (v.includes("påfyllning")) { pafyllCol = c; headerRow = r; }
        if (headerRow === r && v.includes("kartong")) kartCol = c;
      }
      if (pafyllCol >= 0) break outer;
    }
    // No Påfyllningar → pall-section or unrelated label, skip
    if (pafyllCol < 0) continue;

    // If Kartonger not found on header row, widen search right
    if (kartCol < 0) {
      for (let c = pafyllCol + 1; c <= pafyllCol + 16; c++) {
        if (cellStr(R, headerRow, c).toLowerCase().includes("kartong")) { kartCol = c; break; }
      }
    }

    // 3. Find rightmost "1. I kö" in cols [0, pafyllCol) below headerRow
    //    "Rightmost" ensures we pick the row-label column for THIS K-bana's sub-block.
    let ikoRow = -1, ikoCol = -1;
    for (let r = headerRow + 1; r <= headerRow + 20 && r < R.length; r++) {
      for (let c = 0; c < pafyllCol; c++) {
        if (cellStr(R, r, c) === "1. I kö" && c > ikoCol) { ikoRow = r; ikoCol = c; }
      }
    }
    if (ikoRow < 0) { console.warn(`K-bana ${raw}: ingen "1. I kö" hittad`); continue; }

    // 4. Find "2. På väg", "3. Klart", "Total" in same column as "1. I kö"
    let pavagRow = -1, klartRow = -1, totalRow = -1;
    for (let r = ikoRow + 1; r <= ikoRow + 12 && r < R.length; r++) {
      const v = cellStr(R, r, ikoCol);
      if (v === "2. På väg")                 pavagRow = r;
      else if (/^3\./i.test(v))              klartRow = r;
      else if (v === "Total" && totalRow < 0) totalRow = r;
    }
    if (totalRow < 0) { console.warn(`K-bana ${raw}: ingen "Total"-rad hittad`); continue; }

    // 5. Read values
    const g = (r, c) => +R[r]?.[c] || 0;
    const kbana = normLabel(raw, labelRow);
    kbanor.push({
      kbana,
      line: KBANA_LINE[kbana] || "",
      isPL: false,
      pafyll: {
        iko:   g(ikoRow,   pafyllCol),
        pavag: pavagRow >= 0 ? g(pavagRow, pafyllCol) : 0,
        klart: klartRow >= 0 ? g(klartRow, pafyllCol) : 0,
        total: g(totalRow, pafyllCol),
      },
      kart: kartCol >= 0 ? {
        iko:   g(ikoRow,   kartCol),
        pavag: pavagRow >= 0 ? g(pavagRow, kartCol) : 0,
        klart: klartRow >= 0 ? g(klartRow, kartCol) : 0,
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

export { normKbana };

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
          d.rows.push({ kalla, hour, toLoc, labels });
        }

        resolve(Object.values(dayMap));
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  }))).then(results => results.flat());
}
