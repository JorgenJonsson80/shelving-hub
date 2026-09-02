// K-bana → line lookup, used only by defaultBastid() (liveUtils.js) to tell
// Spår ("Line ...") from Golv ("Stn ...") lanes. This used to also carry
// per-cell Excel coordinates for a coordinate-based Live parser; that parser
// was replaced by the label-based parseLiveByLabel (parsers.js), which
// never reads coordinates, so the coordinate data was removed rather than
// left to silently rot if the sheet layout ever shifts again.
export const CELL_MAP = {
  kbanor: [
    { kbana: "K51",    line: "Line 1"   },
    { kbana: "K52",    line: "Line 1/2" },
    { kbana: "K53",    line: "Line 1/2" },
    { kbana: "K56",    line: "Line 2/4" },
    { kbana: "K58",    line: "Line 4/6" },
    { kbana: "K59",    line: "Line 6/7" },
    { kbana: "K60",    line: "Line 6/7" },
    { kbana: "K61-7",  line: "Line 7"   },
    { kbana: "K55",    line: "Stn 36"   },
    { kbana: "K62",    line: "Stn 50"   },
  ],
};
