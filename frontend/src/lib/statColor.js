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
//   Ankre = percentiler af FULD population (alle aktive, ikke-pensionerede ryttere), IKKE
//   faste tal. TUNABLE KNOBS: gen-fit ved sæsonskifte hvis populationen flytter sig markant.
//
//   #3666: denne historik gælder KUN "ability"/"staff*"-ankrene nedenfor. Henvisningen til
//   RATING_O_ELITE/O_MIN i riderRating.js er fjernet, fordi de symboler ikke findes mere —
//   rating-rampen er absolut og gen-fittes aldrig (se RIDER_RAMP). At lade en peger stå til
//   slettet kode er præcis den slags stille drift omlægningen blev lavet for at fjerne.
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
// ============================================================================
// #3666 — RYTTER-RAMPEN. Tema-bevidst, monoton i lyshed, farveblind-verificeret.
// ============================================================================
//
// Rating og evne DELER nu rampe, fordi de deler ENHED: ratingen er efter spec
// §D1 det vægtede snit af rollens evne-tal, så den lever på præcis samme skala
// som tallene den er lavet af. To ankersæt ville farve det samme niveau
// forskelligt afhængigt af hvilken celle man kiggede i.
//
// Den gamle rampe (grå → grøn → gul → guld → bronze) havde tre målte defekter:
//   1. Lysheden var IKKE monoton. Den steg til ~rating 40 og faldt igen, så
//      rating 95 var mørkere end rating 5. I gråtone og for en farveblind
//      spiller læstes skalaens to yderpunkter derfor næsten ens: ΔE 11,3.
//   2. Kontrasten som tekst mod den lyse flade gik ned til 1,24:1 (krav 3:1) —
//      hele mellemfeltet var reelt ulæseligt i lyst tema.
//   3. Guld mod gul lå på ΔE 8,7 for NORMALT farvesyn, under grænsen.
//
// Den nye rampe stiger monotont i lyshed hele vejen, i begge temaer. Det er
// dét der gør at rækkefølgen overlever deuteranopi, protanopi, tritanopi OG
// gråtone: højere rating er altid lysere, uanset hvordan man ser farver.
// Målt: rating 5 mod 90 går fra ΔE 11,3 til ~51.
//
// ANKRENE ER ABSOLUTTE, ikke percentiler. De gamle var fittet mod befolkningen
// og skulle re-fittes hver gang bestanden flyttede sig — det er grunden til at
// farverne er blevet ændret gentagne gange. Den nye skala er absolut (13 i alle
// evner der tæller → rating 13), så ankrene kan bindes til niveauet selv.
//
// FARVEN ER BADGENS FYLD, ikke tallets blæk (ejer-beslutning efter test med en
// farveblind spiller). Det frigiver hele lyshedsspændet, fordi farven ikke
// længere skal kunne læses som tekst — og tallet får maksimal læsbarhed, fordi
// det skrives i kontrast-styret blæk. Badgens FORM bæres af en hårfin ramme, så
// fyldet må være stille i bunden: en rating på 9 skal ikke råbe.
//
// En CI-vagt (statColor.contract.test.js) håndhæver monotonien, kontrastgulvet
// og farveblind-adskillelsen, så ingen fremtidig ændring kan bryde dem ubemærket.
// Knækkene ligger på 0·9·13·24·32·44·60·75·85·99 — TÆT I TOPPEN med vilje.
// Den første version havde dem på evne-percentilerne (0·6·12·21·32·53·67·99),
// og det efterlod 67→99 som ét spring uden nævneværdig farveændring: målt lå
// rating 70 til 95 kun ΔE 1,9-2,6 fra hinanden, altså netop dér spillets 10
// bedste ryttere ligger. Lyshed og farvetone følger nu VÆRDIEN lineært, så
// farven ændrer sig lige meget pr. rating-point hele vejen op.
//
// Fordelingen er lært af en farveblind spillers egen version (14/8). Hans
// skala målte dårligere end vores på lyshedsspænd og monotoni — hans lyse
// rampe vender om 24 steder i toppen (gul→orange→rød) — men han slog os på to
// ting, og begge er taget med: en mere synlig bund i mørkt tema, og jævnere
// spring. Resultatet er bedre end begge udgangspunkter.
const RIDER_RAMP = {
  // Lyst tema (flade #fcfbf7). Lav = dyb navy, høj = guld.
  light: [
    [0, [0x09, 0x11, 0x23]],
    [9, [0x0a, 0x21, 0x36]],
    [13, [0x09, 0x28, 0x3e]],
    [24, [0x00, 0x3f, 0x51]],
    [32, [0x00, 0x51, 0x5d]],
    [44, [0x00, 0x6c, 0x67]],
    [60, [0x24, 0x8f, 0x65]],
    [75, [0x70, 0xab, 0x52]],
    [85, [0xa3, 0xba, 0x3d]],
    [99, [0xed, 0xc8, 0x12]],
  ],
  // Mørkt tema (flade #161824). Lav = dæmpet skifer-blå, høj = klar gul.
  dark: [
    [0, [0x42, 0x54, 0x68]],
    [9, [0x43, 0x65, 0x79]],
    [13, [0x42, 0x6c, 0x80]],
    [24, [0x3c, 0x82, 0x90]],
    [32, [0x36, 0x93, 0x98]],
    [44, [0x37, 0xac, 0x9b]],
    [60, [0x61, 0xca, 0x8e]],
    [75, [0xa3, 0xe0, 0x70]],
    [85, [0xd5, 0xeb, 0x51]],
    [99, [0xff, 0xf2, 0x00]],
  ],
};

