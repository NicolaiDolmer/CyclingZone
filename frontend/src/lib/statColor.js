// Ensartet evne-farve-gradient — én kilde til sandhed for ALLE rytter-evne-visninger
// (tal-badges i lister/oversigter + bjælker på ryttersiden).
//
// Godkendt hybrid (ejer, 31. maj, issue #855): blødt gradient-forløb hvor PCM's eksakt
// målte farver er låst som anker-knæk, lineær interpolation imellem, og dybere rød i
// toppen (86–99) til elite-ryttere. Samme værdi → samme farve overalt.
//
// PCM-målte ankre: 71→#33fc96 (grøn), 77→#fde447 (gul), 84→#fd3263 (pink/rød).
// Orange opstår naturligt i guld→pink-overgangen (~81–83).

const KNOTS = [
  [0, [0x56, 0x59, 0x69]], // floor: dæmpet grå
  [50, [0x6f, 0x72, 0x85]], // lav grå
  [62, [0xae, 0xb1, 0xc0]], // grå stigende
  [68, [0xce, 0xd1, 0xd2]], // PCM grå        (<70-bånd)
  [71, [0x33, 0xfc, 0x96]], // PCM grøn       (anker)
  [77, [0xfd, 0xe4, 0x47]], // PCM gul        (anker)
  [80, [0xfd, 0xc0, 0x32]], // PCM guld
  [84, [0xfd, 0x32, 0x63]], // PCM pink/rød   (anker)
  [90, [0xe2, 0x10, 0x4c]], // dybere rød
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
