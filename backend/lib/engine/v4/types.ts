// backend/lib/engine/v4/types.ts
// Race Engine v4 F2 (#4030, #3855): ALLE kontrakter for motor-kernen.
// SSOT: docs/superpowers/specs/2026-08-21-race-engine-v4-f2-core-design.md §2-3.
// Mor-spec: docs/superpowers/specs/2026-08-20-race-engine-v4-intra-stage-design.md §3.2-3.5.
//
// FROSSET FØRST: dette modul aendres kun af arkitekten. Fase B-workers bygger
// mekanik-implementeringer imod de eksporterede hook-typer nederst i filen.
//
// RENHED: type-only fil (100% erasable) — ingen imports fra oevrigt backend,
// ingen runtime-kode overhovedet. abilityRegistry/raceRoles/routeSegments'
// RUNTIME-vaerdier er bevidst IKKE importeret her (ville braekke renheds-graensen);
// de tilsvarende litteral-unions er kopieret 1:1 nedenfor og skal holdes i sync
// manuelt hvis kilderne aendrer sig (samme "duplikering er etableret moenster"-
// begrundelse som stableSeed/mulberry32 i rng.ts).

// ── Evner (kopi af abilityRegistry.js REGISTRY_ABILITY_KEYS, 15 noegler) ──────
export type AbilityKey =
  | "climbing"
  | "time_trial"
  | "flat"
  | "tempo"
  | "sprint"
  | "acceleration"
  | "punch"
  | "endurance"
  | "recovery"
  | "durability"
  | "descending"
  | "cobblestone"
  | "positioning"
  | "aggression"
  | "tactics";

// ── Rytterrolle (kopi af raceRoles.js VALID_RACE_ROLES) ───────────────────────
export type RiderRole = "captain" | "sprint_captain" | "helper" | "hunter" | "free_role";

// M12 (effort-styring, ejer-valg 20/8 §4). WIRET 6/9 (#4632, model C):
// segmentLoop.ts's `tickGroupRiders` ganger mechanics/effortCost.ts's
// `effortDemandMultiplier(effort)` paa rytterens KRAFTKRAV (ikke paa CP'en),
// og mechanics/breakaway.ts udelukker 'grupetto' fra udbruds-kandidaterne.
// Feltet er dermed ikke laengere baaret-men-ubrugt.
//
// #4632 (loebsdagens intention, ejer 5-6/9): udvidet fra tre til FEM trin —
// samme enum som v3's raceRoles.js VALID_EFFORTS_FIVE_STEP og DB-constraint'en
// paa race_stage_roles.effort, 1:1. De tre oprindelige vaerdier beholder navn OG
// semantik; 'grupetto' og 'all_out' er de nye yderpunkter, saa M12 arver
// skalaen i stedet for at genopfinde den.
// SSOT: docs/superpowers/specs/2026-09-03-race-day-intention-decision.md §4/§6.
export type EffortLevel = "grupetto" | "save" | "normal" | "protect" | "all_out";

// ── Rute-model v2 (F1, deles med kalenderen) ──────────────────────────────────
// Segment-felterne matcher backend/lib/routeSegments.js's buildSegments()-output
// 1:1 (kind-diskriminerede felter) — v4-kernen laeser F1's segmentliste raat.

export type ClimbCategory = "HC" | "1" | "2" | "3" | "4";

export type FlatSegment = { kind: "flat"; from_km: number; to_km: number };
export type RollingSegment = { kind: "rolling"; from_km: number; to_km: number };

export type ClimbSegment = {
  kind: "climb";
  from_km: number;
  to_km: number;
  category: ClimbCategory;
  avg_gradient: number;
  top_elevation_m: number;
};

export type DescentSegment = {
  kind: "descent";
  from_km: number;
  to_km: number;
  technicality: 1 | 2 | 3;
};

export type CobblesSegment = {
  kind: "cobbles";
  from_km: number;
  to_km: number;
  sector_name: string;
  stars: 1 | 2 | 3 | 4 | 5;
};

export type Segment = FlatSegment | RollingSegment | ClimbSegment | DescentSegment | CobblesSegment;
export type SegmentKind = Segment["kind"];

// Vejr-fordeling v1 (routeSegments.js WEATHER_WEIGHTS): sun/overcast/rain/wind.
export type WeatherKind = "sun" | "overcast" | "rain" | "wind";
export type Weather = { kind: WeatherKind; wind_exposure: number };

