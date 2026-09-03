// backend/lib/tierCalendarGuarantees.js
// #3327/#3328 (Discord-sweep 4/8, ejer-beslutninger i issue-kommentarer): kalender-
// dækningsgarantier som DATA, ikke kode-konstanter — så de kan justeres pr. tier uden
// deploy. To problemer, samme generator:
//
//   #3327: Division 2's kalender var 33% endagsløb (mål ~50%) og brostens-specialister
//          havde reelt 2 etaper/pulje/sæson at bruge — ubalanceret dækning pr. terræn-
//          familie og for lidt mix mellem endagsløb/etapeløb.
//   #3328: Løbsklasse og etapeantal var afkoblet — 89% af D2's etapeløb var ProSeries,
//          nogle op til 8 etaper, mens de få WorldTour-etapeløb ikke gav mere afkast.
//
// REN datafil (ingen DB/RNG) + rene hjælpefunktioner der beregner dækning fra et
// FÆRDIGT udvalg (raceRows) + genererede etape-profiler — bruges af
// tierCalendarMaterializer.js til at (a) style selection mod målene og (b) verificere
// EFTER generering at garantierne faktisk blev opfyldt, ellers fejle højlydt.

// ── #3327: endagsløb/etapeløb-mix pr. tier (andel af RACE COUNT, ikke game-days) ──
//
// EJER-BESLUTNING 2026-08-07 morgen (afløser 4/8-frysningen nedenfor — se den kun som
// historik): "Der mangler nogle endagsløb i 1. division. Der er for mange i 3. division.
// 2. division kan godt holde til et par stykker mere. Mere ensartet balance." Orkestrator-
// oversættelse til mål (antal-andel endagsløb): D1 0,55 (op fra 0,48 — for få endagsløb) ·
// D2 0,55 (op fra 0,50 — "kan godt holde til et par stykker mere") · D3 0,58 (NED fra
// 0,76 — "for mange") · D4 0,55 (uændret niveau, nu eksplicit samme tal som D1/D2 for
// "mere ensartet balance" i stedet for et separat 0,50-tal). MIN = target − 0,10 (husets
// mønster fra 4/8-frysningen, uændret metode).
//
// HISTORIK (4/8-frysning, nu AFLØST): D2 hævet til ~50/50 (ejer-beslutning 4/8,
// #3327-kommentar). D1/D3/D4 var sat til deres DAVÆRENDE observerede andel (prod, sæson 2,
// 4/8) som bevidst target/floor — ingen tilsigtet ændring for dem dengang, kun at gøre
// tallet til data i stedet for et biprodukt af en grådig prestige-sortering.
export const TIER_ONE_DAY_SHARE_TARGET = Object.freeze({ 1: 0.55, 2: 0.55, 3: 0.58, 4: 0.55 });
export const TIER_ONE_DAY_SHARE_MIN = Object.freeze({ 1: 0.45, 2: 0.45, 3: 0.48, 4: 0.45 });

// ── #3328: klasse↔etapeantal-bånd (ejer-beslutning 4/8) ──
//
// ProSeries korte etapeløb (3-5), WorldTour C/B/A længere (6-8) — SAMME bånd for alle tre
// WorldTour-underklasser (ejer valgte den simple 2-bånds-udgave, ikke #3328's oprindelige
// forslag med ét bånd pr. WorldTour-bogstav).
//
// #4270 (EJER-BESLUTNING 3/9, lukker CALENDAR_RULES.md §11 punkt 2): Class1 og Class2 faar
// baandet [3, 6]. Foer stod de uden baand - ikke fordi nogen havde besluttet det, men fordi
// #3328 kun tog stilling til ProSeries og WorldTour. Maalt 30/8 koerte D4 Class2-etapeloeb
// med 2 ETAPER; et etapeloeb paa to dage er ikke et etapeloeb, det er to endagsloeb med
// faelles klassement. Loftet 6 holder Class1/Class2 under WorldTour-baandets 6-8, saa
// klasse-hierarkiet stadig betyder noget i laengde.
//
// PRIS, maalt og ikke gaettet: etapeloeb med 2 etaper falder ud af vinduet. D4's
// klasse-vindue (Class1+Class2) er i forvejen tyndt (19 etapeloeb, katalog-maaling 3/9), og
// katalog-udvidelsen ligger i et andet spor. Konsekvensen for D4's kvote-opfyldelse maales i
// docs/audits/season4-calendar-dryrun-2026-09-03.md - ikke skjult bag et groent flueben.
//
// Klasser UDEN et bånd her (GrandTour/TourFrance/GiroVuelta/Monuments) er UPÅVIRKEDE.
// GT'erne har 17/17/18 etaper i kataloget (CALENDAR_RULES.md §3) - den gamle kommentar om
// "GT'ens 21 etaper er ejer-bekraeftet" var en rest fra et katalog der ikke findes laengere.
export const CLASS_STAGE_LENGTH_BAND = Object.freeze({
  ProSeries: Object.freeze([3, 5]),
  OtherWorldTourC: Object.freeze([6, 8]),
  OtherWorldTourB: Object.freeze([6, 8]),
  OtherWorldTourA: Object.freeze([6, 8]),
  Class1: Object.freeze([3, 6]),
  Class2: Object.freeze([3, 6]),
});

