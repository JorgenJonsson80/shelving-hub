import { describe, it, expect } from "vitest";
import {
  KURVA, getAndelKlar, calcPrognos, calcKartongPrognos, KART_MIN_ANDEL, KALLA_MIN_ANDEL,
  blendKvar, buildEmpiriskKurva, valjKurva, calcViktadPrognos, larPrognos,
} from "./prognosCurve.js";

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

  it("blends toward a historical baseline below the confidence floor instead of returning nothing", () => {
    // Same 7:30 scenario as the regression test above (andelKlar ≈ 0.13,
    // sett 900) but now with a historical day-total (~4000, matching the
    // "actual days land 3500–4500" report) to lean on — should produce a
    // damped, plausible guess instead of null.
    const res = calcKartongPrognos(0.13, 900, 4000);
    expect(res.osäkert).toBe(false);
    expect(res.blended).toBe(true);
    expect(res.kvar).toBe(4367);
    expect(res.estTotal).toBe(5267);
    // Nowhere near the old unclamped 900/0.13 ≈ 6923 kvar this bug produced.
    expect(res.kvar).toBeLessThan(900 / 0.13 - 900);
  });
});

// ── blendKvar ─────────────────────────────────────────────────────────────

describe("blendKvar", () => {
  it("returns the pure historical-baseline guess at andelKlar 0", () => {
    expect(blendKvar(200, 0, KALLA_MIN_ANDEL, 1000)).toBe(800);
  });

  it("matches the raw sett/andelKlar guess exactly at the confidence floor (continuity with calcPrognos)", () => {
    // sett/andelKlar - sett = 300/0.3 - 300 = 700, same formula calcPrognos
    // uses once a källa is trusted on its own.
    expect(blendKvar(300, KALLA_MIN_ANDEL, KALLA_MIN_ANDEL, 1000)).toBe(700);
  });

  it("interpolates between baseline and live guess below the floor", () => {
    // Halfway to the floor (andelKlar 0.15 of a 0.30 floor) should land
    // halfway between the pure baseline guess and the pure live guess.
    const result = blendKvar(100, 0.15, 0.3, 1000);
    expect(result).toBeCloseTo(733.33, 1);
  });

  it("falls back to the old conservative 0 when there is no baseline to blend against", () => {
    expect(blendKvar(500, 0.1, 0.3, null)).toBe(0);
  });

  it("falls back to the raw live guess above the floor when there is no baseline", () => {
    expect(blendKvar(300, 0.5, 0.3, null)).toBe(300);
  });
});

// ── buildEmpiriskKurva baseline ──────────────────────────────────────────

describe("buildEmpiriskKurva baseline", () => {
  it("averages each source's daily total across the given days", () => {
    const days = [
      { total: 100, perTimme: [], perKalla: { GM: 40 }, perTimmeKalla: { GM: [] } },
      { total: 200, perTimme: [], perKalla: { GM: 80 }, perTimmeKalla: { GM: [] } },
    ];
    const kurva = buildEmpiriskKurva(days);
    expect(kurva.baseline.TOTAL).toBe(150);
    expect(kurva.baseline.GM).toBe(60);
  });

  it("returns null baseline for a source with no usable data", () => {
    const days = [{ total: 100, perTimme: [], perKalla: {}, perTimmeKalla: {} }];
    const kurva = buildEmpiriskKurva(days);
    expect(kurva.baseline.GM).toBeNull();
  });
});

// ── valjKurva / calcViktadPrognos / larPrognos ─────────────────────────────

// Synthetic complete day: `total` rows spread over hours 6–16 by `shape`
// (weights per hour), all on GM so per-källa and TOTAL agree.
function mkDay(datum, total, shape) {
  const perTimme = Array(24).fill(0);
  const sum = shape.reduce((s, v) => s + v, 0);
  let left = total;
  shape.forEach((w, i) => {
    const n = i === shape.length - 1 ? left : Math.round(total * w / sum);
    perTimme[6 + i] = n; left -= n;
  });
  const zero = () => Array(24).fill(0);
  return {
    datum, total, perTimme,
    perKalla: { GM: total, Mezz: 0, ULC: 0, PL09: 0 },
    perTimmeKalla: { GM: [...perTimme], Mezz: zero(), ULC: zero(), PL09: zero() },
    rows: [{}],
  };
}

const FLAT  = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
const EARLY = [4, 4, 3, 2, 1, 1, 1, 1, 1, 1, 1];

// 6 weeks of Mon–Fri: Mondays are big and front-loaded, other days flat.
function mkWeeks(weeks = 6) {
  const days = [];
  const start = new Date("2026-08-03T12:00:00"); // a Monday
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 5; d++) {
      const dt = new Date(start); dt.setDate(start.getDate() + w * 7 + d);
      const datum = dt.toISOString().slice(0, 10);
      days.push(d === 0 ? mkDay(datum, 2000, EARLY) : mkDay(datum, 1000, FLAT));
    }
  }
  return days;
}

describe("valjKurva", () => {
  it("falls back to KURVA with too little history", () => {
    expect(valjKurva(mkWeeks(1).slice(0, 3), 1).tier).toBe("fast");
  });

  it("blends in the weekday's own shape and level before it has 5 samples", () => {
    const hist = mkWeeks(3); // 3 Mondays
    const res = valjKurva(hist, 1);
    expect(res.tier).toBe("blandad");
    expect(res.nVeckodag).toBe(3);
    expect(res.kurva.baseline.TOTAL).toBeCloseTo(2000, 0);
    // Monday curve is ahead of the pooled one early in the day.
    const pooled = buildEmpiriskKurva(hist);
    expect(getAndelKlar(res.kurva, "TOTAL", 9)).toBeGreaterThan(getAndelKlar(pooled, "TOTAL", 9));
  });

  it("uses the weekday tier once there are enough same-weekday days", () => {
    expect(valjKurva(mkWeeks(6), 1).tier).toBe("veckodag");
  });
});

describe("calcViktadPrognos", () => {
  it("matches calcPrognos when the curve has no baseline", () => {
    expect(calcViktadPrognos(KURVA, "TOTAL", 66, 12, {})).toEqual(calcPrognos(KURVA, "TOTAL", 66, 12));
  });

  it("leans on the baseline early and on the live ratio late (default ramp)", () => {
    const kurva = { ...KURVA, baseline: { TOTAL: 1000 } };
    const early = calcViktadPrognos(kurva, "TOTAL", 10, 6.5, {});
    expect(early.wLive).toBeLessThan(0.5);
    expect(Math.abs(early.estTotal - 1000)).toBeLessThan(200);
    const late = calcViktadPrognos(kurva, "TOTAL", 660, 12, {});
    expect(late.wLive).toBe(1);
    expect(late.estTotal).toBe(1000);
  });
});

describe("larPrognos", () => {
  it("backtests walk-forward and beats the old model on the odd weekday", () => {
    const { vikter, traffsakerhet } = larPrognos(mkWeeks(8));
    expect(vikter.TOTAL[10].n).toBeGreaterThan(0);
    const mon = traffsakerhet[1][10];
    expect(mon.n).toBeGreaterThan(0);
    expect(mon.ny).toBeLessThan(mon.gammal);
  });

  it("ignores incomplete days", () => {
    const days = mkWeeks(2);
    days[0].perTimme.fill(0, 16);
    expect(() => larPrognos(days)).not.toThrow();
  });
});