// Waypoint-kontrakt uaendret fra racePassages.js (#2410 §2.2).
export type Waypoint = {
  kind: "kom" | "sprint" | "finish";
  index: number;
  name: string;
  km: number;
  category?: ClimbCategory;
  summit_finish?: boolean;
};

// Profil-typer (raceStageProfileGenerator.js FINALE_WEIGHTS_BY_PROFILE-noegler).
export type ProfileType =
  | "flat"
  | "rolling"
  | "hilly"
  | "mountain"
  | "high_mountain"
  | "cobbles"
  // gravel (#4105): additiv udvidelse af profil-UNIONEN, ikke af StageInput/StageOutput's
  // form. Segment-modellen er UAENDRET: en grus-sektor bliver et "cobbles"-segment, fordi
  // fysikken er den samme (loest/ujaevnt underlag, lav laesgevinst, hoej styrt-risiko) og
  // ejer-rammen 3/9 er "naesten samme type der er god til den slags loeb". Forskellen
  // mellem grus og brosten bor i etapens profile_type + demand_vector, ikke i segmentet.
  | "gravel"
  | "classic"
  | "itt"
  | "itt_hilly"
  | "ttt";

// Finale-typer (raceStageProfileGenerator.js FINALE_WEIGHTS_BY_PROFILE-vaerdier).
export type FinaleType =
  | "bunch_sprint"
  | "reduced_sprint"
  | "punch"
  | "breakaway"
  | "descent"
  | "long_climb"
  | "solo_tt";

export type RouteV2 = {
  distance_km: number;
  profile_type: ProfileType;
  finale_type: FinaleType | null;
  segments: Segment[];
  weather: Weather;
  waypoints: Waypoint[];
};

// ── Kerne-kontrakten (§2, frossen) ────────────────────────────────────────────

export type Entrant = {
  rider_id: string;
  abilities: Record<AbilityKey, number>; // 0-99, abilityRegistry-skala
  role: RiderRole;
  effort: EffortLevel;
  condition: number; // 0-1, dag-til-dag-slid (M7 forbruger i F3; F2 baerer feltet)
  // M16 holdspil (#4246, ADDITIVT og VALGFRIT). Auditten 5/9: "Holdspillet
  // findes ikke i v4 ... kraever et hold-id paa rytteren, som den frosne
  // kontrakt ikke har. Ved et flip forsvinder baade hjaelperens pris og
  // kaptajnens fordel" (mod v3's buildTeamContext, raceSimulator.js:295-320).
  //
  // VALGFRIT, ikke paakraevet: de fire golden fixtures og enhver haandbygget
  // testliste er skrevet UDEN feltet, og et hold-id er per konstruktion det
  // eneste der kan taende holdspillet (mechanics/teamPlay.ts kraever et
  // ikke-tomt team_id paa BAADE leder og hjaelper). En startliste uden feltet
  // koerer derfor praecis som foer — "bygget" og "koblet ind" kan skilles ad
  // uden at regenerere en eneste fixture.
  //
  // ROLLE er IKKE hold: `role` siger hvad rytteren skal i dag, `team_id` hvem
  // han koerer for. v3 kraever begge (buildTeamContext springer enhver
  // entrant uden team_id ELLER race_role over), og v4 goer det samme.
  team_id?: string | null;
};

// M5 (udbruds-ordrer)/M6 (leadout)/M14 (AI-taktik). Formen er en AABEN
// konvolut (`kind` + `params`), ikke en lukket kontrakt: hver mekanik
// fortolker sin egen `kind` og ignorerer resten (`mechanics/breakaway.ts`'s
// `parseBreakawayOrders` for "team_tactics", `mechanics/leadout.ts`'s
// `parseLeadoutOrders` for "leadout").
//
// BEVIDST IKKE FROSSET TIL T3-FORMEN (#4615): tactics-orders-specens
// `{team_id, breakaway_stance, riders[]}` er den form spilleren og AI'en
// producerer — `orders/teamOrdersAdapter.ts` og `ai/teamOrderContract.ts`
// baerer den. Men rolle-vs-ordre-modsigelsen (#4246: `hunter` vs `try_break`,
// `sprint_captain` vs `leadout_for`) er ejer-gated og IKKE afgjort her. At
// fryse konvolutten om til T3 nu ville laase netop den beslutning ind i en
// frossen kontrakt. Konvolutten baerer derfor begge vokabularer side om side
// indtil #4246 er afgjort; naar den er det, kollapser wrapperne til identitet.
export type TeamOrder = {
  team_id: string;
  kind: string;
  params?: Record<string, unknown>;
};

