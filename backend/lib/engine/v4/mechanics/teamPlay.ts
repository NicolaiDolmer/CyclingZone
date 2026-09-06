// backend/lib/engine/v4/mechanics/teamPlay.ts
// Race Engine v4 F3, M16 (#4246, #3855): HOLDSPILLET — kaptajnen beskyttes,
// hjaelperen betaler.
//
// SSOT: docs/RACE_ENGINE_RULES.md §9 punkt 1 (flip-scope = v3-paritet, "holdspil
// med hold-id paa rytteren") + punkt 3 (intentionens pris, Model C:
// "holdarbejdets pris ... all_out fjerner prisen, loftet til 0, aldrig bonus
// over egen evne"). Fund: docs/audits/race-engine-v4-audit-2026-09-05.md
// ("Holdspillet findes ikke i v4 ... Ved et flip forsvinder baade hjaelperens
// pris og kaptajnens fordel").
//
// M16 er et NYT katalognummer og en EJER-BESLUTTET scope-udvidelse (samme
// grundlag som M15/tidsgraensen): §2's katalog blev lukket 20/8 med M1-M14 og
// har ingen holdspils-post, men ejer-beslutning 1 (5/9) goer holdspillet til
// flip-minimum. Det er ikke en PR-tilfoejelse til et lukket katalog.
//
// REN — ingen import fra oevrigt backend, ingen IO, ingen Date, ingen rng
// OVERHOVEDET. Holdspillet er en DETERMINISTISK funktion af gruppe-
// sammensaetning, roller, hold-id, effort og etapeprofil — praecis som v3's
// workCost er "en DETERMINISTISK lookup ... den konsumerer ALDRIG rng"
// (raceRoles.js's egen header). Ingen rngFor-noegle betyder ogsaa at #4886's
// segment-index-krav ikke kan brydes her: mekanikken traekker aldrig et tal.
//
// ── DE TO KANALER, OVERSAT TIL v4 ────────────────────────────────────────────
// v3 har to holdspils-kanaler, begge paa en SCORE:
//   1. `raceSimulator.teamComponent` — den beskyttede rytter (kaptajn, eller
//      sprint-kaptajn paa flade etaper) faar holdets arbejde som et bounded
//      score-loeft: teamRaceWeightV3() x helperSupport.
//   2. `raceRoles.workCost` — hjaelperen/jaegeren betaler en negativ score-
//      delta for at have arbejdet, skaleret af dagens effort.
//
// v4 har ingen score at laegge et led paa; den har en fysiologi. Begge kanaler
// udtrykkes derfor som en multiplikator paa rytterens CP
// (`RiderState.team_cp_factor`, laest af segmentLoop.riderCpForSegment):
//   - hjaelperen faar en faktor UNDER 1 (han har koert i vinden hele dagen)
//   - den beskyttede rytter faar en faktor OVER 1 (lae, position, fri finale)
//
// HVORFOR CP OG IKKE W': foerste wiring-forsoeg 6/9 brugte W' (den anaerobe
// reserve) og var BIT-IDENTISK med og uden hold. Siden #4604's relative
// krav-tempo ligger ingen over CP i normaltilstanden, saa W' genoplades fuldt
// hvert segment og enhver delta er visket ud foer naeste segment laeser den.
// CP er den vedvarende akse: den styrer baade gruppens tempo
// (segmentLoop.computeGroupTempo) og klatre-selektionen (M2's testedDeficit)
// — netop de to steder v3's holdspil ogsaa slaar igennem.
//
// ── DE FIRE GARANTIER (konstruktion, ikke kalibrering) ───────────────────────
// 1. BEVARELSE. Kaptajnens bonus-fraktion er aldrig stoerre end summen af de
//    omkostnings-fraktioner hans holdkammerater FAKTISK paadrog sig samme
//    segment, ganget med transferEfficiency <= 1. Holdspil flytter kraefter;
//    det skaber dem ikke. v4's udgave af "aldrig gratis alt-ud" (§9 punkt 3).
// 2. BOUNDED. Bonussen er desuden loftet af `captainMaxBonusFraction` —
//    otte hjaelpere giver ikke otte gange fordel. "Bounded fordel-signal" er
//    ejer-formuleringen; dette tal er den.
// 3. INTET FORTEGNS-SKIFT. Prisen er ALTID >= 0 og bonussen ALTID >= 0
//    (Math.max(0, ...) begge steder). En effort-multiplikator paa 0 (all_out)
//    fjerner prisen; ingen kombination af rolle x profil x effort kan gøre den
//    NEGATIV, dvs. til gratis CP oveni egen evne. Samme strukturelle loft som
//    v3's `Math.min(0, ...)` i workCost, spejlet.
// 4. MONOTONI (§3 invariant 3). Faktoren er MULTIPLIKATIV paa rytterens egen
//    CP, aldrig et absolut fradrag, saa to ryttere i SAMME holdrolle-klasse
//    aldrig kan bytte indbyrdes CP-orden. Holdspillet er — som i v3 — en
//    kanal MELLEM roller, ikke stoej inden for en rolle.
//
// ── KRAEVER HOLD-ID ──────────────────────────────────────────────────────────
// `Entrant.team_id` er valgfrit (types.ts). Uden det er der intet hold, og
// mekanikken er en eksakt no-op: rollen alene er IKKE nok, praecis som v3's
// buildTeamContext springer enhver entrant uden team_id ELLER race_role over.
// De fire golden fixtures baerer ingen team_id og er derfor bit-uaendrede.

