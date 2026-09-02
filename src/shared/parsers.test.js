import { describe, it, expect } from "vitest";
import { parseLiveByLabel, kategoriPF, creationHourPF } from "./parsers.js";

// Build a sparse 2D array from [row, col, value] tuples (mimics SheetJS sheet_to_json)
function makeSheet(cells) {
  const R = [];
  for (const [r, c, v] of cells) {
    while (R.length <= r) R.push([]);
    while (R[r].length <= c) R[r].push("");
    R[r][c] = v;
  }
  return R;
}

// ── parseLiveByLabel ──────────────────────────────────────────────────────────

describe("parseLiveByLabel", () => {
  it("reads pafyll and kart values for a single K-bana", () => {
    const sheet = makeSheet([
      [0, 5, "K51"],
      [1, 7, "Påfyllningar"], [1, 9, "Kartonger"],
      [2, 0, "1. I kö"],   [2, 7, 5],  [2, 9, 2],
      [3, 0, "2. På väg"], [3, 7, 3],  [3, 9, 1],
      [4, 0, "3. Klart"],  [4, 7, 2],  [4, 9, 1],
      [5, 0, "Total"],     [5, 7, 10], [5, 9, 4],
    ]);
    const { kbanor, total } = parseLiveByLabel(sheet);
    expect(kbanor).toHaveLength(1);
    expect(kbanor[0].kbana).toBe("K51");
    expect(kbanor[0].line).toBe("Line 1");
    expect(kbanor[0].pafyll).toEqual({ iko: 5, pavag: 3, klart: 2, total: 10 });
    expect(kbanor[0].kart).toEqual({ iko: 2, pavag: 1, klart: 1, total: 4 });
    expect(total.pafyll).toEqual({ iko: 5, pavag: 3, klart: 2, total: 10 });
  });

  it("respects territory boundary — K52 and K53 get separate values", () => {
    // K52 at col 5, K53 at col 10: revir for K52 = col 10 (K53's column)
    // K52 gets Påfyllningar at col 6 (< 10), K53 gets col 11 (> 10)
    const sheet = makeSheet([
      [0, 5, "K52"], [0, 10, "K53"],
      [1, 6, "Påfyllningar"], [1, 7, "Kartonger"],
      [1, 11, "Påfyllningar"], [1, 12, "Kartonger"],
      [2, 0, "1. I kö"],   [2, 6, 7],  [2, 7, 3],  [2, 11, 9],  [2, 12, 4],
      [3, 0, "2. På väg"], [3, 6, 5],  [3, 7, 2],  [3, 11, 6],  [3, 12, 2],
      [4, 0, "3. Klart"],  [4, 6, 3],  [4, 7, 1],  [4, 11, 4],  [4, 12, 1],
      [5, 0, "Total"],     [5, 6, 15], [5, 7, 6],  [5, 11, 19], [5, 12, 7],
    ]);
    const { kbanor } = parseLiveByLabel(sheet);
    const k52 = kbanor.find(k => k.kbana === "K52");
    const k53 = kbanor.find(k => k.kbana === "K53");
    expect(k52).toBeDefined();
    expect(k53).toBeDefined();
    expect(k52.pafyll).toEqual({ iko: 7, pavag: 5, klart: 3, total: 15 });
    expect(k52.kart).toEqual({ iko: 3, pavag: 2, klart: 1, total: 6 });
    expect(k53.pafyll).toEqual({ iko: 9, pavag: 6, klart: 4, total: 19 });
    expect(k53.kart).toEqual({ iko: 4, pavag: 2, klart: 1, total: 7 });
  });

  it("disambiguates K61 → K61-7 when label row < 45", () => {
    const sheet = makeSheet([
      [10, 5, "K-61"],
      [11, 7, "Påfyllningar"],
      [12, 0, "1. I kö"],   [12, 7, 4],
      [13, 0, "2. På väg"], [13, 7, 2],
      [14, 0, "3. Klart"],  [14, 7, 1],
      [15, 0, "Total"],     [15, 7, 7],
    ]);
    const { kbanor } = parseLiveByLabel(sheet);
    expect(kbanor[0].kbana).toBe("K61-7");
    expect(kbanor[0].line).toBe("Line 7");
  });

  it("disambiguates K61 → K55 when label row ≥ 45 (was K61-36, retired 2026-09)", () => {
    const sheet = makeSheet([
      [50, 5, "K-61"],
      [51, 7, "Påfyllningar"],
      [52, 0, "1. I kö"],   [52, 7, 4],
      [53, 0, "2. På väg"], [53, 7, 2],
      [54, 0, "3. Klart"],  [54, 7, 1],
      [55, 0, "Total"],     [55, 7, 7],
    ]);
    const { kbanor } = parseLiveByLabel(sheet);
    expect(kbanor[0].kbana).toBe("K55");
    expect(kbanor[0].line).toBe("Stn 36");
  });

  it("returns iko=0 when '1. I kö' row is absent", () => {
    // Happens when the queue is empty — row omitted in the Excel file
    const sheet = makeSheet([
      [0, 5, "K51"],
      [1, 7, "Påfyllningar"],
      [2, 0, "2. På väg"], [2, 7, 3],
      [3, 0, "3. Klart"],  [3, 7, 2],
      [4, 0, "Total"],     [4, 7, 5],
    ]);
    const { kbanor } = parseLiveByLabel(sheet);
    expect(kbanor).toHaveLength(1);
    expect(kbanor[0].pafyll.iko).toBe(0);
    expect(kbanor[0].pafyll.total).toBe(5);
  });

  it("kart is null when no Kartonger column exists", () => {
    const sheet = makeSheet([
      [0, 5, "K55"],
      [1, 7, "Påfyllningar"],
      [2, 0, "1. I kö"],   [2, 7, 2],
      [3, 0, "2. På väg"], [3, 7, 1],
      [4, 0, "3. Klart"],  [4, 7, 1],
      [5, 0, "Total"],     [5, 7, 4],
    ]);
    const { kbanor } = parseLiveByLabel(sheet);
    expect(kbanor[0].kart).toBeNull();
  });

  it("filters out banor with pafyll.total === 0", () => {
    const sheet = makeSheet([
      [0, 5, "K51"], [0, 12, "K56"],
      // K51 has values
      [1, 7, "Påfyllningar"],
      [2, 0, "1. I kö"],   [2, 7, 5],
      [3, 0, "2. På väg"], [3, 7, 3],
      [4, 0, "3. Klart"],  [4, 7, 2],
      [5, 0, "Total"],     [5, 7, 10],
      // K56 has all zeros
      [1, 14, "Påfyllningar"],
      [5, 14, 0],
    ]);
    const { kbanor } = parseLiveByLabel(sheet);
    expect(kbanor.every(k => k.pafyll.total > 0)).toBe(true);
    expect(kbanor.find(k => k.kbana === "K51")).toBeDefined();
  });

  it("reads pallarPerK from pall block", () => {
    const sheet = makeSheet([
      // Main block
      [0, 5, "K51"],
      [1, 7, "Påfyllningar"],
      [2, 0, "1. I kö"],   [2, 7, 5],
      [3, 0, "2. På väg"], [3, 7, 3],
      [4, 0, "3. Klart"],  [4, 7, 2],
      [5, 0, "Total"],     [5, 7, 10],

      // Pall block further down (row 20+)
      [20, 0, "Antal pallar"],
      [21, 1, "K51"],
      [22, 0, "1. I kö"],   [22, 1, 2],
      [23, 0, "2. På väg"], [23, 1, 1],
      [24, 0, "3. Klart"],  [24, 1, 3],
      [25, 0, "Total"],     [25, 1, 6],
    ]);
    const { pallarPerK } = parseLiveByLabel(sheet);
    expect(pallarPerK.K51).toEqual({ iko: 2, pavag: 1, klart: 3, total: 6 });
  });

  it("returns empty pallarPerK when no pall block", () => {
    const sheet = makeSheet([
      [0, 5, "K51"],
      [1, 7, "Påfyllningar"],
      [2, 0, "1. I kö"],   [2, 7, 5],
      [3, 0, "Total"],     [3, 7, 5],
    ]);
    const { pallarPerK } = parseLiveByLabel(sheet);
    expect(pallarPerK).toEqual({});
  });

  it("throws when no K-bana labels are found", () => {
    expect(() => parseLiveByLabel([["ingen bana här"]])).toThrow("Hittade inga K-banor");
  });

  it("throws when all values are zero", () => {
    const sheet = makeSheet([
      [0, 5, "K51"],
      [1, 7, "Påfyllningar"],
      [2, 0, "1. I kö"],   [2, 7, 0],
      [3, 0, "Total"],     [3, 7, 0],
    ]);
    expect(() => parseLiveByLabel(sheet)).toThrow("Alla värden är noll");
  });
});

