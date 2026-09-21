import { describe, it, expect } from "vitest";
import { normKbana, classifyLocation, spentPersonMins, calcWork, pctDelta, rekommenderadBemanning, rekommenderadBemanningBreakdown } from "./liveUtils.js";

// ── normKbana ─────────────────────────────────────────────────────────────────

describe("normKbana", () => {
  it.each([
    ["K-51",  "K51"],
    ["K 52",  "K52"],
    ["K61-7", "K617"],
    ["K61-36","K6136"],
    ["k53",   "K53"],
    ["K55",   "K55"],
  ])("normKbana(%s) → %s", (input, expected) => {
    expect(normKbana(input)).toBe(expected);
  });
});

// ── classifyLocation ──────────────────────────────────────────────────────────

describe("classifyLocation", () => {
  it("returns null for falsy input", () => {
    expect(classifyLocation(null)).toBeNull();
    expect(classifyLocation("")).toBeNull();
    expect(classifyLocation(undefined)).toBeNull();
  });

  it("returns null for unrecognised location", () => {
    expect(classifyLocation("RANDOM")).toBeNull();
    expect(classifyLocation("ABC-123")).toBeNull();
  });

  it("resolves K-prefix locations directly (legacy format)", () => {
    expect(classifyLocation("K51-A-01")).toBe("K51");
    expect(classifyLocation("K52-X")).toBe("K52");
    expect(classifyLocation("K62-ZZZ")).toBe("K62");
    expect(classifyLocation("K61-36-B")).toBe("K61-36"); // reinstated 2026-09 alongside the P3 split
    expect(classifyLocation("K61-7-B")).toBe("K61-7");
  });

  it("resolves PD-prefix → K62", () => {
    expect(classifyLocation("PD-123")).toBe("K62");
  });

  it("resolves PH-prefix → K63", () => {
    expect(classifyLocation("PH-123")).toBe("K63");
  });

  // P3 (Stn 36) → K55 eller K61-36. Riktiga koder har dubbelt bindestreck
  // ("P3036--B-06-1BB"), så raden/platsen ligger på fasta teckenpositioner
  // (T7/T8/T10–11) — inte i numret efter första bindestrecket, som är tomt.
  it("splits P3036 K55 vs K61-36 by character position (real code format)", () => {
    // K55: T7 = siffra, T8 = "A", eller T8 = "B" med plats 01–13
    expect(classifyLocation("P3036--B-06-1BB")).toBe("K55");
    expect(classifyLocation("P3036--B-01-1BB")).toBe("K55");
    expect(classifyLocation("P3036--B-13-1BB")).toBe("K55");
    expect(classifyLocation("P3036--A-13-2CA")).toBe("K55");
    expect(classifyLocation("P3036--A-89-2CA")).toBe("K55"); // A-raden: alla platser
    expect(classifyLocation("P3036-8-830-5BC")).toBe("K55");
    expect(classifyLocation("P3036-4-427-5C")).toBe("K55");
    // Allt annat i P3 som inte är K55 → K61-36
    expect(classifyLocation("P3036--B-14-1BB")).toBe("K61-36"); // B-raden, plats ≥14
    expect(classifyLocation("P3036--B-89-1BB")).toBe("K61-36");
    expect(classifyLocation("P3036--R-08-3BA")).toBe("K61-36");
    expect(classifyLocation("P3036--Q-89-5A")).toBe("K61-36");
    expect(classifyLocation("P3036--V-17-1AA")).toBe("K61-36");
    expect(classifyLocation("P3036--W-02-5BA")).toBe("K61-36");
  });

  it("is case-insensitive and tolerates surrounding whitespace for P3036", () => {
    expect(classifyLocation("  p3036--b-06-1bb ")).toBe("K55");
    expect(classifyLocation("  p3036--r-08-3ba ")).toBe("K61-36");
  });

  it("never lets a non-K55 P3 code fall back to K55", () => {
    // Regression: the number after the first dash is empty in real codes
    // ("P3036--…"), so a rule keyed on it silently returned K55 for everything.
    for (const loc of ["P3036--R-08-3BA", "P3036--B-14-1BB", "P3036--Z-99-9ZZ", "P3036-"]) {
      expect(classifyLocation(loc)).toBe("K61-36");
    }
  });

  it("resolves P4 even lpl → K58, odd lpl → K56", () => {
    // lpl = first number after dash; even → K58, odd → K56
    expect(classifyLocation("P4-10-A-12")).toBe("K58");
    expect(classifyLocation("P4-11-A-12")).toBe("K56");
  });
});