import type {
  EffortLevel,
  EngineState,
  Entrant,
  ProfileType,
  RaceGroup,
  RiderState,
  SegmentHookContext,
  SegmentHookResult,
} from "../types.ts";
import { TEAM_PLAY_EXTRA_TUNING } from "../tuning.ts";

export { TEAM_PLAY_EXTRA_TUNING as TEAM_PLAY_TUNING };

/** Tuning-formen TEAM_PLAY_EXTRA_TUNING (tuning.ts) implementerer. */
export type TeamPlayTuning = typeof TEAM_PLAY_EXTRA_TUNING;

// GC-relevante profiler: 1:1 med v3's `raceRoles.GC_RELEVANT_PROFILES` (v4
// importerer aldrig raceRoles.js — renheds-graensen — saa saettet er
// genimplementeret, ikke importeret; samme "duplikering er etableret
// moenster"-begrundelse som types.ts's litteral-unions).
const GC_RELEVANT_PROFILES: ReadonlySet<ProfileType> = new Set<ProfileType>([
  "rolling",
  "hilly",
  "mountain",
  "high_mountain",
  "classic",
]);

// Flade leadout-profiler: v3's `raceRoles.FLAT_LEADOUT_PROFILES`.
const FLAT_LEADOUT_PROFILES: ReadonlySet<ProfileType> = new Set<ProfileType>(["flat"]);

// Etapetyper hvor SPURT-kaptajnen er den beskyttede: v3's
// `raceSimulator.SPRINT_PROFILES` (praecis `flat`, ikke et bredere saet).
const SPRINT_PROFILES: ReadonlySet<ProfileType> = new Set<ProfileType>(["flat"]);

/**
 * Roller der ARBEJDER for holdet. `free_role` er bevidst udenfor: "koer dit
 * eget loeb" betyder 0 holdbidrag og 0 pris — ubetinget, praecis som v3's
 * buildTeamContext gør det ubetinget (#2376). En kaptajn/sprint-kaptajn
 * arbejder heller ikke: han MODTAGER holdets arbejde.
 */
const WORKER_ROLES = new Set(["helper", "hunter"]);

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Basis-prisen for én arbejdende rolle paa én etapeprofil, som andel af egen
 * CP over HELE etapen. Spejler v3's `raceRoles.baseWorkCost`:
 * helper betaler mest paa GC-relevante profiler, lidt mindre paa flad vej
 * (leadout), og `hunter` betaler en lille, profil-uafhaengig pris.
 *
 * FORSKEL FRA v3, bevidst: v3 giver `helper` praecis 0 paa alt andet end
 * GC-relevante og flade profiler ("ukendt profil -> 0"). v4 giver en halv
 * pris i stedet, fordi v4's felt faktisk koerer samlet paa brosten og grus —
 * en klassiker uden holdarbejde ville vaere en tom flade. Noteret som en
 * bevidst afvigelse, ikke en oversaettelsesfejl.
 */