// ── kategoriPF ────────────────────────────────────────────────────────────────

describe("kategoriPF", () => {
  it.each([
    ["",        "GM"],
    ["nan",     "GM"],
    [null,      "GM"],
    ["PBM1234", "Mezz"],
    ["PBU5678", "ULC"],
    ["PL09999", "PL09"],
    ["ANNET",   "Udda"],
    ["XYZ",     "Udda"],
  ])("kategoriPF(%s) → %s", (input, expected) => {
    expect(kategoriPF(input)).toBe(expected);
  });
});

// ── creationHourPF ────────────────────────────────────────────────────────────

describe("creationHourPF", () => {
  it.each([
    [90000,  8],   // 09:00:00 → index 8 (shifted -1 mod 24)
    [100000, 9],   // 10:00:00 → 9
    [60000,  5],   // 06:00:00 → 5
    [70000,  6],   // 07:00:00 → 6
    [10000,  0],   // 01:00:00 → 0
    [240000, 23],  // 24:00:00 → wraps to 23
  ])("creationHourPF(%i) → %i", (input, expected) => {
    expect(creationHourPF(input)).toBe(expected);
  });

  it.each([
    [null],
    ["abc"],
    [-1],
  ])("creationHourPF(%s) → null for invalid input", (input) => {
    expect(creationHourPF(input)).toBeNull();
  });
});