// ── Terræn-familier: arketyper der får forrang inden for prestige-lige valg ──
//
// Disse arketyper er KNAPPE i race_pool-kataloget (se PR-body for optælling) og
// tabte konsekvent til større/talrigere løb i den rene størrelse-sortering. Ved at give
// dem forrang ved uafgjort prestige+størrelse (i stedet for kun seed) øges chancen for at
// selectTierRaceSet rent faktisk fylder dækningsgarantierne nedenfor — verificeret
// efterfølgende, aldrig antaget.
export const SCARCE_TERRAIN_ARCHETYPES = Object.freeze([
  "cobbled_classic", "cobbled_tour", "itt_classic", "sprinter_tour_summits", "hilly_tour",
]);

// ── Terræn-familie pr. genereret profil-type (efter raceStageProfileGenerator) ──
//
// "classic" (kun fra hilly_classic-arketypen) regnes IKKE med i cobbles-familien her —
// den er RNG-afhængig (40% chance) og hilly_classic er dokumenteret som samme karakter
// som puncheur (kuperet, ikke brosten). Brosten-garantien måler kun `cobbles` (100%
// deterministisk fra cobbled_classic/cobbled_tour-arketyper). #3327's audit-SQL viste
// cobbles+classic samlet under overskriften "brostens-etaper" — det gengives i
// dry-run-rapporten som to separate kolonner (samme konvention), men KUN `cobbles`
// håndhæves som garanti.
// #3469 (hærdnings-pakken, ejer-beslutning 7/8): "mountain"-familien tilføjet —
// mountain+high_mountain-profiler, samme håndhævelse (coverage-gate/apply-refusal) som
// de øvrige familier. Uden den kunne bjerg-forsyningen (summit-finaler, M-Down-loftet)
// kun MÅLES af raceRouteRealismMetrics.js EFTER hele selection var låst — denne familie
// giver samme "reservér/beskyt i valget" gulv som cobbles/flat/itt/hilly allerede har.
// #4176 (ejer-beslutning 24/8): `itt_hilly` tæller nu med i itt-familien. "En bakket
// enkeltstart bør tælle som en enkeltstart. Det er jo for fanden en enkeltstart."
// Den var indtil nu udenfor HVER eneste terræn-familie, mens kompositionen
// (PROFILE_TO_CATEGORY i calendarCompositionTargets.js) allerede talte den som ITT —
// to grupperinger der modsagde hinanden uden begrundelse. Målt effekt på live sæson 3:
// enkeltstarter der tæller mod gulvet går fra 12/11/10/2 til 14/11/10/6 pr. pulje
// (D4 havde 6 enkeltstarter, men kun 2 af dem talte).
// #4176 (ejer-beslutning 24/8): `rolling` er sin EGEN familie — baroudeurens terræn.
//
// Afgjort empirisk, ikke efter navn. Overrepræsentation blandt etapevindere (andel af
// sejre ÷ andel af populationen, S1+S2, 1,00 = neutralt):
//   rolling:  baroudeur 1,85 · klatrer 1,38 · gc 1,20 · SPRINTER 1,14 · PUNCHEUR 0,91
//   flad:     sprinter 3,01 (alt andet ≤ 1,04)
//   kuperet:  baroudeur 1,66 · puncheur 1,51 · klatrer 1,44 · gc 1,43
// Motorens egen vægtning siger det samme: flad er 0,61 spurt, kuperet er 0,44 punch,
// mens rolling har INGEN dominerende evne — dens største vægte er udholdenhed 0,18 og
// tilfældighed 0,20, de højeste af alle typer. Det er en udbrudsdag.
//
// Derfor hverken flat_sprint eller hilly: sprinteren står i 1,14 på rolling (mod 3,01 på
// flad) og puncheuren i 0,91 (mod 1,51 på kuperet). Et gulv fyldt med rolling-etaper
// ville altså ikke garantere nogen af de to typer det det blev lavet til.
//
// Baroudeuren var den ENESTE ryttertype uden en familie (brosten→brostensrytter,
// flad→sprinter, itt→TT, kuperet→puncheur, bjerg→klatrer). Med rolling som familie er
// garanti-systemet komplet. Kompositionen er UÆNDRET: rolling tæller fortsat som
// "kuperet" dér, jf. ejerens egen gruppering i #3295.
// #4270 (EJER-BESLUTNING 3/9, lukker halvdelen af CALENDAR_RULES.md §11 punkt 6):
//   · `classic` hoerer nu til HILLY-familien. Foer hoerte den til INGEN familie: 9 af
//     saeson 3's 426 etaper (D2 2, D3 3, D4 4) taeltes ikke mod noget gulv overhovedet.
//     hilly_classic er dokumenteret som samme karakter som puncheuren (kuperet), og
//     kompositionen (PROFILE_TO_CATEGORY i calendarCompositionTargets.js) har hele tiden
//     talt den som "hilly" - de to grupperinger modsagde hinanden uden begrundelse, praecis
//     som `itt_hilly` gjorde det indtil 24/8.
//   · `gravel` er FORBEREDT som cobbles-familie. Etapetypen findes ikke i motoren endnu
//     (#4105 indfoerer den i et andet spor og konverterer Terre di Toscana), men ejeren har
//     besluttet at grusloeb taeller med i brostensklassikerne. Uden denne raekke ville den
//     foerste gravel-etape falde ud af HVER dae­kningsgaranti i stilhed - samme fejlklasse
//     som `rolling`/`classic`/`itt_hilly` allerede har kostet os to gange.
//     Se CALENDAR_RULES.md §5.
export const TERRAIN_FAMILY_BY_PROFILE_TYPE = Object.freeze({
  cobbles: "cobbles", gravel: "cobbles",
  flat: "flat_sprint",
  itt: "itt", ttt: "itt", itt_hilly: "itt",
  hilly: "hilly", classic: "hilly",
  rolling: "rolling",
  mountain: "mountain", high_mountain: "mountain",
});
export const TERRAIN_FAMILIES = Object.freeze(["cobbles", "flat_sprint", "itt", "hilly", "rolling", "mountain"]);