export type StageInput = {
  route: RouteV2;
  startlist: Entrant[];
  orders: TeamOrder[];
  seed: string; // etape-seed (commit-reveal-moenstret, jf. raceSimulator.stableSeed)
  tuning: EngineTuning;
};

// #2410-taksonomien er AABEN for tilfoejelser (forward-kompatibel: ukendte typer
// ignoreres tavst af aftagere) — derfor er `type` en kendt-litteral-union UNIONET
// med `string`, ikke en lukket union. `(string & {})` bevarer autocomplete for de
// kendte vaerdier uden at forbyde nye.
export type KnownTimelineEventType =
  | "stage_start"
  | "breakaway_formed"
  | "gap_update"
  | "kom_passage"
  | "intermediate_sprint"
  | "breakaway_caught"
  | "breakaway_survived"
  | "peloton_splits"
  // #4971 (ADDITIV): kvittering for at en gruppe blev opslugt af en anden i
  // segmentLoop's merge-trin. Uden den kunne tidslinjens sidste udsagn om en
  // rytter pege paa et gruppe-id der aldrig naaede at optraede i et snapshot.
  | "group_merged"
  | "incident"
  | "favorite_crack"
  | "finale_attack"
  | "sprint_decided"
  | "finish"
  | "gc_change";

export type TimelineEvent = {
  km: number; // [0, distance_km], 2 decimaler
  type: KnownTimelineEventType | (string & {});
  params: Record<string, unknown>; // fog-gate (#1791): INGEN rå komponenter/vaegte/sandsynligheder
};

// ── Udfaldsklasser (ADDITIV udvidelse, #2582 — ejer-beslutning 6/9) ──────────
// "otl" (outside time limit) er en TREDJE udfaldsklasse ved siden af
// finished/abandoned, ikke en variant af nogen af dem: rytteren KOM i maal
// (i modsaetning til abandoned) men uden for tidsgraensen, saa han er ude af
// loebet alligevel. Klassement og flip-mapping skal kunne skelne de tre.
// Mekanikken bor i mechanics/timeLimit.ts (M15); reglen i klartekst staar i
// docs/RACE_ENGINE_RULES.md §2d.
//
// FLIP-KONTRAKT (til `feat/v4-flip-infrastructure` — fuld udgave med fil- og
// linjehenvisninger staar nederst i mechanics/timeLimit.ts):
//   1. `race_results` har INGEN status-kolonne. En OTL-rytter faar derfor
//      INGEN `result_type:'stage'`-raekke for etapen — hverken tid eller rank —
//      praecis som v3 haandterer en DNF (database/2026-07-12-race-v3-s4-
//      incidents.sql:13-16). Skriv ikke en halvtom raekke.
//   2. Markeringen skrives i `race_incidents` som `kind='time_limit'` med
//      `injury_days = null` (en tidsgraense er ikke en skade, jf.
//      RACE_ENGINE_RULES.md §2c). Kraever én idempotent migration der udvider
//      `race_incidents_kind_check`.
//   3. Etapeloeb: `outcome='abandon'` genbruges, saa `loadAbandonedRiderIds`
//      (backend/lib/raceIncidents.js:144) filtrerer rytteren ud af naeste
//      etapes startliste. Vaelges i stedet et nyt `outcome='otl'`, SKAL den
//      loader udvides — ellers starter han igen. FAELDE: kaldet i
//      raceRunner.js:2448 er gated paa `if (v3)`, saa den gren skal ogsaa
//      daekke v4, ellers stiller BAADE udgaaede og OTL-ryttere til start.
//   4. Klassementet: den manglende etaperaekke fjerner ham automatisk fra ALLE
//      klassementer via `raceClassifications.filterCompletedEntrants`
//      (backend/lib/raceClassifications.js:144). Ingen ny kolonne.
//   5. Endagsloeb: ingen naeste etape, intet klassement — konsekvensen er
//      punkt 1+2 alene, dvs. DNF.
export type StageResultStatus = "finished" | "abandoned" | "otl";

export type StageResult = {
  rider_id: string;
  rank: number;
  time_seconds: number;
  group_id: string;
  status: StageResultStatus;
  // #2944 (ADDITIVT, valgfrit — v4's incident-trappe). Skadedage fra et STYRT
  // paa denne etape. `null`/udeladt = ingen skade. Kun styrt kan saette feltet
  // (#4520, samme regel som v3's raceIncidents.rollIncidents): et mekanisk
  // uheld er ALDRIG skade. Feltet er VALGFRIT, saa flip-infrastrukturens
  // mapping (v4 -> race_incidents/rider_condition) kan tages i to skridt uden
  // at braekke paa en manglende noegle.
  injury_days?: number | null;
};

