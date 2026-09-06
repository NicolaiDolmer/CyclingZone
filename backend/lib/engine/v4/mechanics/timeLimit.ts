// backend/lib/engine/v4/mechanics/timeLimit.ts
// Race Engine v4 F3 (#2582, #3855): M15 - tidsgraensen (UCI-reglen).
// Ejer-beslutning 6/9 (laast, se docs/RACE_ENGINE_RULES.md §2d): mekanik-
// kataloget i §2 var lukket 20/8 med M1-M14; M15 er en EJER-BESLUTTET
// scope-udvidelse, ikke en PR-tilfoejelse.
//
// Reglen, ordret fra beslutningen:
//   1. En rytter der kommer i maal uden for tidsgraensen er ude af loebet
//      (etapeloeb: starter ikke naeste etape, ude af klassementet) eller DNF
//      (endagsloeb).
//   2. Grupetto-redning: en STOR gruppe der kommer samlet i maal uden for
//      tidsgraensen reddes.
//   3. Graensen saettes pr. etapetype (`profile_type`) som en ANDEL af
//      vindertiden — UCI's 5-20 %-baand, flad lavest, bjerg/summit hoejest;
//      enkeltstart/holdtidskoersel efter UCI-praksis (25 %).
//   4. Tallet vises ALDRIG for spilleren. Kun "uden for tidsgraensen".
//   5. AI-hold rammes af PRAECIS samme regel som spillerhold — der er ingen
//      hold-akse i dette modul overhovedet, saa undtagelsen er strukturelt
//      umulig, ikke blot udeladt.
//   6. OTL er en NY udfaldsklasse ved siden af finished/abandoned
//      (types.ts's StageResultStatus), saa klassement og flip-mapping kan
//      skelne.
//
// REN — ingen import fra oevrigt backend, ingen IO/Date/Math.random og
// BEVIDST INGEN rng overhovedet: tidsgraensen er en REGEL, ikke en
// lodtraekning. Determinisme er derfor triviel (ren aritmetik + en sortering
// paa (tid, rider_id)).
//
// MONOTONI (invariant 3, RACE_ENGINE_RULES.md §3): modulet aendrer ALDRIG
// `rank`, `time_seconds` eller raekkefoelgen i `results` — kun `status`-feltet
// paa de ramte raekker. Feltstoerrelsen (invariant 6) er derfor ogsaa uroert:
// en OTL-rytter bliver staaende i resultatlisten, han er blot maerket. Hvad
// der sker med ham i DB'en er FLIP-lagets ansvar, ikke motorkernens (se
// FLIP-KONTRAKT nederst i filen og i types.ts).

import type { ProfileType, StageResult, StageResultStatus, TimelineEvent } from "../types.ts";
import { TIME_LIMIT_EXTRA_TUNING } from "../tuning.ts";

/**
 * Tuning-formen TIME_LIMIT_EXTRA_TUNING (tuning.ts) implementerer. Holdt her
 * og ikke i types.ts (frosset, arkitekt-only) — samme additive moenster som
 * effortCost.ts's EffortCostTuning / finale.ts's FINALE_EXTRA_TUNING.
 */
export type TimeLimitTuning = {
  factorByProfileType: Readonly<Record<ProfileType, number>>;
  fallbackFactor: number;
  grupettoFieldFraction: number;
  grupettoMinRiders: number;
  grupettoCohesionWindowSeconds: number;
};

export { TIME_LIMIT_EXTRA_TUNING as TIME_LIMIT_TUNING };

/** Ny udfaldsklasse (punkt 6). Egen konstant saa aftagere ikke staver den forkert. */
export const OTL_STATUS: StageResultStatus = "otl";

// Event-typer. Taksonomien er AABEN (types.ts's `KnownTimelineEventType |
// (string & {})`), saa disse tilfoejes UDEN at aendre den frosne fil — samme
// praecedens som mechanics/bonusSeconds.ts's bonus_seconds_awarded.
export const OUTSIDE_TIME_LIMIT_EVENT = "outside_time_limit";
export const GRUPETTO_SAVED_EVENT = "grupetto_saved";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Graense-faktoren for en etapetype (punkt 3). Ukendt/manglende type falder
 * tilbage paa `fallbackFactor` — motoren maa aldrig kaste paa en profil-type
 * den ikke kender (samme forward-kompatible holdning som taksonomien).
 */
export function timeLimitFactorFor(
  profileType: ProfileType | null | undefined,
  tuning: TimeLimitTuning = TIME_LIMIT_EXTRA_TUNING,
): number {
  if (!profileType) return tuning.fallbackFactor;
  const factor = tuning.factorByProfileType[profileType];
  return Number.isFinite(factor) ? factor : tuning.fallbackFactor;
}