export function baseCostFraction(
  role: string,
  profileType: ProfileType,
  tuning: TeamPlayTuning = TEAM_PLAY_EXTRA_TUNING,
): number {
  if (role === "hunter") return tuning.hunterCostFraction;
  if (role !== "helper") return 0;
  if (GC_RELEVANT_PROFILES.has(profileType)) return tuning.helperCostFractionGc;
  if (FLAT_LEADOUT_PROFILES.has(profileType)) return tuning.helperCostFractionFlat;
  return tuning.helperCostFractionOther;
}

/**
 * Effort -> multiplikator paa holdarbejdets PRIS (§9 punkt 3, ejer 6/9).
 * Ukendt/manglende effort -> fuld pris, samme defensive fallback som v3's
 * `effortCostMultiplier`: en vaerdi motoren ikke kender maa aldrig blive til
 * en rabat.
 *
 * NB: dette er IKKE `mechanics/effortCost.ts`'s `effortDemandMultiplier`.
 * De to akser peger med vilje hver sin vej for `all_out`: en rytter der giver
 * alt for SIG SELV braender mere (M12's demand-akse) og arbejder samtidig ikke
 * for holdet (0 her).
 */
export function helperCostMultiplier(
  effort: EffortLevel | undefined,
  tuning: TeamPlayTuning = TEAM_PLAY_EXTRA_TUNING,
): number {
  const m = tuning.effortCostMultiplier[effort as EffortLevel];
  return Number.isFinite(m) ? Math.max(0, m) : tuning.effortCostMultiplier.normal;
}

/**
 * Stoette-andel givet antal arbejdende holdkammerater i gruppen: 0 under
 * `minWorkersForProtection`, derefter en maettende kurve op mod 1 ved
 * `supportSaturationWorkers`. Monotont ikke-faldende og clampet til [0, 1] —
 * samme "kvalitet over kvantitet, naturligt bounded"-princip som v3's
 * buildTeamContext bruger naar den MIDLER hjaelperstoetten i stedet for at
 * summere den.
 *
 * Eksporteret for property-testbarhed (samme praecedens som
 * segmentLoop.groupDraftSpeedGain).
 */
export function supportShare(
  workerCount: number,
  tuning: TeamPlayTuning = TEAM_PLAY_EXTRA_TUNING,
): number {
  if (!Number.isFinite(workerCount) || workerCount < tuning.minWorkersForProtection) return 0;
  const saturation = Math.max(1, tuning.supportSaturationWorkers);
  if (workerCount <= 1) return saturation <= 1 ? 1 : clamp(1 / saturation, 0, 1);
  return clamp(Math.log(1 + workerCount) / Math.log(1 + saturation), 0, 1);
}

/**
 * Den BESKYTTEDE rytters rolle paa denne etapetype (v3's `teamComponent`
 * 1:1): paa flade etaper er det sprint-kaptajnen, ellers kaptajnen — og
 * hver af dem falder tilbage paa den anden hvis holdet ikke har den.
 */
export function protectedRoleOrder(profileType: ProfileType): readonly string[] {
  return SPRINT_PROFILES.has(profileType)
    ? (["sprint_captain", "captain"] as const)
    : (["captain", "sprint_captain"] as const);
}

/** Holdets sammensaetning INDEN FOR én gruppe. */
type GroupTeamContext = {
  team_id: string;
  /** Den beskyttede rytter i denne gruppe, eller null hvis holdet ikke har en her. */
  leaderId: string | null;
  /** Arbejdende holdkammerater (helper/hunter) der stadig koerer i denne gruppe. */
  workerIds: string[];
};

/**
 * Bygger holdkontekst for ÉN gruppe. Kun ryttere der stadig `racing` taeller —
 * en udgaaet hjaelper traekker ikke, og en udgaaet kaptajn skal ikke beskyttes.
 * Ryttere uden `team_id` ignoreres fuldstaendigt (se filens hoved).
 *
 * DUBLET-ROLLER: prod har 119 beskidte rolle-raekker (auditten 5/9: op til
 * seks jaegere i samme hold-etape-gruppe, ingen entydighedsbetingelse i DB).
 * v3 haandterer det ved at Sentry-rapportere og BEHOLDE den foerste; her
 * vaelges den foerste i en STABIL rider_id-orden, saa to kald paa samme input
 * altid giver samme leder (determinisme foer skoenhed).
 *
 * Eksporteret for direkte kontrakt-tests.
 */