// ── #2944 incident-trappen (mechanics/incidents.ts) ──────────────────────────
// Ejer-beslutning 6/9 (LAAST): fire udfald, og KUN et styrt kan skade/udgaa.
//   let styrt       -> tidstab, koerer videre
//   haardt styrt    -> stort tidstab + skade i dage
//   alvorligt styrt -> udgaar (abandoned) + skadedage, SJAELDENT
//   mekanisk uheld  -> ALTID kun tidstab (aldrig abandoned, aldrig skade);
//                      en hjaelper taet paa giver hurtigere hjulskift
export type IncidentKind = "crash" | "mechanical";
export type IncidentSeverity = "light" | "hard" | "serious";
export type IncidentOutcome = "time_loss" | "protected_three_km_rule" | "abandoned";

/**
 * Én uheldshaendelse paa én etape. `severity` er `null` for mekaniske uheld
 * (arten har ingen alvorsakse — den kan pr. konstruktion kun koste tid).
 * `injury_days` er `null` for alt andet end hard/serious styrt.
 */
export type StageIncident = {
  rider_id: string;
  km: number;
  kind: IncidentKind;
  severity: IncidentSeverity | null;
  outcome: IncidentOutcome;
  time_loss_seconds: number | null;
  injury_days: number | null;
  helper_assist: boolean; // sand KUN for mekanisk uheld med hjaelper i samme gruppe
};

// Beslutning 18 (loebsdags-kontrakten, #3459) — traenings-/udviklingssystemet
// forbruger disse felter senere; kontrakten laases nu.
export type RiderLoad = {
  rider_id: string;
  wprime_depleted_j_norm: number; // samlet W'-taering, normaliseret
  seconds_over_cp: number;
  work_norm: number;
};

// Beslutning 20 (kompakte per-segment gruppe-snapshots).
export type GroupKind = "breakaway" | "peloton" | "chase" | "gruppetto" | "solo";

export type GroupSnapshotEntry = {
  group_id: string;
  kind: GroupKind;
  rider_ids: string[];
  gap_seconds: number; // til front
};

export type SegmentGroupSnapshot = {
  km: number; // segment-graense
  groups: GroupSnapshotEntry[];
};

// ── #2770/#2413 M9: passager (bjerg, indlagt spurt, maal) ────────────────────
// Ejer-beslutning 6/9 (LAAST): naar v4 koerer etapen er MOTORENS EGEN mekanik
// den eneste kilde til spurt-/bjergpoint og bonussekunder. Laget uden for
// motoren (backend/lib/racePassages.js) gates AF pr. motor, saa ingen rytter
// kan faa point to gange.
//
// Formen er BEVIDST identisk med racePassages.computePassages' output
// (kind/index/name/km/category + results[] med passage_rank/points/
// bonus_seconds): broen kan dermed levere v4's passager direkte til den
// UAENDREDE race_stage_passages/race_results-pipeline uden et
// oversaettelseslag der kan drive fra hinanden.
export type PassageKind = "kom" | "sprint" | "finish";

export type PassageResult = {
  rider_id: string;
  passage_rank: number; // 1-baseret placering ved DENNE passage
  points: number; // spurt-/bjergpoint (offentlig spilinformation, jf. §4)
  bonus_seconds: number; // GC-bonus; 0 naar passagen ikke giver bonus
};

export type StagePassage = {
  kind: PassageKind;
  index: number; // waypointets index inden for sin egen art (racePassages-konvention)
  name: string;
  km: number;
  category: ClimbCategory | null; // kun kom-passager
  results: PassageResult[];
};

/** Etapens samlede udbytte pr. rytter — spejler racePassages' `perRider`-map. */
export type RiderPassageTotals = {
  rider_id: string;
  sprint_points: number;
  kom_points: number;
  bonus_seconds: number;
};

export type StageOutput = {
  timeline: { timeline_version: 2; events: TimelineEvent[] };
  results: StageResult[];
  loads: RiderLoad[];
  groupSnapshots: SegmentGroupSnapshot[];
  // #2944 (ADDITIVT, valgfrit): den fulde uheldsprotokol for etapen, sorteret
  // paa (km, rider_id). `StageResult.injury_days` er en bekvemmeligheds-spejling
  // af den ENE noegle flip-mappingen skal bruge pr. rytter; DENNE liste baerer
  // art/alvor/udfald, dvs. praecis de kolonner v3's `race_incidents` har.
  incidents?: StageIncident[];
  // #2770/#2413 (ADDITIVT, valgfrit): etapens passager i km-orden, og det
  // samlede udbytte pr. rytter (sorteret paa rider_id). `passage_totals` er en
  // ren aggregering af `passages` — den findes fordi flip-laget skriver
  // PR. RYTTER (race_results.sprint_points/kom_points/bonus_seconds) mens
  // race_stage_passages skriver pr. passage.
  passages?: StagePassage[];
  passage_totals?: RiderPassageTotals[];
};

