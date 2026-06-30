// "Vinder på" — afleder 1-2 terræn-typer en rytter er stærkest på ud fra
// dens primær (+ sekundær) ryttertype (#2000 rider-profil-redesign). Ingen ny
// data: bygger på de allerede persisterede riders.primary_type/secondary_type.
// Labels via i18n (rider:terrain.<key>) — EN først, DA under. Returnerer
// terræn-KEYS (oversættes på kaldersiden), så filen forbliver ren .js uden i18n.
//
// Mapping er ejer-bekræftet ryttertype→terræn (#2000): hver type peger på det
// terræn hvor den vinder. gc/rouleur deler "allround"; tt = enkeltstart.

export const TYPE_TERRAIN = {
  sprinter:       "flatSprint",   // Flade massespurter
  rouleur:        "rolling",      // Bølgede ruter
  puncheur:       "punchy",       // Stejle stigninger / puncheur-finaler
  climber:        "mountain",     // Bjergetaper
  gc:             "stageRace",    // Etapeløb (samlet)
  tt:             "timeTrial",    // Enkeltstart
  baroudeur:      "breakaway",    // Udbrud
  brostensrytter: "cobbles",      // Brosten
};

// De terræn-keys (op til 2) en rytter "vinder på", udledt af primær + sekundær
// type. Dubletter fjernes; ukendte typer ignoreres. Tom liste hvis ingen type.
export function winsOnTerrainKeys(primaryType, secondaryType) {
  const keys = [];
  for (const type of [primaryType, secondaryType]) {
    const terrain = TYPE_TERRAIN[type];
    if (terrain && !keys.includes(terrain)) keys.push(terrain);
  }
  return keys.slice(0, 2);
}