// Minimum antal etaper (ikke løb!) pr. terræn-familie pr. PULJE pr. sæson. Pooler i en
// tier deler identisk kalender (#2276), så "pr. pulje" = tierens samlede udvalg — ingen
// multiplikation nødvendig. D2: cobbles hævet fra observeret 2 → 6 (3x, ejer-ask 4/8).
// Øvrige tal = floor et godt stykke under nuværende observerede niveau (prod, sæson 2,
// 4/8) — beskytter mod fremtidig regression uden at tvinge uændrede tiers til at ramme
// et nyt eksakt tal.
// mountain-gulvet (#3469, ejer-beslutning 7/8): EMPIRISK KALIBRERET mod katalogets
// faktiske bjerg-familie-loft (2.000 trækvarianter × 2 base-seeds pr. tier, 2026-08-07 —
// samme harness/metode som raceRouteRealismMetrics.js's TIER_TARGETS-docstring,
// `node scripts/raceRouteRealismDrawHarness.js --catalog --tier N`):
//   T1 loft middel 46,1 (min 31 over 2.000 træk) → mål 28, rigelig margin.
//   T2 loft middel 21,1 (min 15 — TYND margin) → mål 20, samme interim-forsyningsmangel
//     som D2's summit_min i raceRouteRealismMetrics.js (kataloget mangler bjerg-løb).
//   T3 loft middel 20,4 (min 18) → mål 12, rigelig margin.
//   T4 loft middel 20,3 (min 19) → mål 13, rigelig margin.
// #4270 (EJER-BESLUTNING 3/9, lukker resten af CALENDAR_RULES.md §11 punkt 6): `rolling`
// faar BAADE gulv og loft i alle fire divisioner. Den blev sin egen familie 24/8 (#4176)
// men fik aldrig et gulv - maalt 30/8 havde D4 NUL rolling-etaper, altsaa ingen dage til
// baroudeuren hele saesonen, og ingen gate sagde fra.
//
// Hvorfor OGSAA et loft, og kun paa rolling: rolling er den eneste familie uden en
// dominerende evne (stoerste vaegte er udholdenhed 0,18 og tilfaeldighed 0,20, de hoejeste
// af alle ti profiltyper). Et gulv alene ville lade den vokse frit paa bekostning af de
// familier der ER nogens speciale - en division fuld af udbrudsdage er ikke en division
// hvor sprinteren, puncheuren eller klatreren har noget at koere efter. De oevrige fem
// familier har en profiltype med et ejermaal i §6/§6b og er dermed allerede loftet ovenfra.
// Tallene staar i TIER_TERRAIN_FAMILY_MAX nedenfor med begrundelse pr. division.
export const TIER_TERRAIN_FAMILY_MIN = Object.freeze({
  1: Object.freeze({ cobbles: 3, flat_sprint: 20, itt: 5, hilly: 10, mountain: 28, rolling: 14 }),
  2: Object.freeze({ cobbles: 6, flat_sprint: 15, itt: 4, hilly: 8, mountain: 20, rolling: 6 }),
  3: Object.freeze({ cobbles: 5, flat_sprint: 12, itt: 3, hilly: 8, mountain: 12, rolling: 3 }),
  4: Object.freeze({ cobbles: 1, flat_sprint: 8, itt: 1, hilly: 6, mountain: 13, rolling: 1 }),
});