// ── EngineTuning (§4-5, default+konstanter i tuning.ts) ───────────────────────

// CP/W'-model (§5). Alle vaerdier normaliserede (0-1) — fog-gate: ingen fysiske watt.
export type PhysiologyTuning = {
  cpWeights: { tempo: number; endurance: number; climbSpec: number; tt: number };
  wprimeWeights: { punch: number; accel: number; sprint: number };
  rechargeRateBase: number; // basis-genopladningsrate pr. sekund under CP
  recoveryFloorFraction: number; // min. genopladnings-multiplikator ved recovery=0 (0.5 i §5-formlen)
};

export type DayformTuning = {
  sd: number; // gaussian sd, dagsform-komponent (symmetrisk om 0)
  jourSansPBase: number; // p(jour sans) ved neutral form
  jourSansFormLow: number; // form-graense (0-100) hvor jour-sans-p er hoejest
  jourSansFormHigh: number; // form-graense (0-100) hvor jour-sans-p er lavest
  jourSansPMultLowform: number; // multiplikator pa base ved form <= formLow
  jourSansPMultHighform: number; // multiplikator pa base ved form >= formHigh
  jourSansMagnitudeMin: number; // mindste kollaps-magnitude (normaliseret)
  jourSansMagnitudeMax: number; // stoerste kollaps-magnitude (normaliseret)
};

// Work-cost pr. position i gruppen (§4 punkt 1) — frontWorkFactor > draftFactor,
// flad/rolling har hoej laesrabat (lav draftFactor), climb lav rabat, descent midt.
export type WorkCostTuning = {
  frontWorkFactor: Record<SegmentKind, number>;
  draftFactor: Record<SegmentKind, number>;
  frontFraction: number; // andel af gruppen (stærkeste cp foerst) der regnes for "front" og betaler frontWorkFactor
};

// Segment-tempo (§4 punkt 1, "krav-tempo... afledes af segment-kind + stærkeste
// motorer i gruppen (kollektiv CP)"). Intern til segmentLoop.ts's hastigheds-/
// varighedsberegning — fog-gaten (#1791) gaelder KUN events[].params, ikke disse
// interne konstanter, saa km/t-tal her laekker aldrig til spilleren.
export type TerrainTuning = {
  baseDemand: Record<SegmentKind, number>; // normaliseret CP-demand en gruppe typisk holder paa dette terraen
  baseSpeedKmh: Record<SegmentKind, number>; // intern illustrativ basishastighed pr. terraen-type
  strengthSpeedGain: number; // hvor meget kollektiv gruppe-CP over/under baseDemand skalerer hastigheden
  speedMultiplierBounds: readonly [number, number]; // clamp paa hastigheds-multiplikatoren
};

export type GroupTuning = {
  mergeThresholdSeconds: number; // gap under hvilket grupper smelter sammen
  gapUpdateThresholdSeconds: number; // min. gap-delta foer et gap_update-event emitteres
};

// M2 (§4 punkt 3, klatre-selektion) + monotoni-implementeringen (§2 invariant 3).
export type SelectionTuning = {
  deficitWeight: number; // vaegt paa testet-evne-underskud i selektions-scoren
  energyDeficitWeight: number; // vaegt paa W'-underskud i selektions-scoren
  noiseSdBase: number; // stoej ~ N(0, sd * |deficit|) — skalerer magnitude, aldrig fortegn
  splitThreshold: number; // selektions-score-taerskel der udloeser et peloton_splits-event
};

// M3 (§4 punkt 3 / mor-spec §4 M3): descent attack-loft 10-20 s, T2-T3, risiko-koblet.
export type DescentTuning = {
  attackWindowSeconds: readonly [number, number]; // clamp [10, 20]
  minTechnicalityForAttack: 1 | 2 | 3; // T2-T3 (technicality >= denne)
  minAbilityGapForAttack: number; // stor descending-evne-forskel, 0-99-skala
  incidentRiskBase: number; // seedet styrt-risiko, let forhoejet ved angreb
  incidentRiskDescendingDampening: number; // daempning pr. descending-evne-enhed
};

