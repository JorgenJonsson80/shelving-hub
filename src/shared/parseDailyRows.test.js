import { describe, it, expect } from "vitest";
import { parseDailyRows } from "./parseDailyRows";

// Modeled on the "v7 – timmar + övrigt-avdrag" Daily sheet format (Sep 2026):
// an instructions paragraph containing "...per bana." now precedes the real
// header row, and "Pers" was replaced by "Timmar" + a "Pass (h)" setting.
const V7_RAW = [
  ["NTR Daily – Shelving / K-banor (v7 – timmar + övrigt-avdrag)", "", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", ""],
  ["Date", "", "Pass (h)", 8, "Target (kolli/h/pers)", 14.3, "Pall (min/pall)", 12, "Övrigt arbete (%)"],
  ["Inmatningar i blått, formler i svart. Bemanning anges i TIMMAR (t.ex. 8 = en person hel dag, 12 = 1,5 pers).\nÖvrigt arbete (J3) dras av från tillgänglig tid för alla banor – fyll i G-kolumnen för att överstyra per bana.\nPL09 ligger fast med 8 h per dag.", "", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", "", ""],
  ["K‑bana", "Type", "Kolli", "Kartonger", "Helpall", "Timmar", "Övrigt %", "Prestation", "Gap"],
  ["K51", "Mix", 66, 147, 18, 12, "", 0.77, 2.41],
  ["K52", "RF", 37, 237, 5, 8, "", 0.64, 2.56],
  ["Summa", "", 103, 384, 23, 20, "", "", ""],
];

describe("parseDailyRows", () => {
  it("finds the real header row even when an earlier note row also contains 'bana'", () => {
    const rows = parseDailyRows(V7_RAW);
    expect(rows).toHaveLength(2);
    expect(rows[0].kbana).toBe("K51");
    expect(rows[0].kolli).toBe(66);
    expect(rows[0].kart).toBe(147);
  });

  it("derives pers from Timmar / Pass (h) when there is no direct Pers column", () => {
    const rows = parseDailyRows(V7_RAW);
    expect(rows[0].pers).toBeCloseTo(1.5); // 12 timmar / 8h pass
    expect(rows[1].pers).toBeCloseTo(1); // 8 timmar / 8h pass
  });

  it("still reads a direct Pers column when present (old format)", () => {
    const raw = [
      ["K-bana", "Type", "Kolli", "Kartonger", "Helpall", "Pers", "Prestation", "Gap"],
      ["K51", "Mix", 66, 147, 18, 1.5, 0.77, 2.41],
      ["Summa", "", 66, 147, 18, 1.5, "", ""],
    ];
    const rows = parseDailyRows(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0].pers).toBe(1.5);
  });
});