// Maksimum antal etaper pr. terraen-familie pr. pulje pr. sae­son. KUN `rolling` har et loft
// i dag (se begrundelsen ved TIER_TERRAIN_FAMILY_MIN). En familie uden en raekke her er
// uloftet - det er ikke en mangel, det er de fem oevrige familiers §6/§6b-maal der loefter
// dem ovenfra.
//
// TALGRUNDLAG (maalt, ikke gaettet). To maalinger pr. division: live saeson 3 (30/8,
// read-only mod prod) og S4's 28-dages plan (dry-run 3/9, uden tilt, D4 paa density 3).
//
//   | div | S3 live      | S4-plan      | band      | begrundelse                        |
//   | D1  | 22 af 155    | 19 af 140    | [14, 26]  | baandet er +/-6 om midten (20).    |
//   |     | 14,2 %       | 13,6 %       |           | D1 har 140 etaper, saa 1 etape er  |
//   |     |              |              |           | 0,7 pp - et smallere baand ville   |
//   |     |              |              |           | vaere roedt paa stoej, ikke skaevhed.|
//   | D2  |  9 af 124    | 10 af 112    | [6, 14]   | samme relative bredde, skaleret.   |
//   | D3  |  4 af  85    |  4 af  84    | [3, 8]    | gulv lige under den maalte vaerdi. |
//   | D4  |  0 af  62    |  1 af  84    | [1, 6]    | se nedenfor.                       |
//
// D4's gulv er 1, ikke 2, og det er et BEVIDST valg maalt frem: S4-planen leverer 1
// rolling-etape af 84 (1,2 %) mod D1's 13,6 %. Et gulv paa 2 ville vaere en garanti uden
// forsyning - praecis den fejlklasse
// `.claude/learnings/2026-08-06-garanti-uden-forsyning-blokerede-s3-kalenderen.md`
// beskriver, og den blokerer en saeson i stedet for at forbedre den. Gulvet paa 1 er
// alligevel den regressionsvagt der manglede: S3 leverede NUL, altsaa ingen dag til
// baroudeuren i hele divisionen, og ingen gate sagde fra.
//
// Rolling er en GENERERET profiltype (ARCHETYPE_PROFILES' filler-vaegte), ikke en egenskab
// ved et katalog-loeb. D4's 1,2 % kan derfor kun loeftes ved at genkalibrere fillerne pr.
// division - og den genkalibrering er ejer-besluttet 3/9 som en S5-opgave (se
// CALENDAR_RULES.md §6b). Naar den lander, er D4's gulv det foerste tal der skal op.
export const TIER_TERRAIN_FAMILY_MAX = Object.freeze({
  1: Object.freeze({ rolling: 26 }),
  2: Object.freeze({ rolling: 14 }),
  3: Object.freeze({ rolling: 8 }),
  4: Object.freeze({ rolling: 6 }),
});