export function buildGroupTeamContexts(
  group: RaceGroup,
  entrants: Readonly<Record<string, Entrant>>,
  riders: Readonly<Record<string, RiderState>>,
  profileType: ProfileType,
): GroupTeamContext[] {
  const byTeam = new Map<string, { byRole: Map<string, string[]>; workerIds: string[] }>();
  for (const riderId of [...group.rider_ids].sort((a, b) => a.localeCompare(b))) {
    const entrant = entrants[riderId];
    const riderState = riders[riderId];
    if (!entrant || !riderState) continue;
    if (riderState.status !== "racing") continue;
    const teamId = entrant.team_id;
    if (typeof teamId !== "string" || teamId.length === 0) continue;
    let bucket = byTeam.get(teamId);
    if (!bucket) {
      bucket = { byRole: new Map(), workerIds: [] };
      byTeam.set(teamId, bucket);
    }
    if (WORKER_ROLES.has(entrant.role)) {
      bucket.workerIds.push(riderId);
    } else {
      const list = bucket.byRole.get(entrant.role) ?? [];
      list.push(riderId);
      bucket.byRole.set(entrant.role, list);
    }
  }

  const order = protectedRoleOrder(profileType);
  const out: GroupTeamContext[] = [];
  for (const [teamId, bucket] of [...byTeam.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let leaderId: string | null = null;
    for (const role of order) {
      const candidates = bucket.byRole.get(role);
      if (candidates && candidates.length > 0) {
        leaderId = candidates[0];
        break;
      }
    }
    out.push({ team_id: teamId, leaderId, workerIds: bucket.workerIds });
  }
  return out;
}

/**
 * M16-hooket (types.ts's `TeamPlayHook`). REN: nyt state-objekt, ingen
 * mutation af input; ingen events.
 *
 * HVORFOR INGEN EVENTS: holdarbejde er en tilstand, ikke et oejeblik.
 * #2410-taksonomien har ingen "holdet traekker"-type, og et event pr. segment
 * pr. hold ville drukne tidslinjen uden at fortaelle spilleren noget han ikke
 * allerede kan se af hvem der sidder foran. Fog-gaten (§3 invariant 5) ville
 * desuden forbyde selve tallene. Holdspillets synlighed er placeringerne.
 *
 * WIRING (segmentLoop.ts): kaldes som det FOERSTE hook i segmentet, dvs.
 * umiddelbart efter fysiologi-tick'et og gap-bogfoeringen og FOER
 * climb/descent/cobbles-selektionen. Faktoren hooket saetter laeses af
 * `riderCpForSegment` i NAESTE segment: prisen betales FREMAD, praecis som i
 * virkeligheden, hvor en tur i vinden koster resten af dagen og ikke det
 * stykke man allerede har koert.
 */
export function teamPlayHook(state: EngineState, ctx: SegmentHookContext): SegmentHookResult {
  const tuning = TEAM_PLAY_EXTRA_TUNING;
  const distanceKm = ctx.route.distance_km;
  const segmentKm = Math.max(0, ctx.segment.to_km - ctx.segment.from_km);
  // Km-andel: gør prisen uafhaengig af hvor fint ruten er skaaret op (samme
  // granularitets-argument som M10's pr.-km-skalering, §2c). Summen af
  // andelene over en hel etape er 1, saa en hjaelpers samlede pris er praecis
  // `baseCostFraction x effort-multiplikator` uanset segment-antal.
  const segmentShare = distanceKm > 0 ? clamp(segmentKm / distanceKm, 0, 1) : 0;
  if (segmentShare <= 0) return { state, events: [] };

  const profileType = ctx.route.profile_type;
  /** rider_id -> signeret CP-fraktion dette segment (negativ = pris, positiv = lae). */
  const deltas = new Map<string, number>();

  for (const group of state.groups) {
    for (const team of buildGroupTeamContexts(group, ctx.entrants, state.riders, profileType)) {
      if (team.workerIds.length === 0) continue;

      // 1. Hjaelperne betaler. Prisen er en andel af DERES EGEN CP (garanti 4,
      //    monotoni): to hjaelpere med samme rolle og effort bevarer deres
      //    indbyrdes CP-orden uanset hvor haardt holdet arbejder.
      let paidTotal = 0;
      for (const workerId of team.workerIds) {
        const entrant = ctx.entrants[workerId];
        if (!entrant) continue;
        const fraction = baseCostFraction(entrant.role, profileType, tuning);
        if (fraction <= 0) continue;
        // Garanti 3: prisen er ALDRIG negativ (all_out => 0, aldrig gratis CP).
        const paid = Math.max(0, fraction * helperCostMultiplier(entrant.effort, tuning) * segmentShare);
        if (paid <= 0) continue;
        paidTotal += paid;
        deltas.set(workerId, (deltas.get(workerId) ?? 0) - paid);
      }

      // 2. Den beskyttede rytter faar lae. Ingen leder i gruppen => holdet
      //    arbejdede forgaeves (og hjaelperne har stadig betalt — praecis som
      //    i virkeligheden, hvor et hold der har mistet sin kaptajn har
      //    braendt dagen).
      if (!team.leaderId || !state.riders[team.leaderId]) continue;
      const share = supportShare(team.workerIds.length, tuning);
      if (share <= 0) continue;

      // Garanti 1 (bevarelse): bonussen kan aldrig overstige det holdet
      // paadrog sig, ganget med transfer-effektiviteten.
      const fromTeam = paidTotal * clamp(tuning.transferEfficiency, 0, 1) * share;
      // Garanti 2 (bounded): og aldrig kaptajnens eget etape-loft.
      const ceiling = tuning.captainMaxBonusFraction * segmentShare;
      // Garanti 3: intet fortegns-skift — en bonus er aldrig en straf.
      const bonus = Math.max(0, Math.min(fromTeam, ceiling));
      if (bonus <= 0) continue;
      deltas.set(team.leaderId, (deltas.get(team.leaderId) ?? 0) + bonus);
    }
  }

  if (deltas.size === 0) return { state, events: [] };

  const riders: Record<string, RiderState> = { ...state.riders };
  for (const [riderId, delta] of deltas) {
    const riderState = riders[riderId];
    if (!riderState) continue;
    const current = Number.isFinite(riderState.team_cp_factor) ? (riderState.team_cp_factor as number) : 1;
    // Akkumuleres ADDITIVT paa faktoren (ikke multiplikativt): summen af
    // segment-andelene er praecis 1, saa en hel etapes holdarbejde giver
    // noejagtig `baseCostFraction x effort-multiplikator` uanset hvor mange
    // segmenter ruten har. Multiplikativ akkumulering ville give et lille
    // andengrads-led der voksede med segment-antallet, dvs. netop den
    // granularitets-afhaengighed konstruktionen er bygget for at undgaa.
    const nextFactor = clamp(current + delta, tuning.minCpFactor, 1 + tuning.captainMaxBonusFraction);
    // KUN `team_cp_factor` roeres. Holdarbejdet bogfoeres bevidst IKKE i
    // `work_norm` (beslutning 18's RiderLoad-kontrakt): det tal er
    // segment-loopets akkumulerede, normaliserede arbejde i motorens egne
    // enheder, og et holdspils-led ville skulle opfinde en omregning fra
    // "andel af CP" til den enhed. Maalt 6/9: et saadant led laa ~5
    // stoerrelsesordener under work_norm's egen skala og var altsaa ren
    // pynt — og gik samtidig den FORKERTE vej, fordi en hjaelper med lavere
    // CP rykker ned i front-slicen og dermed tikker MINDRE arbejde.
    //
    // At holdarbejde ogsaa skal koste i traeningsudbyttet er rigtigt, men det
    // hoerer i loebsdags-udviklingen (#4850/D2) sammen med intentionens egen
    // udbytte-multiplikator (raceRoles.effortDevelopmentMultiplier), ikke i en
    // opfundet enhed her. Noteret som aabent i RACE_ENGINE_RULES §2e.
    riders[riderId] = { ...riderState, team_cp_factor: nextFactor };
  }

  return { state: { ...state, riders }, events: [] };
}
