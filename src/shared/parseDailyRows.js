export function parseDailyRows(raw) {
  const hi = raw.findIndex(r => r.some(c => typeof c === "string" && c.toLowerCase().includes("bana")));
  if (hi === -1) return [];

  const hdr = raw[hi].map(c => String(c).toLowerCase().trim());
  const idx = needle => hdr.findIndex(h => h.includes(needle));

  const cKbana    = idx("bana");
  const cKolli    = idx("kolli");
  const cKart     = idx("kartong");
  const cHelpall  = idx("helpall");
  const cPers     = idx("pers");
  const cPrest    = idx("prestation") >= 0 ? idx("prestation") : idx("prest");
  const cGap      = idx("gap");
  const cStatus   = idx("status");
  const cScannat  = idx("scannat") >= 0 ? idx("scannat") : idx("scan");
  const cBedoming = idx("bedöm") >= 0 ? idx("bedöm") : idx("bedom");
  const cProduk   = idx("produktivitet");

  const rows = [];
  for (let i = hi + 1; i < raw.length; i++) {
    const r = raw[i];
    const kb = String(r[cKbana] || "").trim();
    if (!kb || kb.toLowerCase() === "summa") break;
    rows.push({
      kbana:         kb,
      kolli:         +r[cKolli]    || 0,
      kart:          +r[cKart]     || 0,
      helpall:       cHelpall >= 0 ? +r[cHelpall]  || 0 : 0,
      pers:          +r[cPers]     || 0,
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