/**
 * Selve graensen i sekunder: vindertid x (1 + faktor). Rundet til 2 decimaler
 * som al anden tid i motoren, saa graensen er stabil paa tvaers af kaldere.
 *
 * FOG-GATE (#1791): dette tal maa aldrig naa `events[].params` eller en
 * spiller-flade. Det returneres KUN til motor-interne aftagere (harness,
 * tests, scorecard).
 */
export function timeLimitSecondsFor(
  winnerTimeSeconds: number,
  profileType: ProfileType | null | undefined,
  tuning: TimeLimitTuning = TIME_LIMIT_EXTRA_TUNING,
): number {
  const winner = Math.max(0, Number(winnerTimeSeconds) || 0);
  return round2(winner * (1 + timeLimitFactorFor(profileType, tuning)));
}

/**
 * Hvor mange ryttere en gruppe skal have foer den er "stor" (punkt 2).
 * UCI bruger typisk 20 % af feltet; det absolutte gulv forhindrer at et
 * mikroskopisk felt goer ENHVER klump til en grupetto.
 */
export function grupettoThresholdFor(
  fieldSize: number,
  tuning: TimeLimitTuning = TIME_LIMIT_EXTRA_TUNING,
): number {
  const byFraction = Math.ceil(Math.max(0, fieldSize) * tuning.grupettoFieldFraction);
  return Math.max(tuning.grupettoMinRiders, byFraction);
}

type ArrivalEntry = { rider_id: string; time_seconds: number };

/**
 * Ankomst-grupper: ryttere sorteret paa sluttid kaedes sammen saa laenge
 * afstanden til naboen er UNDER `windowSeconds` — samme sammenhaengs-semantik
 * som groups.mergeGroups (groups.ts), oversat fra gap-rum til sluttids-rum.
 * Gruppe-tids-princippet (mor-spec §3.2) goer at ryttere i samme maalgruppe
 * har PRAECIS samme tid, saa en samlet ankomst er én kaede.
 *
 * VINDUET er en ANKOMST-graense, ikke groups.mergeThresholdSeconds. finale.ts
 * lægger hvert placerings-tier mindst mergeThresholdSeconds + margin fra
 * naboen (netop saa mergeGroups ikke folder tierne sammen igen), saa et
 * merge-taerskel-vindue kunne per konstruktion aldrig kaede to tiers til én
 * grupetto — se maalingen ved TIME_LIMIT_EXTRA_TUNING.grupettoCohesionWindowSeconds.
 *
 * Eksporteret for direkte kontrakt-tests. REN: input muteres aldrig,
 * raekkefoelgen er (tid, rider_id) og dermed deterministisk.
 */
export function groupByArrival(entries: readonly ArrivalEntry[], windowSeconds: number): ArrivalEntry[][] {
  const sorted = [...entries].sort(
    (a, b) => a.time_seconds - b.time_seconds || a.rider_id.localeCompare(b.rider_id),
  );
  const groups: ArrivalEntry[][] = [];
  for (const entry of sorted) {
    const current = groups[groups.length - 1];
    const last = current?.[current.length - 1];
    if (last && entry.time_seconds - last.time_seconds < windowSeconds) {
      current.push(entry);
      continue;
    }
    groups.push([entry]);
  }
  return groups;
}

export type TimeLimitOutcome = {
  /** `results` med `status: "otl"` sat paa de ramte raekker. Samme laengde/raekkefoelge/rank/tid. */
  results: StageResult[];
  /** Tidslinje-events (tom naar ingen er ramt) — ALDRIG med procent eller sekundgraense. */
  events: TimelineEvent[];
  /** Motor-intern (fog-gated): graensen i sekunder. Til harness/tests/scorecard, aldrig til spilleren. */
  limitSeconds: number;
  /** Motor-intern: vindertiden graensen er maalt fra. */
  winnerTimeSeconds: number;
  /** Ryttere der endte uden for graensen OG ikke blev reddet. */
  otlRiderIds: string[];
  /** Ryttere der laa uden for graensen men blev reddet af grupetto-reglen. */
  rescuedRiderIds: string[];
};