// De familier der doemmes af BAANDET (min+max) i stedet for af det gamle gulv alene.
// De rapporteres roedt/groent i scorecardet og stopper --apply, men de aendrer IKKE dommen
// i det eksisterende CI-scorecard (#4215) - praecis samme afgraensning som §6b's uniforme
// maal og §6's strenge tolerance allerede har i calendarScorecardReport.js.
//
// HVORFOR: ejeren har besluttet baandet 3/9 og skal se tallene FOER apply. Et gulv der
// samtidig vaelter en groen CI-gate ville goere den beslutning til en blokering af alt
// andet arbejde i repoet - og rolling-forsyningen kan kun loeftes ved at genkalibrere
// filler-vaegtene, hvilket er en S5-opgave (CALENDAR_RULES.md §6b).
// MAALT forskel 3/9: prods katalog giver D4 1 rolling-etape (groen mod gulvet 1),
// fixturen `racePoolCatalog.prod.json` giver 0 (roed). Baandet er altsaa paa kanten, og
// dét er selve pointen med at ejeren ser tallet.
export const TERRAIN_BAND_FAMILIES = Object.freeze(["rolling"]);

/**
 * §5/#4270: doem BAAND-familierne (min+max) for sig. Samme violation-format som
 * detectCoverageViolations, men holdt ude af dens dom - se TERRAIN_BAND_FAMILIES.
 */
export function detectTerrainBandViolations({
  tier, stats, families = TERRAIN_BAND_FAMILIES,
  terrainFamilyMin = TIER_TERRAIN_FAMILY_MIN, terrainFamilyMax = TIER_TERRAIN_FAMILY_MAX,
} = {}) {
  const violations = [];
  if (!stats) return violations;
  const min = terrainFamilyMin?.[tier] ?? {};
  const max = terrainFamilyMax?.[tier] ?? {};
  for (const fam of families) {
    const got = stats.familyCounts?.[fam] ?? 0;
    if (min[fam] != null && got < min[fam]) {
      violations.push(`tier ${tier}: terræn-familie "${fam}" har ${got} etaper, under gulvet ${min[fam]} (#4270)`);
    }
    if (max[fam] != null && got > max[fam]) {
      violations.push(`tier ${tier}: terræn-familie "${fam}" har ${got} etaper, over loftet ${max[fam]} (#4270)`);
    }
  }
  return violations;
}

// Minimum antal etapeløb UDEN bjerg-etape (mountain/high_mountain) pr. pulje pr. sæson
// (à la Danmark Rundt — sprint/TT/kuperet, ingen klatre-etape overhovedet). D2 hævet fra
// observeret 1 → 2 (ejer-ask #3327: "ikke alle etapeløb skal have bjerge"). D1 er en
// GT/monument-tung division uden dette mønster i dag (0) — ikke rørt. D3/D4 floor'et til
// nuværende observerede niveau.
export const TIER_MOUNTAIN_FREE_STAGE_RACE_MIN = Object.freeze({ 1: 0, 2: 2, 3: 1, 4: 2 });

