import * as XLSX from "xlsx";
import { CELL_MAP } from "./cellMap";
import { readFlow, normKbana } from "./liveUtils";

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
