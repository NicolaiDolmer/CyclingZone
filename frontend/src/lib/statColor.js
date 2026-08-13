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
//   "ability" (15 rå rytter-evne-værdier, RiderAbilityColumns/evne-badges i lister/
//   planlægger — IKKE type-vægtet): n=104.595 værdier (6.973 ryttere).
//     median 12 · p75 21 · p90 32 · p97 53 · p99,5 67 · max 99
//     (Menneskehold alene, is_ai=false/is_test_account=false/is_frozen=false, n=39.930/2.662:
//     median 16 · p75 22 · p90 32 · p97 51 · p99,5 64 — praktisk talt samme kurve; ankrene
//     herunder bruger FULD population for større n/stabilitet.)
//   "rating" (riderOverallRating — normaliseret 1-99 type-blendet output, RiderProfileHero/
//     planner-OVR/auktion-OVR): n=6.973 ryttere.
//     median 21 · p75 30 · p90 37 · p97 76 · p99,5 92 · max 99
//   "staffAbility" (staff_derived_abilities.dimensions/levels/role_skills — enkelt-akse pr.
//     StaffAbilityColumns-række): n=552 akse-værdier (119 ansatte). Genereres via en HELT
//     ANDEN model end rytter-evner (tier-bånd 28-90 + jitter, staffAbilityDerivation.js) —
//     deler INGEN fordeling med rytter-siden, så genbrug af "ability" havde stillet stort
//     set alt staff i guld/apex (median 55 > rytter-guld-anker 53). Egen skala, målt 2026-07-25:
//     median 55 · p75 70 · p90 85 · p97 92 · p99,5 99 · max 99.
//   "staffRating" (staff_derived_abilities.overall — StaffPanel/StaffProfileHero/
//     StaffOverviewPage): n=119 ansatte (candidate-niveau bruger samme model). Målt 2026-07-25:
//     median 48 · p75 60 · p90 65 · p97 71 · p99,5 78 · max 79 (tier-båndets teoretiske loft
//     er 90 — næste gen-fit bør retjekke om max har flyttet sig).
//
// Samme #855-farver til og med guld. Toppen (tidl. pink/rød 74-99) er flyttet til dyb
// rav/bronze — rød er ELLERS altid "fejl/bagud/advarsel" i designsystemet (--danger,
// StatusBadge), og elite-ryttere i samme røde var en semantisk kollision (#2890 pkt. 3).
//
// FIRE ankersæt, ikke ét (#2890 pkt. 2 — udvidet fra to til fire efter ejer-krav om at
// afgøre staff-spørgsmålet konkret i stedet for at lade det stå åbent) — samme
// farvepalet, forskellige knæk pr. den population der faktisk vises:
//   statColor(value, { scale: "ability" | "rating" | "staffAbility" | "staffRating" }).
//   Default "ability" (flest kald-steder).
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
  // Rolle-rating (riderOverallRating/riderTypeRating).
  //
  // #3666: rating og evne deler nu ANKRE, fordi de deler ENHED. Ratingen er
  // efter spec §D1 det vægtede snit af rollens evne-tal — den lever altså på
  // præcis samme skala som tallene den er lavet af, og to ankersæt ville derfor
  // farve det samme niveau forskelligt afhængigt af hvilken celle man kigger i.
  // Spec §D4: "rating-tallet kan nu genbruge evne-ankrene · ét visuelt sprog i
  // stedet for to ankersæt".
  //
  // Hvorfor de gamle ankre ikke bare kunne blive stående: de var fittet mod den
  // anker-normaliserede fordeling (median 21, p90 37). Målt read-only mod prod
  // 13/8 på den nye skala er medianen 13 og p90 29 — 6.438 af 8.747 ryttere
  // (73,6 %) ville lande UNDER det gamle grå-stop på 21 og blive renderet i
  // samme grå tone. Hele OVR-fladen ville blive visuelt ensfarvet. Det er
  // #2890's fejl spejlvendt.
  //
  // Staff-ankrene nedenfor er en ANDEN population (staff-dimensioner fordeler
  // sig helt anderledes) og røres ikke — ejer-krav i spec §D4.
  // (rating tildeles nedenfor — den DELER ability-ankrene, se kommentaren ovenfor)
  // Staff dimensions/levels/roleSkills (0-99). Ankre: median 55 (gray-rising-stop) ·
  // p75 70 (grøn) · p90 85 (gul) · p97 92 (guld) · p99,5≈max 99 (apex/dybeste smelter
  // sammen — distributionen klamper hårdt i toppen af tier-båndet).
  staffAbility: [
    [0, [0x56, 0x59, 0x69]],
    [27, [0x6f, 0x72, 0x85]],
    [55, [0xae, 0xb1, 0xc0]],
    [70, [0x33, 0xfc, 0x96]],
    [85, [0xfd, 0xe4, 0x47]],
    [92, [0xfd, 0xc0, 0x32]],
    [97, [0xe2, 0x90, 0x0f]],
    [99, [0x8a, 0x4b, 0x06]],
  ],
  // Staff overall (0-99). Ankre: median 48 (gray-rising-stop) · p75 60 (grøn) ·
  // p90 65 (gul) · p97 71 (guld) · p99,5≈78 (apex). Klamp bevidst ved 99 (ikke målt
  // max 79) — tier-båndets teoretiske loft er 90 (TIER_OVERALL_BAND, tier 5).
  staffRating: [
    [0, [0x56, 0x59, 0x69]],
    [24, [0x6f, 0x72, 0x85]],
    [48, [0xae, 0xb1, 0xc0]],
    [60, [0x33, 0xfc, 0x96]],
    [65, [0xfd, 0xe4, 0x47]],
    [71, [0xfd, 0xc0, 0x32]],
    [78, [0xe2, 0x90, 0x0f]],
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
 * `scale`: "ability" (rå rytter-enkelt-evne, default) · "rating" (normaliseret rytter-
 * overall) · "staffAbility" (staff dimensions/levels/roleSkills) · "staffRating"
 * (staff overall) — fire væsensforskellige fordelinger (#2890), så samme tal betyder
 * IKKE det samme på tværs af dem.
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
