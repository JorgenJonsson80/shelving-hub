import { describe, it, expect } from "vitest";
import { KURVA, getAndelKlar, calcPrognos, calcKartongPrognos, KART_MIN_ANDEL } from "./prognosCurve.js";

// ── getAndelKlar ──────────────────────────────────────────────────────────

describe("getAndelKlar", () => {
  it("returns 0 before the curve starts", () => {
    expect(getAndelKlar(KURVA, "TOTAL", 0)).toBe(0);
    expect(getAndelKlar(KURVA, "TOTAL", KURVA.timmar[0])).toBe(0);
  });

  it("matches the bucket value exactly at its anchor time (end of hour H = H+1:00)", () => {
    // TOTAL[6] = 66 is "done by end of hour 11" → anchored at 12:00
    expect(getAndelKlar(KURVA, "TOTAL", 12)).toBeCloseTo(0.66, 5);
    // TOTAL[7] = 77 is "done by end of hour 12" → anchored at 13:00
    expect(getAndelKlar(KURVA, "TOTAL", 13)).toBeCloseTo(0.77, 5);
  });

  it("interpolates smoothly within an hour instead of jumping at the boundary", () => {
    const at1200 = getAndelKlar(KURVA, "TOTAL", 12);
    const at1230 = getAndelKlar(KURVA, "TOTAL", 12.5);
    const at1259 = getAndelKlar(KURVA, "TOTAL", 12 + 59 / 60);
    const at1300 = getAndelKlar(KURVA, "TOTAL", 13);
    // Strictly increasing across the hour — no flat jump straight to the
    // next bucket's value right at 12:00 like the old step function did.
    expect(at1200).toBeLessThan(at1230);
    expect(at1230).toBeLessThan(at1259);
    expect(at1259).toBeLessThan(at1300);
    // And 12:59 should be very close to (but still less than) the 13:00 anchor.
    expect(at1300 - at1259).toBeLessThan(0.02);
  });

  it("does not hard-snap to 100% after the last bucket", () => {
    const lastVal = KURVA.TOTAL[KURVA.TOTAL.length - 1]; // 99
    expect(getAndelKlar(KURVA, "TOTAL", 18)).toBeCloseTo(lastVal / 100, 5);
    expect(getAndelKlar(KURVA, "TOTAL", 23)).toBeCloseTo(lastVal / 100, 5);
  });

  it("falls back to 1.0 for an unknown källa", () => {
    expect(getAndelKlar(KURVA, "NOPE", 12)).toBe(1.0);
  });
});

// ── calcPrognos ───────────────────────────────────────────────────────────

describe("calcPrognos", () => {
  it("estimates a total and kvar proportional to andelKlar", () => {
    // At 12:00, TOTAL andelKlar = 0.66
    const { estTotal, kvar, osäkert } = calcPrognos(KURVA, "TOTAL", 66, 12);
    expect(osäkert).toBeUndefined();
    expect(estTotal).toBe(100);
    expect(kvar).toBe(34);
  });

  it("marks the result uncertain when andelKlar is 0", () => {
    const res = calcPrognos(KURVA, "TOTAL", 10, KURVA.timmar[0]);
    expect(res.osäkert).toBe(true);
    expect(res.estTotal).toBeNull();
    expect(res.kvar).toBeNull();
  });

  it("never returns a negative kvar, even when andelKlar reaches 100%", () => {
    // ULC's curve reaches exactly 100 in its last bucket, so andelKlar = 1.0
    // and estTotal === sett — kvar should land on 0, not dip negative.
    const { kvar } = calcPrognos(KURVA, "ULC", 500, 18);
    expect(kvar).toBe(0);
  });
});

// ── calcKartongPrognos ────────────────────────────────────────────────────

describe("calcKartongPrognos", () => {
  it("marks the result uncertain below the confidence floor, even with a real sett value", () => {
    // Regression test for the 2026-08-19 bug report: guessed 7000 kartonger
    // around 7:30 (andelKlar ≈ 0.13) when the day landed at 3500–4500.
    const res = calcKartongPrognos(0.13, 900);
    expect(res.osäkert).toBe(true);
    expect(res.estTotal).toBeNull();
    expect(res.kvar).toBeNull();
  });

  it("estimates a total once andelKlar reaches the confidence floor", () => {
    const res = calcKartongPrognos(KART_MIN_ANDEL, 1200);
    expect(res.osäkert).toBeUndefined();
    expect(res.estTotal).toBe(4000);
    expect(res.kvar).toBe(2800);
  });

  it("never returns a negative kvar", () => {
    const { kvar } = calcKartongPrognos(1.0, 4000);
    expect(kvar).toBe(0);
  });
});