export type ApplyTimeLimitArgs = {
  /** Resultatlisten som index.ts allerede har bygget (rank + sluttid sat). */
  results: readonly StageResult[];
  /** Etapetypen graensen afledes af (punkt 3). */
  profileType: ProfileType | null | undefined;
  /** Etapens laengde — events placeres paa maalstregen (#2410 §2.3 regel 4). */
  distanceKm: number;
  /**
   * Sammenhaengsvindue for ankomst-grupper. Udelades den (den normale vej),
   * bruges TIME_LIMIT_EXTRA_TUNING's eget ANKOMST-vindue. Parameteren findes
   * for tests/harness der vil sweepe vinduet uden at roere tuning-fladen.
   */
  cohesionWindowSeconds?: number;
  tuning?: TimeLimitTuning;
};

/**
 * M15: anvend tidsgraensen paa en faerdig resultatliste.
 *
 * Rekkefoelgen af beslutninger:
 *   1. Vindertiden = mindste sluttid blandt de ryttere der FAKTISK kom i maal
 *      (status "finished"). Udgaaede (abandoned) har allerede en terminal
 *      udfaldsklasse og roeres ikke — hverken som maalestok eller som ofre.
 *   2. Graensen = vindertid x (1 + faktor(profile_type)).
 *   3. Alle finishers strengt over graensen er kandidater.
 *   4. Kandidaterne grupperes paa ankomst (groupByArrival). Enhver gruppe med
 *      mindst `grupettoThresholdFor(feltstoerrelse)` ryttere REDDES samlet;
 *      resten faar status "otl".
 *
 * Ingen rng, ingen holdakse, ingen spiller/AI-skelnen (punkt 5).
 */
export function applyTimeLimit(args: ApplyTimeLimitArgs): TimeLimitOutcome {
  const tuning = args.tuning ?? TIME_LIMIT_EXTRA_TUNING;
  const windowSeconds =
    Number.isFinite(args.cohesionWindowSeconds) && (args.cohesionWindowSeconds as number) > 0
      ? (args.cohesionWindowSeconds as number)
      : tuning.grupettoCohesionWindowSeconds;

  const finishers = args.results.filter((r) => r.status === "finished");
  const empty: TimeLimitOutcome = {
    results: args.results.map((r) => ({ ...r })),
    events: [],
    limitSeconds: 0,
    winnerTimeSeconds: 0,
    otlRiderIds: [],
    rescuedRiderIds: [],
  };
  if (finishers.length === 0) return empty;

  const winnerTimeSeconds = finishers.reduce((min, r) => Math.min(min, r.time_seconds), finishers[0].time_seconds);
  const limitSeconds = timeLimitSecondsFor(winnerTimeSeconds, args.profileType, tuning);

  const overLimit = finishers.filter((r) => r.time_seconds > limitSeconds);
  if (overLimit.length === 0) {
    return { ...empty, limitSeconds, winnerTimeSeconds };
  }

  // Grupetto-redningen maales mod HELE feltet (nævneren er startlisten), ikke
  // mod de ramte alene — "20 % af feltet" i UCI-forstand.
  const grupettoThreshold = grupettoThresholdFor(args.results.length, tuning);
  const arrivalGroups = groupByArrival(
    overLimit.map((r) => ({ rider_id: r.rider_id, time_seconds: r.time_seconds })),
    windowSeconds,
  );

  const otlIds = new Set<string>();
  const rescuedIds = new Set<string>();
  const rescuedGroupSizes: number[] = [];
  for (const group of arrivalGroups) {
    if (group.length >= grupettoThreshold) {
      for (const entry of group) rescuedIds.add(entry.rider_id);
      rescuedGroupSizes.push(group.length);
      continue;
    }
    for (const entry of group) otlIds.add(entry.rider_id);
  }

  const results = args.results.map((r) => (otlIds.has(r.rider_id) ? { ...r, status: OTL_STATUS } : { ...r }));

  // Stabil, deterministisk raekkefoelge i event-params: resultatlistens egen
  // (dvs. rank-orden), ikke Set-indsaettelses-orden.
  const otlRiderIds = args.results.filter((r) => otlIds.has(r.rider_id)).map((r) => r.rider_id);
  const rescuedRiderIds = args.results.filter((r) => rescuedIds.has(r.rider_id)).map((r) => r.rider_id);

  const finishKm = round2(args.distanceKm);
  const events: TimelineEvent[] = [];
  if (rescuedRiderIds.length > 0) {
    // "grupettoen paa N ryttere reddes" (ejer-beslutning punkt 2+4): antal ryttere
    // er tilladt, procent og sekundgraense er det ALDRIG.
    events.push({
      km: finishKm,
      type: GRUPETTO_SAVED_EVENT,
      params: { rider_ids: rescuedRiderIds, rider_count: rescuedRiderIds.length },
    });
  }
  if (otlRiderIds.length > 0) {
    events.push({
      km: finishKm,
      type: OUTSIDE_TIME_LIMIT_EVENT,
      params: { rider_ids: otlRiderIds, rider_count: otlRiderIds.length },
    });
  }

  return { results, events, limitSeconds, winnerTimeSeconds, otlRiderIds, rescuedRiderIds };
}