// ── #3295: ARKETYPE-RESERVATIONER — dækning der SIKRES, ikke bare måles bagefter ──
//
// Alt ovenfor er FLOORS der verificeres EFTER selection. De kan konstatere at en division
// mangler brosten, men ikke fremskaffe den. Det var nok så længe prestige-rangeringen
// tilfældigvis leverede dækningen; målt på S3 gjorde den ikke: Division 3 fik 0 brosten-
// etapeløb og kun 2 summit_tour, og INGEN mængde nye katalog-løb ændrede det (kvoten er
// fast, så nye løb fortrænger hinanden i stedet for at akkumulere).
//
// Reservationerne løser det ved at tage de påkrævede arketyper FØR prestige-walket
// (selectTierRaceSet → reserveArchetypes). Samme princip som #3327's to-fase-budget for
// endagsløb/etapeløb: styr mixet i valget, ikke i en efterkontrol.
//
// TALLENE er udledt af de bånd de skal opfylde, og derefter MÅLT (ikke gættet):
//   · summit_tour er den eneste arketype med 2x high_mountain-garanti og dermed den
//     primære kilde til summit-finaler (#2755's summit_min) OG til at holde M-Down nede —
//     en bjergetape der slutter opad tæller ikke som "nedkørsels-finale".
//   · cobbled_tour er eneste kilde til brosten-i-etapeløb (#2755's cobbles_min).
//   · itt_classic er eneste kilde til fritstående enkeltstart (#2755's itt_min).
//   · hilly_tour er den mest pålidelige kilde til etapeløb UDEN bjerg (#3327's
//     TIER_MOUNTAIN_FREE_STAGE_RACE_MIN) — den er den eneste stage-arketype uden
//     bjerg-garanti ud over sprinters_week.
//
// En reservation der ikke kan opfyldes (arketypen findes ikke i tierens klasse-vindue)
// rapporteres som `unmetReservations` — den forsvinder aldrig tavst.
//
// #3469 (ejer-fund 8/8, endagsløbs-balance-opfølgning — TO runder): D1/D2/D3's
// cobbled_classic-tilføjelser.
//
// Runde 1: D3's lavere endagsløbs-mål (0,76→0,58, samme dags tidligere beslutning)
// fortrængte cobbled_classic fra D3's almindelige walk — cobbles-terræn-familien
// (#3327, TIER_TERRAIN_FAMILY_MIN[3].cobbles=5) faldt fra 7 til 1 etape. cobbled_tour
// bidrager 1; cobbled_classic:4 lukker resten (1+4=5). Samme "reservér-før-det-
// grådige-walk"-princip som resten af denne tabel — men reservationen ALENE virkede
// ikke: D1's (klasse-ubegrænsede) og D2's almindelige walk havde allerede opbrugt
// stort set al cobbled_classic-forsyning i D3's klasse-vindue (ProSeries/Class1) FØR
// D3's tur, fordi hverken D1 eller D2 selv reserverede arketypen (selectTierRaceSet's
// downstreamProtectedArchetypes-mekanisme beskytter kun tiers der INDIREKTE truer en
// SENERE tiers reservation — den krævede ingen af sine egne, så intet forhindrede
// D1/D2 i frit at tømme D3's delte ProSeries-pulje).
//
// Runde 2 (samme dag, ejer-fund): at gøre selectTierRaceSet's beskyttelse KLASSE-
// BEVIDST (kun ProSeries/Class1 beskyttet for D3, ikke OWTB/OWTC/Monuments) rettede
// D3 — men blotlagde SAMME mønster ét niveau højere: D2's EGET cobbles-gulv
// (TIER_TERRAIN_FAMILY_MIN[2].cobbles=6) viste sig at have hvilet på ProSeries-
// cobbled_classic hele tiden (nu beskyttet væk til D3), OG D1's klasse-ubegrænsede
// walk tog samtidig ALLE 5 OWTB + begge Monuments cobbled_classic — langt over D1's
// eget gulv (3) — og efterlod D2 (hvis whitelist også inkluderer OWTB) med kun
// OWTC(4) tilbage, under dens egne 6. Samme rod-årsag, samme fix: D1 og D2 får nu
// EGNE cobbled_classic-reservationer, dimensioneret til PRÆCIS deres eget gulv minus
// cobbled_tour-bidraget (D1: 3−1=2 · D2: 6−1=5) — det udløser automatisk
// downstreamProtectedArchetypes-beskyttelsen for tiers FØR dem også, uden at kræve en
// ny mekanisme. D4 behøvede ingen tilføjelse — dens gulv (1) var allerede dækket af
// cobbled_tour-garantien alene.
export const TIER_ARCHETYPE_RESERVATIONS = Object.freeze({
  // #4075 (21/8): cobbled_tour 1→0 for tier 1. Kataloget har kun 2 cobbled_tour-løb, og
  // det ENESTE som tier 1-3's whitelists kan nå fælles (Danmark Rundt, ProSeries) blev
  // støvsuget af tier 1's reservation — hvorefter D2's ejer-låste brostens-gulv
  // (TIER_TERRAIN_FAMILY_MIN[2].cobbles=6, ejer-ask 4/8) IKKE kunne nås og apply blev
  // afvist (målt 21/8 mod det rensede katalog: 5 < 6).
  // cobbled_classic 2→4 samtidig: reservations-walket tager prestige-først, så de 2
  // brostens-MONUMENTER opfylder selv en reservation på 2 (målt: D1-cobbles faldt til
  // 2 < gulvets 3). 4 reserverer monumenterne + 2 ægte OWTB-brostens-klassikere;
  // OWTB-supply er 3, så tier 2 beholder mindst 1 + OWTC/ProSeries til sit eget gulv.
  // #4272 (26/8): cobbled_classic 4 → 6 (ejer-ask: "Det er ikke okay, at division 1 kun
  // har 3 brostensetaper"). 6 og ikke mere, fordi brostens-klassikere er ENDAGSLØB og
  // endagsløb er det der skaber afgørelses-dage. Målt pr. reservationstal:
  //   4 → D1 4 brosten (2,6 %) · D3 86 etaper · D3 7 dage uden afgørelse
  //   6 → D1 6 brosten (3,9 %) · D3 84 etaper · D3 7 dage uden afgørelse  ← valgt
  //   7 → D1 7 brosten (4,5 %) · D3 82 etaper · D3 11 dage uden afgørelse
  //   8 → D3 falder under sit ejer-låste brostens-gulv (4 < 5), jf. #4075
  // Den syvende brosten-etape koster altså D3 fire dage hvor noget afgøres. 6 giver D1
  // 50 % flere brosten UDEN den regning, og lader D3 beholde margin på sit gulv (6/5).
  1: Object.freeze({ itt_classic: 1, cobbled_classic: 6 }),
  // summit_tour 1→2 (#3469, 7/8 catalog-upgrade følge-commit): de 2 nye OWTC summit_tour-
  // løb (Vuelta a los Pirineos + Tour des Grandes Alpes, seedet 7/8) gør D2's
  // summit/M-Down-bånd opgraderbare (raceRouteRealismMetrics.js) — men KUN hvis begge
  // rent faktisk vælges hver sæson, ikke kun det ene prestige-walket alligevel ville have
  // taget. Reservationen garanterer det, samme princip som resten af tabellen.
  2: Object.freeze({ summit_tour: 2, cobbled_tour: 1, itt_classic: 1, hilly_tour: 2, cobbled_classic: 5 }),
  3: Object.freeze({ summit_tour: 3, cobbled_tour: 1, itt_classic: 1, hilly_tour: 1, cobbled_classic: 4 }),
  4: Object.freeze({ summit_tour: 2, cobbled_tour: 1, itt_classic: 2, hilly_tour: 2, balanced_week: 2 }),
});