// Facit: de 24 validerade testfallen från regelmotorn (Shelving Hub-skillen,
// references/regelmotor.md). Riktiga platskoder från Butema.
describe("classifyLocation — validated regelmotor cases", () => {
  it.each([
    ["P1010-04--B-3-E",   "K51"],
    ["P1011-15--D-3-A",   "K52"],
    ["P1011-16--B-3-B",   "K51"],
    ["P1024-60--C-3B",    "K56"],
    ["P6060-02--D---",    "K58"],
    ["P6063-32--B-7AB",   "K58"],
    ["P6064-43--E-3-",    "K60"],
    ["P6064-45--A-3-",    "K59"],
    ["P7075-106-E-3AA",   "K61-7"],
    ["P7074-94--C-3AB",   "K61-7"],
    ["P7076-125-D-2-A",   "K60"],
    ["P7071-15--D-3-A",   "K59"],
    ["P7074-81--A-1-",    "K59"],
    ["P7074-83--A-1-",    "K60"],
    ["P7077-145-C-3-A",   "K60"],
    ["P3036--R-08-3BA",   "K61-36"],
    ["P3036--Q-89-5A",    "K61-36"],
    ["P3036--V-17-1AA",   "K61-36"],
    ["P3036--W-02-5BA",   "K61-36"],
    ["P3036--B-06-1BB",   "K55"],
    ["P3036--A-13-2CA",   "K55"],
    ["P3036-8-830-5BC",   "K55"],
    ["P3036-4-427-5C",    "K55"],
    ["PD0001-XX",         "K62"],
    ["PH126--C030-7A",    "K63"],
  ])("classifyLocation(%s) → %s", (loc, expected) => {
    expect(classifyLocation(loc)).toBe(expected);
  });
});

// ── spentPersonMins ───────────────────────────────────────────────────────────

describe("spentPersonMins", () => {
  const H = (h, m = 0) => h * 60 + m;

  it("matches flat pers × elapsed time when there's no history", () => {
    expect(spentPersonMins([], H(6), H(12), 3)).toBe(6 * 60 * 3);
  });

  it("ignores a headcount bumped mid-shift for the time before the change", () => {
    // 2 pers 06–10, bumped to 3 at 10:00, now 12:00 — must not treat the
    // whole 6h as if 3 people worked it (that's the bug this replaces).
    const hist = [{ mins: 0, pers: 2 }, { mins: H(10), pers: 3 }];
    expect(spentPersonMins(hist, H(6), H(12), 3)).toBe(4 * 60 * 2 + 2 * 60 * 3);
  });

  it("falls back to the first recorded value when nothing covers shift start", () => {
    // No baseline entry at all before the first logged change — the function
    // can't know what applied earlier, so it assumes the first known value
    // held since shift start (same simplification as the no-history case).
    const hist = [{ mins: H(10), pers: 3 }];
    expect(spentPersonMins(hist, H(6), H(12), 3)).toBe(6 * 60 * 3);
  });

  it("handles multiple changes within the same shift", () => {
    const hist = [{ mins: 0, pers: 2 }, { mins: H(10), pers: 3 }, { mins: H(11), pers: 4 }];
    expect(spentPersonMins(hist, H(6), H(12), 4)).toBe(4 * 60 * 2 + 1 * 60 * 3 + 1 * 60 * 4);
  });

  it("uses a change recorded before shift start as the starting value", () => {
    const hist = [{ mins: H(5), pers: 2 }, { mins: H(10), pers: 3 }];
    expect(spentPersonMins(hist, H(6), H(12), 3)).toBe(4 * 60 * 2 + 2 * 60 * 3);
  });

  it("never returns a negative total", () => {
    expect(spentPersonMins([], H(12), H(6), 3)).toBe(0);
  });
});

// ── calcWork forecastKolli ────────────────────────────────────────────────────

describe("calcWork forecastKolli", () => {
  const H = (h, m = 0) => h * 60 + m;
  const pafyll = { iko: 10, pavag: 0, klart: 0 };
  const sched = [{ start: "06:00", end: "14:00" }];

  it("adds expected-remaining PF (converted via bastid) on top of the current queue", () => {
    const withoutForecast = calcWork(pafyll, null, 0, 0, 2, sched, H(10), 1.8);
    const withForecast    = calcWork(pafyll, null, 0, 0, 2, sched, H(10), 1.8, [], 20);
    expect(withForecast.remainWork).toBeCloseTo(withoutForecast.remainWork + 20 * 1.8);
    expect(withForecast.forecastKvar).toBe(20);
  });

  it("defaults to 0 (no behavior change) when forecastKolli is omitted", () => {
    const a = calcWork(pafyll, null, 0, 0, 2, sched, H(10), 1.8);
    const b = calcWork(pafyll, null, 0, 0, 2, sched, H(10), 1.8, []);
    expect(a.remainWork).toBe(b.remainWork);
    expect(a.forecastKvar).toBe(0);
  });

  it("never lets a negative forecast reduce remainWork", () => {
    const withNegative = calcWork(pafyll, null, 0, 0, 2, sched, H(10), 1.8, [], -50);
    const plain = calcWork(pafyll, null, 0, 0, 2, sched, H(10), 1.8);
    expect(withNegative.remainWork).toBe(plain.remainWork);
  });

  it("keeps queueWork forecast-free even when remainWork carries a forecast", () => {
    const withForecast = calcWork(pafyll, null, 0, 0, 2, sched, H(10), 1.8, [], 20);
    expect(withForecast.queueWork).toBeCloseTo(10 * 1.8);
    expect(withForecast.queueWork).toBeLessThan(withForecast.remainWork);
  });
});

