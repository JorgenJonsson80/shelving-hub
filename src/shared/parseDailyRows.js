export function parseDailyRows(raw) {
  // A header row must contain BOTH "bana" and "kolli" cells — the v7 sheet
  // added an instructions paragraph ("...överstyra per bana.") that also
  // contains "bana" and, matched first, was misdetected as the header row.
  const hi = raw.findIndex(r => {
    const cells = r.map(c => (typeof c === "string" ? c.toLowerCase() : ""));
    return cells.some(c => c.includes("bana")) && cells.some(c => c.includes("kolli"));
  });
  if (hi === -1) return [];

  const hdr = raw[hi].map(c => String(c).toLowerCase().trim());
  const idx = needle => hdr.findIndex(h => h.includes(needle));

  const cKbana    = idx("bana");
  const cKolli    = idx("kolli");
  const cKart     = idx("kartong");
  const cHelpall  = idx("helpall");
  const cPers     = idx("pers");
  const cTimmar   = idx("timmar");
  const cPrest    = idx("prestation") >= 0 ? idx("prestation") : idx("prest");
  const cGap      = idx("gap");
  const cStatus   = idx("status");
  const cScannat  = idx("scannat") >= 0 ? idx("scannat") : idx("scan");
  const cBedoming = idx("bedöm") >= 0 ? idx("bedöm") : idx("bedom");
  const cProduk   = idx("produktivitet");

  // v7 format dropped the direct "Pers" column in favor of "Timmar" (hours),
  // convertible via the sheet's "Pass (h)" setting (e.g. 12 timmar / 8 = 1,5 pers).
  let passH = 8;
  for (const r of raw) {
    const pi = r.findIndex(c => typeof c === "string" && c.toLowerCase().trim() === "pass (h)");
    if (pi >= 0 && r[pi + 1] !== "" && !isNaN(+r[pi + 1])) { passH = +r[pi + 1]; break; }
  }

  const rows = [];
  for (let i = hi + 1; i < raw.length; i++) {
    const r = raw[i];
    const kb = String(r[cKbana] || "").trim();
    if (!kb || kb.toLowerCase() === "summa") break;
    const pers = cPers >= 0
      ? +r[cPers] || 0
      : cTimmar >= 0 ? (+r[cTimmar] || 0) / passH : 0;
    rows.push({
      kbana:         kb,
      kolli:         +r[cKolli]    || 0,
      kart:          +r[cKart]     || 0,
      helpall:       cHelpall >= 0 ? +r[cHelpall]  || 0 : 0,
      pers,
      prest:         cPrest >= 0   ? +r[cPrest]    || 0 : 0,
      gap:           cGap >= 0     ? +r[cGap]       || 0 : 0,
      status:        cStatus >= 0  ? String(r[cStatus]   || "").trim() : "",
      scannat:       cScannat >= 0 && r[cScannat] !== "" ? +r[cScannat] : null,
      bedoming:      cBedoming >= 0 ? String(r[cBedoming] || "").trim() : "",
      produktivitet: cProduk >= 0  && r[cProduk] !== "" ? +r[cProduk] : null,
    });
  }
  return rows;
}