const MOUNTAIN_PROFILE_TYPES = new Set(["mountain", "high_mountain"]);

/**
 * Beregn dækningsstatistik for ÉN puljes færdige udvalg + genererede etape-profiler.
 * Ren funktion — ingen DB/RNG (profiler er allerede genereret af den kaldende part).
 *
 * @param {{ tier, raceRows: Array<{pool_race_id, race_type, stages, race_class}>,
 *   profilesByPoolRaceId: Map<string, Array<{profile_type}>>,
 *   classStageLengthBand?: object }} args
 */
export function computeTierCoverageStats({
  raceRows = [], profilesByPoolRaceId = new Map(), classStageLengthBand = CLASS_STAGE_LENGTH_BAND,
} = {}) {
  const oneDayRows = raceRows.filter((r) => r.race_type !== "stage_race");
  const stageRows = raceRows.filter((r) => r.race_type === "stage_race");
  const totalRaces = raceRows.length;
  const oneDayShare = totalRaces > 0 ? oneDayRows.length / totalRaces : 0;

  const familyCounts = Object.fromEntries(TERRAIN_FAMILIES.map((f) => [f, 0]));
  // Rapport-only ekstra kolonne (samme konvention som #3327's audit-SQL: cobbles + classic
  // vist samlet under "brosten"), IKKE en del af garantien (se docstring ovenfor).
  let classicStages = 0;

  // #4270 (3/9): `classic` taelles nu MED i sin familie (hilly). Den blev foer sprunget over
  // med `continue`, saa den hverken talte mod hilly eller noget andet gulv. classicStages
  // bevares som rapport-kolonne (samme konvention som #3327's audit-SQL), men er ikke
  // laengere det eneste sted etapen dukker op.
  for (const r of raceRows) {
    const profiles = profilesByPoolRaceId.get(r.pool_race_id) || [];
    for (const p of profiles) {
      if (p.profile_type === "classic") classicStages++;
      const fam = TERRAIN_FAMILY_BY_PROFILE_TYPE[p.profile_type];
      if (fam) familyCounts[fam] += 1;
    }
  }

  let mountainFreeStageRaces = 0;
  for (const r of stageRows) {
    const profiles = profilesByPoolRaceId.get(r.pool_race_id) || [];
    if (profiles.length && profiles.every((p) => !MOUNTAIN_PROFILE_TYPES.has(p.profile_type))) {
      mountainFreeStageRaces++;
    }
  }

  const classBandViolations = [];
  if (classStageLengthBand) {
    for (const r of stageRows) {
      const band = classStageLengthBand[r.race_class];
      if (!band) continue;
      const [lo, hi] = band;
      const st = Math.max(1, Number(r.stages) || 1);
      if (st < lo || st > hi) {
        classBandViolations.push(`${r.pool_race_id} (${r.race_class}, ${st} etaper) uden for bånd [${lo}-${hi}]`);
      }
    }
  }

  return {
    totalRaces, oneDayRaces: oneDayRows.length, stageRaces: stageRows.length, oneDayShare,
    familyCounts, classicStages, mountainFreeStageRaces, classBandViolations,
  };
}

