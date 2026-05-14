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
