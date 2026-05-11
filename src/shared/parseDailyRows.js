export function parseDailyRows(raw) {
  let hi = raw.findIndex(r => r.some(c => typeof c === "string" && c.toLowerCase().includes("bana")));
  if (hi === -1) hi = 5;
  const rows = [];
  for (let i = hi + 1; i < raw.length; i++) {
    const r = raw[i];
    const kb = String(r[0] || "").trim();
    if (!kb || kb.toLowerCase() === "summa") break;
    rows.push({
      kbana: kb,
      kolli: +r[2] || 0,
      kart: +r[3] || 0,
      helpall: +r[4] || 0,
      pers: +r[5] || 0,
      prest: +r[8] || 0,
      gap: +r[9] || 0,
      status: String(r[10] || "").trim(),
      scannat: r[11] !== "" ? +r[11] : null,
      bedoming: String(r[14] || "").trim(),
    });
  }
  return rows;
}