// ── FLIP-KONTRAKT: hvad `feat/v4-flip-infrastructure` skal goere med OTL ──────
//
// Motorkernen mærker KUN. Persisteringen ligger i flip-laget (raceRunner.js +
// adapters/), som dette modul med vilje ikke roerer. Praecist hvad der skal
// ske, maalt paa v3's egen DNF-sti (verificeret 6/9):
//
// 1. `race_results` HAR INGEN status-kolonne (database/supabase_setup.sql:106-120:
//    id, race_id, stage_number, result_type, rank, rider_id, rider_name,
//    team_id, team_name, finish_time, points_earned, prize_money, imported_at
//    + Sub-2/#2770's passage-kolonner). v3 markerer derfor IKKE en DNF i
//    `race_results` — den SKRIVER INGEN etaperaekke for rytteren fra og med
//    den etape han udgik paa (ordret i database/2026-07-12-race-v3-s4-
//    incidents.sql:13-16: "DNF = ingen etape-raekke fra denne etape og frem").
//    OTL skal foelge PRAECIS samme moenster: rytteren faar ingen `result_type:
//    'stage'`-raekke for etapen — dermed hverken tid eller rank — i stedet for
//    en halvtom raekke, som hverken constraint eller aftagere forventer.
//
// 2. MARKERINGEN bor i `race_incidents` (kolonner: race_id, stage_number,
//    rider_id, kind, outcome, time_loss_seconds, injury_days). Det er den
//    tabel v3 bruger til at forklare hvorfor en raekke mangler. To CHECK-
//    constraints staar i vejen og kraever ÉN idempotent migration i
//    flip-PR'en:
//      - `race_incidents_kind_check` (i dag 'crash'|'mechanical'|'injury',
//        udvidet af database/2026-08-30-4418-injury-dns-incident-kind.sql)
//        skal udvides med `'time_limit'`.
//      - `race_incidents_outcome_check` (i dag 'time_loss'|'abandon'): OTL kan
//        enten genbruge `outcome='abandon'` (samme konsekvens: ude af loebet)
//        eller faa sin egen vaerdi `'otl'`. **Anbefaling: genbrug 'abandon'** —
//        se punkt 3; arten (`kind='time_limit'`) baerer forskellen, praecis
//        som #4418's `kind='injury'` allerede goer for en ikke-starter.
//        `injury_days` skal vaere NULL (en tidsgraense er ikke en skade —
//        RACE_ENGINE_RULES.md §2c: kun et STYRT maa skade rytteren), og
//        `persistIncidents`' `rider_condition.injured_until`/
//        `injury_cause='race_crash'`-gren maa derfor IKKE ramme OTL-raekker.
//
// 3. NAESTE ETAPES STARTLISTE (etapeloeb): `raceRunner.js:2449` kalder
//    `loadAbandonedRiderIds` (backend/lib/raceIncidents.js:144), som laeser
//    `race_incidents` paa `outcome='abandon'` og filtrerer bade `entrants` og
//    `effectiveStartField`. Skrives OTL med `outcome='abandon'`, er
//    "starter ikke naeste etape" opfyldt UDEN en eneste kodeaendring i
//    runneren. Vaelges i stedet et nyt `outcome='otl'`, SKAL `loadAbandonedRiderIds`
//    udvides til `.in("outcome", ["abandon", "otl"])` — ellers stiller
//    OTL-rytteren til start dagen efter.
//
// 4. KLASSEMENTET: `raceClassifications.filterCompletedEntrants`
//    (backend/lib/raceClassifications.js:144) kraever at en rytter har raekker
//    paa ALLE etaper der har raekker. Den manglende etaperaekke fra punkt 1
//    fjerner ham derfor automatisk fra GC, point-, bjerg-, ungdoms- og
//    holdklassementet — ingen ny kolonne, ingen ny gren.
//
// 5. ENDAGSLOEB: der er ingen naeste etape og intet klassement. Konsekvensen er
//    kun punkt 1+2 (ingen resultatraekke + en markering) = DNF.
//
// 6. TIDSLINJEN: `outside_time_limit` og `grupetto_saved` er aabne
//    event-typer og persisteres som alle andre. Renderer-laget maa ALDRIG vise
//    procenten eller sekundgraensen — kun "uden for tidsgraensen" og
//    "grupettoen paa N ryttere reddes" (ejer-beslutning punkt 4).
