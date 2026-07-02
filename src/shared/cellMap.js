// cellMap.js — verifierad mot Visualisering_infattning_SDS (18).xlsx
// Koordinater är [rad, kol] 0-indexerade (SheetJS sheet_to_json header:1).
//
// FIXAR i denna version (mot tidigare mapp):
//  • K56     pafyll 76→77, kart 79→80  (hade glidit en kolumn, föll bort som tom)
//  • K61-7   pafyll 78→79, kart 81→82  (samma kolumn-glid)
//  • total   pafyll 77→78, kart 80→81  (samma glid)
//  • pallarPerK  helt ommappad — etiketterna satt på fel kolumner, läste fel banas pallar.
//                Rader rättade: 67=iko, 68=pavag, 69=klart, 70=total (lästes fel förut).
//  • PL09    borttagen som egen "bana" — det är pall-sektionens rubrik, inte en K-bana.
//  • K61-36  kvar men finns ej i filen efter hopslagning → läser noll → filtreras bort.

export const CELL_MAP = {
  kbanor: [
    { kbana: "K51",    line: "Line 1",   isPL: false,
      pafyll: { iko:[13,13], pavag:[15,13], klart:[17,13], total:[19,13] },
      kart:   { iko:[13,17], pavag:[15,17], klart:[17,17], total:[19,17] } },
    { kbana: "K52",    line: "Line 1/2", isPL: false,
      pafyll: { iko:[14,43], pavag:[16,43], klart:[18,43], total:[20,43] },
      kart:   { iko:[14,47], pavag:[16,47], klart:[18,47], total:[20,47] } },
    { kbana: "K53",    line: "Line 1/2", isPL: false,
      pafyll: { iko:[14,52], pavag:[16,52], klart:[18,52], total:[20,52] },
      kart:   { iko:[14,57], pavag:[16,57], klart:[18,57], total:[20,57] } },
    { kbana: "K56",    line: "Line 2/4", isPL: false,
      pafyll: { iko:[14,77], pavag:[16,77], klart:[18,77], total:[20,77] },
      kart:   { iko:[14,80], pavag:[16,80], klart:[18,80], total:[20,80] } },
    { kbana: "K58",    line: "Line 4/6", isPL: false,
      pafyll: { iko:[34,14], pavag:[35,14], klart:[36,14], total:[37,14] },
      kart:   { iko:[34,18], pavag:[35,18], klart:[36,18], total:[37,18] } },
    { kbana: "K59",    line: "Line 6/7", isPL: false,
      pafyll: { iko:[34,42], pavag:[35,42], klart:[36,42], total:[37,42] },
      kart:   { iko:[34,46], pavag:[35,46], klart:[36,46], total:[37,46] } },
    { kbana: "K60",    line: "Line 6/7", isPL: false,
      pafyll: { iko:[34,51], pavag:[35,51], klart:[36,51], total:[37,51] },
      kart:   { iko:[34,56], pavag:[35,56], klart:[36,56], total:[37,56] } },
    { kbana: "K61-7",  line: "Line 7",   isPL: false,
      pafyll: { iko:[34,79], pavag:[35,79], klart:[36,79], total:[37,79] },
      kart:   { iko:[34,82], pavag:[35,82], klart:[36,82], total:[37,82] } },
    { kbana: "K55",    line: "Stn 36",   isPL: false,
      pafyll: { iko:[51,11], pavag:[53,11], klart:[55,11], total:[58,11] },
      kart:   { iko:[51,15], pavag:[53,15], klart:[55,15], total:[58,15] } },
    // K61-36: finns ej i filen efter hopslagning med K55. Läser noll, filtreras bort.
    // Ta bort blocket helt om den ska försvinna ur UI/localStorage.
    { kbana: "K61-36", line: "Stn 36",   isPL: false,
      pafyll: { iko:[51,19], pavag:[53,19], klart:[55,19], total:[58,19] },
      kart:   { iko:[51,24], pavag:[53,24], klart:[55,24], total:[58,24] } },
    { kbana: "K62",    line: "Stn 50",   isPL: false,
      pafyll: { iko:[51,45], pavag:[53,45], klart:[55,45], total:[58,45] },
      kart:   { iko:[51,50], pavag:[53,50], klart:[55,50], total:[58,50] } },
  ],
  // Pall-sektion ("PL09 - Antal pallar"). Rader: 67 iko, 68 pavag, 69 klart, 70 total.
  pallarPerK: {
    "K51":   { iko:[67,16], pavag:[68,16], klart:[69,16], total:[70,16] },
    "K52":   { iko:[67,23], pavag:[68,23], klart:[69,23], total:[70,23] },
    "K53":   { iko:[67,25], pavag:[68,25], klart:[69,25], total:[70,25] },
    "K56":   { iko:[67,40], pavag:[68,40], klart:[69,40], total:[70,40] },
    "K58":   { iko:[67,44], pavag:[68,44], klart:[69,44], total:[70,44] },
    "K59":   { iko:[67,49], pavag:[68,49], klart:[69,49], total:[70,49] },
    "K61-7": { iko:[67,55], pavag:[68,55], klart:[69,55], total:[70,55] },
  },
  total: {
    pafyll: { iko:[48,78], pavag:[50,78], klart:[52,78], total:[54,78] },
    kart:   { iko:[48,81], pavag:[50,81], klart:[52,81], total:[54,81] },
  },
};