// M4 (punch-finale, §4 punkt 4-slutning).
export type FinaleTuning = {
  demandVectorByFinaleType: Partial<Record<FinaleType, Partial<Record<AbilityKey, number>>>>;
};

// M9 (bonussekunder) — baeres i tuning fra F2 selvom mekanikken selv er F3-scope,
// saa taerskelbaandet er ét sted (#2413-kravet: bounded, bjerg dominerer stadig GC).
export type BonusSecondsTuning = {
  finishSeconds: readonly [number, number, number]; // 10/6/4
  intermediateSeconds: readonly [number, number, number]; // 3/2/1
};

export type EngineTuning = {
  physiology: PhysiologyTuning;
  dayform: DayformTuning;
  work: WorkCostTuning;
  terrain: TerrainTuning;
  groups: GroupTuning;
  selection: SelectionTuning;
  descent: DescentTuning;
  finale: FinaleTuning;
  bonusSeconds: BonusSecondsTuning;
};

// ── RNG-kontrakt (rng.ts implementerer; typerne bor her saa alle moduler,
// inkl. mekanik-hooks, kan type-referere uden at importere rng.ts's runtime) ──

export type RngFn = () => number; // uniform [0, 1)
export type RngForFn = (mechanic: string, riderId?: string) => RngFn;

// ── Intern simulations-tilstand (mor-spec §3.2) ───────────────────────────────

export type RiderStatus = "racing" | "finished" | "abandoned";

export type RaceGroup = {
  id: string;
  kind: GroupKind;
  rider_ids: string[];
  gap_seconds: number; // til front (foerende gruppe / etapens spids)
  cohesion: number; // 0-1, fundament for brosten-kaos-hook (fuld M8 i F3)
};

export type RiderState = {
  rider_id: string;
  group_id: string;
  cp: number; // afledt kritisk-effekt-taerskel, normaliseret (physiology.ts)
  wprimeMax: number; // afledt anaerob reserve-kapacitet, normaliseret
  wprime: number; // aktuel anaerob reserve, 0..wprimeMax
  dayform: number; // signeret dagsform-modifikator (physiology.ts, ±)
  seconds_over_cp: number; // kumuleret tid over CP (RiderLoad-output)
  work_norm: number; // kumuleret normaliseret arbejde (RiderLoad-output)
  incidents: number; // antal incident-events denne rytter har vaeret part i
  status: RiderStatus;
  time_seconds: number; // kumuleret loebstid ved seneste segment-graense
  // M16 holdspil (#4246, ADDITIVT og VALGFRIT). Multiplikator paa rytterens
  // CP, akkumuleret af mechanics/teamPlay.ts henover segment-loopet:
  // < 1 = han har arbejdet for holdet, > 1 = han er blevet baaret af det.
  // `undefined` (og enhver startliste uden hold-id) betyder 1 = ingen effekt,
  // saa feltets blotte eksistens aendrer intet.
  //
  // HVORFOR CP OG IKKE W': W' genoplades hvert segment, og i et felt hvor
  // ingen ligger over CP (motorens normaltilstand siden #4604's relative
  // krav-tempo) er en W'-delta VISKET UD foer naeste segment overhovedet
  // laeser den. CP er den vedvarende akse — den styrer baade gruppens tempo
  // (segmentLoop.computeGroupTempo) og klatre-selektionen (M2's
  // testedDeficit), altsaa netop de to steder v3's holdspil ogsaa slaar
  // igennem. Maalt 6/9 ved wiringen: med W'-kanalen var udfaldet BIT-IDENTISK
  // med og uden hold.
  //
  // HVORFOR IKKE `dayform`: den er "dagsform" og rapporteres som saadan i
  // fortaellingen. At laane den til holdarbejde ville goere begge tal loegn.
  team_cp_factor?: number;
};

