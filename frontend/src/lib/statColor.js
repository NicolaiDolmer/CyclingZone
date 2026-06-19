// Ensartet evne-farve-gradient — én kilde til sandhed for ALLE rytter-evne-visninger
// (tal-badges i lister/oversigter + bjælker på ryttersiden).
//
// Godkendt hybrid (ejer, 31. maj, issue #855): blødt gradient-forløb med #855's
// eksakt målte farver låst som anker-knæk, lineær interpolation imellem, dybere rød i
// toppen til elite-ryttere. Samme værdi → samme farve overalt.
//
// RE-ANKRET 2026-06-19 til CZ-evne-skalaen (#1122/#1529): visningen skiftede fra
// PCM-stats (snit ~62, klumpet 50-82) til derived abilities (snit ~40, spænder 1-99).
// SAMME #855-farver — kun ankerVÆRDIERNE er flyttet ned, så median→strong→elite får en
// meningsfuld farvekurve i stedet for "næsten alt grå". Nye ankre: grøn 42, gul 55,
// guld 64, pink/rød 74. (Tidligere PCM-ankre: grøn 71, gul 77, rød 84.)

const KNOTS = [
  [0, [0x56, 0x59, 0x69]], // floor: dæmpet grå
  [20, [0x6f, 0x72, 0x85]], // lav grå
  [33, [0xae, 0xb1, 0xc0]], // grå stigende (under median)
  [42, [0x33, 0xfc, 0x96]], // grøn      (anker — solid/median+)
  [55, [0xfd, 0xe4, 0x47]], // gul       (anker — stærk)
  [64, [0xfd, 0xc0, 0x32]], // guld      (~p90)
  [74, [0xfd, 0x32, 0x63]], // pink/rød  (anker — meget stærk)
  [85, [0xe2, 0x10, 0x4c]], // dybere rød
  [99, [0xa8, 0x08, 0x2f]], // dybeste rød (elite)
];

function toHex(rgb) {
  return "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

/**
 * Gradient-farven (hex-streng) for en evne-værdi (0–99). Klampes til knæk-intervallet.
 */
export function statColor(value) {
  const num = Number(value);
  const v = Number.isFinite(num) ? num : 0;
  const first = KNOTS[0];
  const last = KNOTS[KNOTS.length - 1];
  if (v <= first[0]) return toHex(first[1]);
  if (v >= last[0]) return toHex(last[1]);
  for (let i = 0; i < KNOTS.length - 1; i++) {
    const [av, ac] = KNOTS[i];
    const [bv, bc] = KNOTS[i + 1];
    if (v >= av && v <= bv) {
      const t = (v - av) / (bv - av);
      return toHex([0, 1, 2].map((k) => ac[k] + (bc[k] - ac[k]) * t));
    }
  }
  return toHex(last[1]);
}

/**
 * Sort/hvid tekstfarve med tilstrækkelig kontrast oven på den farvede badge-baggrund.
 */
export function statTextColor(value) {
  const hex = statColor(value);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma > 140 ? "#101014" : "#f5f5fa";
}

/**
 * Inline-style til en evne-badge: farvet baggrund + kontrast-tekst.
 * Brug: <span className="...rounded" style={statStyle(value)}>{value}</span>
 */
export function statStyle(value) {
  return { backgroundColor: statColor(value), color: statTextColor(value) };
}
