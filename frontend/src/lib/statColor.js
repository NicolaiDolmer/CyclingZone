// Ensartet evne-farve-gradient — én kilde til sandhed for ALLE rytter/staff-tal-visninger
// (tal-badges i lister/oversigter + bjælker på ryttersiden).
//
// Godkendt hybrid (ejer, 31. maj, issue #855): blødt gradient-forløb med #855's
// eksakt målte farver låst som anker-knæk, lineær interpolation imellem.
//
// RE-ANKRET 2026-06-19 til CZ-evne-skalaen (#1122/#1529) — men til FASTE tal ("snit ~40"),
// som viste sig forkerte for den faktiske population. RE-ANKRET IGEN 2026-07-25 (#2890):
// 96% af ryttere på menneskehold renderede gråt, fordi to helt forskellige fordelinger blev
// fodret gennem ét anker-sæt. Målt read-only mod prod (execute_sql, 2026-07-25):
//
//   Ankre = percentiler af FULD population (alle aktive, ikke-pensionerede ryttere — samme
//   metode som RATING_O_ELITE/O_MIN i riderRating.js), IKKE faste tal. TUNABLE KNOBS: gen-fit
//   ved sæsonskifte hvis populationen flytter sig markant (samme regel som riderRating.js).
//
//   "ability" (15 rå evne-værdier, RiderAbilityColumns/StaffAbilityColumns/evne-badges i
//   lister/planlægger — IKKE type-vægtet): n=104.595 værdier (6.973 ryttere).
//     median 12 · p75 21 · p90 32 · p97 53 · p99,5 67 · max 99
//     (Menneskehold alene, is_ai=false/is_test_account=false/is_frozen=false, n=39.930/2.662:
//     median 16 · p75 22 · p90 32 · p97 51 · p99,5 64 — praktisk talt samme kurve; ankrene
//     herunder bruger FULD population for større n/stabilitet.)
//   "rating" (riderOverallRating — normaliseret 1-99 type-blendet output, RiderProfileHero/
//     StaffProfileHero/StaffPanel/StaffOverviewPage/planner-OVR/auktion-OVR): n=6.973 ryttere.
//     median 21 · p75 30 · p90 37 · p97 76 · p99,5 92 · max 99
//
// Samme #855-farver til og med guld. Toppen (tidl. pink/rød 74-99) er flyttet til dyb
// rav/bronze — rød er ELLERS altid "fejl/bagud/advarsel" i designsystemet (--danger,
// StatusBadge), og elite-ryttere i samme røde var en semantisk kollision (#2890 pkt. 3).
//
// TO ankersæt, ikke ét (#2890 pkt. 2) — samme farvepalet, forskellige knæk:
//   statColor(value, { scale: "ability" | "rating" }). Default "ability" (flest kald-steder).
const KNOTS_BY_SCALE = {
  // Rå enkelt-evne (0-99). Ankre: median 12 (gray-rising-stop) · p75 21 (grøn) ·
  // p90 32 (gul) · p97 53 (guld) · p99,5 67 (apex) · 99 (dybeste, klamp).
  ability: [
    [0, [0x56, 0x59, 0x69]], // floor: dæmpet grå
    [6, [0x6f, 0x72, 0x85]], // lav grå (~halvt af median)
    [12, [0xae, 0xb1, 0xc0]], // grå stigende (population-median — "typisk")
    [21, [0x33, 0xfc, 0x96]], // grøn      (anker — p75, solidt over median)
    [32, [0xfd, 0xe4, 0x47]], // gul       (anker — p90, stærk)
    [53, [0xfd, 0xc0, 0x32]], // guld      (anker — p97, meget stærk)
    [67, [0xe2, 0x90, 0x0f]], // apex/rav  (anker — p99,5, elite)
    [99, [0x8a, 0x4b, 0x06]], // dybeste bronze (absolut top)
  ],
  // Normaliseret 1-99-rating (riderOverallRating og analoge overalls). Ankre: median 21
  // (gray-rising-stop) · p75 30 (grøn) · p90 37 (gul) · p97 76 (guld) · p99,5 92 (apex).
  rating: [
    [0, [0x56, 0x59, 0x69]],
    [10, [0x6f, 0x72, 0x85]],
    [21, [0xae, 0xb1, 0xc0]],
    [30, [0x33, 0xfc, 0x96]],
    [37, [0xfd, 0xe4, 0x47]],
    [76, [0xfd, 0xc0, 0x32]],
    [92, [0xe2, 0x90, 0x0f]],
    [99, [0x8a, 0x4b, 0x06]],
  ],
};

function toHex(rgb) {
  return "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

function resolveKnots(scale) {
  return KNOTS_BY_SCALE[scale] ?? KNOTS_BY_SCALE.ability;
}

/**
 * Gradient-farven (hex-streng) for en 0-99-værdi. Klampes til knæk-intervallet.
 * `scale`: "ability" (rå enkelt-evne, default) eller "rating" (normaliseret 1-99-overall) —
 * de to fordelinger er væsensforskellige (#2890), så samme tal betyder ikke det samme.
 */
export function statColor(value, { scale = "ability" } = {}) {
  const num = Number(value);
  const v = Number.isFinite(num) ? num : 0;
  const KNOTS = resolveKnots(scale);
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
export function statTextColor(value, opts) {
  const hex = statColor(value, opts);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma > 140 ? "#101014" : "#f5f5fa";
}

/**
 * Inline-style til en evne-badge: farvet baggrund + kontrast-tekst.
 * Brug: <span className="...rounded" style={statStyle(value)}>{value}</span>
 * Rating-tal: statStyle(value, { scale: "rating" }).
 */
export function statStyle(value, opts) {
  return { backgroundColor: statColor(value, opts), color: statTextColor(value, opts) };
}

/**
 * Inline-style til en RATING-plade: farvet tal på en 16%-alpha tint af SAMME farve
 * (T3-spec'ens "rating renders as a color plate"). Modsat statStyle (fuld-mættet
 * badge til evne-tallene) er pladen den roligere behandling der bruges hvor
 * ratingen står alene som hovedtal.
 *
 * #2888/#2906: udtrukket her fordi rytterprofilens hero, personale-heroen og nu
 * trup-tabellen alle skal se ENS ud — de to heroer havde hver sin kopi af
 * `${statColor(v)}29`-udtrykket. Hex + "29" = 16% alpha.
 *
 * Bruges ALTID med en normaliseret 1-99-rating (#2890) — default scale "rating".
 * Brug: <span className="...rounded-cz" style={statPlateStyle(rating)}>{rating}</span>
 */
export function statPlateStyle(value, { scale = "rating" } = {}) {
  const hex = statColor(value, { scale });
  return { color: hex, backgroundColor: `${hex}29` };
}
