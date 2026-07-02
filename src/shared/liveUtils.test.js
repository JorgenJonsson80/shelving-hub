import { describe, it, expect } from "vitest";
import { normKbana, classifyLocation } from "./liveUtils.js";

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