export type EngineState = {
  km: number; // cursor, km allerede tilbagelagt
  groups: RaceGroup[];
  riders: Record<string, RiderState>;
  virtual_gc: Record<string, number>; // rider_id -> virtuel GC-deficit sekunder (F2: alle 0)
  // Placerings-raekkefolge i maal, saettes af finale-hooket (#4615). INTERN
  // simulations-tilstand — IKKE en del af §2's frosne StageOutput.
  //
  // HVORFOR (felt-sammenhaengs-ankeret, #4604/#4615): et massespurt-opgoer skal
  // give HELE den ankomne gruppe SAMME tid (gruppe-tids-princippet, mor-spec
  // §3.2) og samtidig en entydig placerings-raekkefolge. Uden dette felt kunne
  // raekkefolgen kun udtrykkes gennem tiden, saa finalen var noedt til at give
  // hver rytter sit eget tids-tier — hvilket satte felt-sammenhaengen paa flade
  // etaper til naesten nul. `index.ts` rangerer paa (tid, denne raekkefolge,
  // rider_id), saa lige tid stadig giver stabile, evne-ordnede placeringer.
  finish_order?: string[];
  // #2944: etapens uheldsprotokol, akkumuleret af `mechanics/incidents.ts`
  // henover segment-loopet. INTERN simulations-tilstand — den kopieres til
  // `StageOutput.incidents` af index.ts.
  //
  // HVORFOR STATE og ikke bare events: M10 skal haandhaeve v3's HAARDE LOFT
  // over antal uheld PR. ETAPE (raceIncidents.rollIncidents' INCIDENT_MAX_
  // FIELD_SHARE). Hooket kaldes pr. SEGMENT og kan derfor ikke se sine egne
  // tidligere kald uden en baerer. `RiderState.incidents`-taelleren duer ikke
  // som kilde: descent.ts og cobbles.ts hæver den ogsaa (deres egne, rene
  // informations-incidents), saa et loft afledt af den ville blive spist af
  // en anden mekanik.
  stage_incidents?: StageIncident[];
  // #2770/#2413 (M9): etapens passager, akkumuleret af `mechanics/
  // bonusSeconds.ts` henover segment-loopet. INTERN simulations-tilstand —
  // index.ts tilfoejer maal-passagen til slut, klemmer bonussekunderne under
  // per-rytter-loftet og kopierer listen til `StageOutput.passages`.
  //
  // HVORFOR STATE og ikke bare events: loftet (#2413, "GC-effekten er bounded")
  // gaelder rytterens SAMLEDE bonus over hele etapen — maal + alle indlagte
  // spurter. Hooket kaldes pr. segment og kan ikke se hverken sine egne
  // tidligere kald eller maalstregen uden en baerer.
  stage_passages?: StagePassage[];
};

// ── Mekanik-hooks (§8 byggeplan: Fase B plugger disse ind) ────────────────────
//
// Kontrakt: REN funktion, (state, ctx) -> nyt state + events (ingen mutation af
// input-state — determinisme-testene i index.test.ts og rng.test.ts forudsaetter
// dette; #4479: her stod en segmentLoop-testfil der ikke findes).
// F2 leverer default-implementeringer (climbSelection.ts/descent.ts/finale.ts's
// no-op-varianter) der ingenting goer: returnerer samme state, ingen events.

export type SegmentHookContext = {
  segment: Segment;
  segmentIndex: number;
  route: RouteV2;
  entrants: Readonly<Record<string, Entrant>>;
  tuning: EngineTuning;
  // Bundet til etapens seed OG til DETTE segment (#4886) — kald med
  // (mechanic, riderId?). segmentLoop pakker etapens stream ind i
  // `rng.ts`'s segmentRngFor før hvert hook-kald, så en mekanik der kaldes pr.
  // segment automatisk ruller nyt på hvert segment. En mekanik må derfor
  // ALDRIG selv lægge segment-indekset i mekanik-strengen: det ville dobbelt-
  // nøgle streamen (`incident:s3:s3`) uden at tilføje noget.
  rngFor: RngForFn;
  // Etape-stabil stream — IKKE segment-nøglet. Kun for mekanikker hvis
  // lodtrækning hører til et vejpunkt eller til målstregen og derfor ikke må
  // skifte hvis rutens segmentinddeling ændres (mechanics/bonusSeconds.ts's
  // passager, finale.ts's placerings-jitter). Bruges den til noget der kaldes
  // pr. segment, er #4886 tilbage — begrund altid valget på kaldstedet.
  rngForStage: RngForFn;
  // StageInput.orders raat videregivet (#4615). Hver mekanik parser sin egen
  // `kind` og ignorerer resten; en tom liste er den neutrale default (T4 i
  // tactics-orders-specen — kernen kraever ALDRIG ordrer).
  orders: readonly TeamOrder[];
};

export type SegmentHookResult = {
  state: EngineState;
  events: TimelineEvent[];
};

// M2: klatre-selektion. Kaldes paa climb-segmenter.
export type ClimbSelectionHook = (state: EngineState, ctx: SegmentHookContext) => SegmentHookResult;

