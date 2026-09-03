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

// M12 (effort-styring, ejer-valg 20/8 §4). F2 behandler alle ryttere som 'normal'
// (segmentLoop.ts laeser feltet men mekanik-effekten er F3/M12-scope).
export type EffortLevel = "protect" | "normal" | "save";

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

export type StageResultStatus = "finished" | "abandoned";

export type StageResult = {
  rider_id: string;
  rank: number;
  time_seconds: number;
  group_id: string;
  status: StageResultStatus;
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

export type StageOutput = {
  timeline: { timeline_version: 2; events: TimelineEvent[] };
  results: StageResult[];
  loads: RiderLoad[];
  groupSnapshots: SegmentGroupSnapshot[];
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
  rngFor: RngForFn; // bundet til etapens seed; kald med (mechanic, riderId?)
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

export type MechanicHooks = {
  climbSelection: ClimbSelectionHook;
  descent: DescentHook;
  finale: FinaleHook;
  breakaway: BreakawayHook;
};