/**
 * Sammenlign dækningsstatistik mod tierens garantier — returnér violation-strings
 * (samme mønster som detectCalendarViolations i tierCalendarMaterializer.js).
 */
export function detectCoverageViolations({
  tier, stats,
  oneDayShareMin = TIER_ONE_DAY_SHARE_MIN,
  terrainFamilyMin = TIER_TERRAIN_FAMILY_MIN,
  bandFamilies = TERRAIN_BAND_FAMILIES,
  mountainFreeMin = TIER_MOUNTAIN_FREE_STAGE_RACE_MIN,
} = {}) {
  const violations = [];
  if (!stats) return violations;

  const shareMin = oneDayShareMin?.[tier];
  if (shareMin != null && stats.oneDayShare < shareMin) {
    violations.push(`tier ${tier}: endagsløb-andel ${(stats.oneDayShare * 100).toFixed(1)}% under garanteret minimum ${(shareMin * 100).toFixed(1)}% (#3327)`);
  }

  // #4270: BAAND-familierne (rolling) doemmes af detectTerrainBandViolations, ikke her.
  // Se TERRAIN_BAND_FAMILIES for hvorfor de er holdt ude af denne dom.
  const familyMin = terrainFamilyMin?.[tier];
  if (familyMin) {
    for (const fam of TERRAIN_FAMILIES) {
      if (bandFamilies?.includes(fam)) continue;
      const min = familyMin[fam];
      if (min == null) continue;
      const got = stats.familyCounts[fam] ?? 0;
      if (got < min) {
        violations.push(`tier ${tier}: terræn-familie "${fam}" har ${got} etaper, under garanteret minimum ${min} (#3327)`);
      }
    }
  }

  const mfMin = mountainFreeMin?.[tier];
  if (mfMin != null && stats.mountainFreeStageRaces < mfMin) {
    violations.push(`tier ${tier}: kun ${stats.mountainFreeStageRaces} etapeløb uden bjerg-etape, under garanteret minimum ${mfMin} (#3327)`);
  }

  if (stats.classBandViolations?.length) {
    for (const v of stats.classBandViolations) violations.push(`tier ${tier}: klasse↔længde-bånd brudt — ${v} (#3328)`);
  }

  return violations;
}