// Temaet stampes som data-theme="dark" på roden (lib/theme.jsx) og FJERNES i
// lyst tema. Uden document (node --test) falder vi tilbage på lyst.
function isDarkTheme() {
  if (typeof document === "undefined") return false;
  return document.documentElement?.getAttribute("data-theme") === "dark";
}

const KNOTS_BY_SCALE = {
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

// #3666: "ability" og "rating" er samme rytter-rampe og deler tema-varianterne.
// Staff-skalaerne er en anden population og er tema-uafhængige som hidtil.
function resolveKnots(scale) {
  if (scale === "staffAbility" || scale === "staffRating") return KNOTS_BY_SCALE[scale];
  return isDarkTheme() ? RIDER_RAMP.dark : RIDER_RAMP.light;
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

export const INK_DARK = "#101014";
export const INK_LIGHT = "#f5f5fa";

// Relativ luminans (WCAG). Eksporteret så kontrakt-vagten måler mod SAMME
// funktion som visningen bruger, ikke mod sin egen kopi.
export function relativeLuminance(hex) {
  const ch = [1, 3, 5].map((i) => {
    const s = parseInt(hex.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
export function contrastRatio(a, b) {
  const x = relativeLuminance(a), y = relativeLuminance(b);
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Sort/hvid tekstfarve oven på den farvede badge-baggrund.
 *
 * #3666: vælger nu det blæk der faktisk giver HØJEST kontrast, i stedet for at
 * skifte ved en fast lysheds-tærskel (luma > 140). Tærsklen ramte forbi omkring
 * mellemtonerne: målt lå tallets kontrast mod fyldet nede på 2,88:1 ved rating
 * 49 — under de 3:1 som selv stor tekst kræver. Med max-valget er bunden 4,20:1
 * over hele skalaen. Samme to blækfarver, kun valget er blevet rigtigt.
 */
export function statTextColor(value, opts) {
  const hex = statColor(value, opts);
  return contrastRatio(INK_DARK, hex) >= contrastRatio(INK_LIGHT, hex) ? INK_DARK : INK_LIGHT;
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
 * Inline-style til en RATING-plade.
 *
 * #3666 (ejer-beslutning efter test med en farveblind spiller): farven er nu
 * pladens FYLD, ikke tallets blæk. Før stod tallet i farven på en 16%-tint af
 * samme farve — og fordi tallet skulle kunne læses, måtte farven holdes inde i
 * et smalt lyshedsbånd. Målt gik kontrasten alligevel ned til 1,24:1 i lyst
 * tema, og båndet kostede så meget af skalaen at to nære ratings blev svære at
 * skelne.
 *
 * Nu bærer fyldet farven og tallet skrives i kontrast-styret blæk. Det giver
 * tallet maksimal læsbarhed uanset niveau, og frigiver hele lyshedsspændet til
 * at adskille trinnene: målt næsten en fordobling (ΔE 3,4 → 5,6 for et
 * 10-points spring under farveblindhed).
 *
 * Den hårfine ramme er ikke dekoration. Uden den ligger de to nederste trin på
 * 1,63 og 2,35 i kontrast mod kortet i mørkt tema, altså under de 3:1 en
 * UI-komponent skal have — en lav rating ville forsvinde ind i fladen. Rammen
 * lader formen bære synligheden, så fyldet må være stille i bunden: en rating
 * på 9 skal kunne ses uden at råbe. Alternativet — at hæve fyldets bund — blev
 * målt og koster en tredjedel af adskillelsen, altså præcis den egenskab
 * omlægningen findes for.
 *
 * Brug: <span className="...rounded-cz border" style={statPlateStyle(rating)}>{rating}</span>
 */
export function statPlateStyle(value, { scale = "rating" } = {}) {
  const hex = statColor(value, { scale });
  return {
    backgroundColor: hex,
    color: statTextColor(value, { scale }),
    // Hårfin ramme i fladens egen retning — lys kant på mørkt tema, mørk på lyst.
    border: `1px solid ${isDarkTheme() ? "rgba(255,255,255,.26)" : "rgba(0,0,0,.14)"}`,
  };
}