// M3: nedkoersel v2 (monotoni-garanti + descent attack + risiko-koblet incident).
// Kaldes paa descent-segmenter.
export type DescentHook = (state: EngineState, ctx: SegmentHookContext) => SegmentHookResult;

// M4: punch-finale placerings-opgoer. Kaldes paa etapens sidste segment.
export type FinaleHook = (state: EngineState, ctx: SegmentHookContext) => SegmentHookResult;

// M5: udbrud v2 + holdordrer. Kaldes paa HVERT segment (ikke kind-gated):
// formation forsoeges paa foerste segment, jagt-fremdrift paa de oevrige.
export type BreakawayHook = (state: EngineState, ctx: SegmentHookContext) => SegmentHookResult;

// M10: incidents-trappen (#2944). Kaldes paa HVERT segment (ikke kind-gated) —
// et uheld er ambient og hoerer ikke til én terraen-type.
export type IncidentHook = (state: EngineState, ctx: SegmentHookContext) => SegmentHookResult;

// M8: brosten-/grus-sektorer. Kaldes paa cobbles-segmenter (grus-sektorer ER
// cobbles-segmenter, jf. CobblesSegment-kommentaren og RACE_ENGINE_RULES §2b:
// underlaget bor i profile_type, fysikken i segmentet).
export type CobblesHook = (state: EngineState, ctx: SegmentHookContext) => SegmentHookResult;

// M16: holdspil (#4246, ejer-scope: v3-paritet). Kaldes paa HVERT segment
// (ikke kind-gated) — holdarbejde er ambient, praecis som M10's uheld: en
// hjaelper traekker for sin kaptajn paa flad vej saavel som op ad bakke.
//
// M16 er et NYT nummer, ikke en post kataloget i RACE_ENGINE_RULES §2 allerede
// havde. Kataloget blev lukket 20/8 med M1-M14 og indeholder ingen holdspils-
// mekanik; ejer-beslutning 1 (5/9, §9) goer alligevel holdspillet til
// flip-minimum ("alt spillerne har i v3 i dag koblet ind i v4 ... holdspil med
// hold-id paa rytteren"). Nummeret er altsaa en ejer-besluttet scope-udvidelse
// paa praecis samme grundlag som M15 (tidsgraensen), ikke en PR-tilfoejelse.
export type TeamPlayHook = (state: EngineState, ctx: SegmentHookContext) => SegmentHookResult;

// M9: passager (bjergtoppe + indlagte spurter). Kaldes paa HVERT segment (ikke
// kind-gated): et sprint- eller kom-vejpunkt kan ligge paa et hvilket som helst
// terraen. Maal-passagen hoerer ikke til her — den kraever den endelige
// placeringsraekkefolge og bygges derfor af index.ts efter finalen.
export type PassagesHook = (state: EngineState, ctx: SegmentHookContext) => SegmentHookResult;

export type MechanicHooks = {
  climbSelection: ClimbSelectionHook;
  descent: DescentHook;
  finale: FinaleHook;
  breakaway: BreakawayHook;
  // VALGFRIT (#2944): et hook-saet uden `incidents` er stadig gyldigt og koerer
  // etapen helt uden uheld. Bevidst optional saa eksisterende konstruktioner af
  // MechanicHooks (tests, harness, adaptere) ikke braekker paa en ny paakraevet
  // noegle — segmentLoop.ts kalder den med `?.`-guard.
  incidents?: IncidentHook;
  // VALGFRI (#3855 M8-wiring): et hook-loest testkald skal stadig kunne bygge et
  // MechanicHooks-objekt uden at kende hver ny F3-mekanik. segmentLoop.ts falder
  // tilbage til sin egen no-op naar feltet mangler; index.ts's LIVE_MECHANIC_HOOKS
  // saetter det, og index.test.ts laaser at den gør det ("bygget" vs "koblet ind").
  cobbles?: CobblesHook;
  // VALGFRI (#4246 M16-wiring), samme begrundelse som `cobbles` ovenfor:
  // et hook-saet uden `teamPlay` koerer etapen helt uden holdspil (F2-adfaerd,
  // uaendret). segmentLoop.ts falder tilbage til sin egen no-op naar feltet
  // mangler; index.ts's LIVE_MECHANIC_HOOKS saetter det, og index.test.ts
  // laaser at den gør det.
  teamPlay?: TeamPlayHook;
  // VALGFRI (#2770/#2413 M9-wiring): samme mønster som `cobbles` ovenfor —
  // segmentLoop.ts falder tilbage til sin egen no-op naar feltet mangler.
  passages?: PassagesHook;
};
