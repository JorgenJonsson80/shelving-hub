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
    expect(classifyLocation("K61-36-B")).toBe("K61-36");
    expect(classifyLocation("K61-7-B")).toBe("K61-7");
  });

  it("resolves PD-prefix → K62", () => {
    expect(classifyLocation("PD-123")).toBe("K62");
  });

  it("resolves PH-prefix → K63", () => {
    expect(classifyLocation("PH-123")).toBe("K63");
  });

  it("resolves P3-prefix → K55", () => {
    // P3xx-yy format: substring(3,5) must be numeric for the function to proceed
    expect(classifyLocation("P3-60-A-12")).toBe("K55");
  });

  it("resolves P4 even lpl → K58, odd lpl → K56", () => {
    // lpl = first number after dash; even → K58, odd → K56
    expect(classifyLocation("P4-10-A-12")).toBe("K58");
    expect(classifyLocation("P4-11-A-12")).toBe("K56");
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