// ── pctDelta ──────────────────────────────────────────────────────────────────

describe("pctDelta", () => {
  it("returns a signed percent above/below the baseline", () => {
    expect(pctDelta(120, 100)).toBeCloseTo(20);
    expect(pctDelta(80, 100)).toBeCloseTo(-20);
  });

  it("returns null for a missing or non-positive baseline", () => {
    expect(pctDelta(100, null)).toBeNull();
    expect(pctDelta(100, undefined)).toBeNull();
    expect(pctDelta(100, 0)).toBeNull();
    expect(pctDelta(100, -5)).toBeNull();
  });
});

// ── rekommenderadBemanningBreakdown ─────────────────────────────────────────────

describe("rekommenderadBemanningBreakdown", () => {
  it("splits the total into kolli/kart/pall components that sum to the total", () => {
    const b = rekommenderadBemanningBreakdown("K51", 200, 100, 5);
    expect(b.kolliPers).toBeCloseTo((200 * 1.8) / 480);
    expect(b.kartPers).toBeCloseTo((100 * 1.0) / 480);
    expect(b.pallPers).toBeCloseTo((5 * 12) / 480);
    expect(b.total).toBeCloseTo(b.kolliPers + b.kartPers + b.pallPers);
  });

  it("agrees with rekommenderadBemanning's total for the same inputs", () => {
    const b = rekommenderadBemanningBreakdown("K63", 150, 80, 3);
    expect(b.total).toBeCloseTo(rekommenderadBemanning("K63", 150, 80, 3));
  });
});

// ── kringuppgifterPct ─────────────────────────────────────────────────────────

describe("rekommenderadBemanning kringuppgifterPct", () => {
  it("defaults to 0 (no behavior change) when omitted", () => {
    const withPct = rekommenderadBemanning("K51", 200, 100, 5, 480, 0);
    const omitted = rekommenderadBemanning("K51", 200, 100, 5);
    expect(omitted).toBeCloseTo(withPct);
  });

  it("scales the recommended total up by 1/(1-pct/100)", () => {
    const base = rekommenderadBemanning("K51", 200, 100, 5);
    const with10pct = rekommenderadBemanning("K51", 200, 100, 5, 480, 10);
    expect(with10pct).toBeCloseTo(base / 0.9);
  });

  it("keeps kolliPers+kartPers+pallPers === total after scaling", () => {
    const b = rekommenderadBemanningBreakdown("K51", 200, 100, 5, 480, 15);
    expect(b.total).toBeCloseTo(b.kolliPers + b.kartPers + b.pallPers);
  });

  it("never divides by zero/negative for pct >= 100", () => {
    const b = rekommenderadBemanningBreakdown("K51", 200, 100, 5, 480, 150);
    expect(Number.isFinite(b.total)).toBe(true);
    expect(b.total).toBeGreaterThan(0);
  });
});

describe("calcWork kringuppgifterPct", () => {
  const H = (h, m = 0) => h * 60 + m;
  const pafyll = { iko: 10, pavag: 0, klart: 0 };
  const sched = [{ start: "06:00", end: "14:00" }];

  it("defaults to 0 (no behavior change) when omitted", () => {
    const withPct = calcWork(pafyll, null, 0, 0, 2, sched, H(10), 1.8, [], 0, 0, 0);
    const omitted = calcWork(pafyll, null, 0, 0, 2, sched, H(10), 1.8);
    expect(omitted.buffer).toBeCloseTo(withPct.buffer);
  });

  it("reduces availMins/buffer by the given percentage, leaving remainWork untouched", () => {
    const plain  = calcWork(pafyll, null, 0, 0, 2, sched, H(10), 1.8);
    const withPct = calcWork(pafyll, null, 0, 0, 2, sched, H(10), 1.8, [], 0, 0, 20);
    expect(withPct.availMins).toBeCloseTo(plain.availMins * 0.8);
    expect(withPct.remainWork).toBeCloseTo(plain.remainWork);
    expect(withPct.buffer).toBeCloseTo(withPct.availMins - withPct.remainWork);
  });

  it("never lets pct >= 100 produce negative availMins", () => {
    const w = calcWork(pafyll, null, 0, 0, 2, sched, H(10), 1.8, [], 0, 0, 150);
    expect(w.availMins).toBe(0);
  });
});
