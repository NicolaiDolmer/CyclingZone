/**
 * #3514 S-M2b · Boardroom-endpointet (`GET /board/room`)s aggregerings-modul.
 * =========================================================================
 * Spec: docs/superpowers/specs/2026-08-07-board-mandate-rework-design.md §3.4
 * Addendum: docs/superpowers/specs/2026-09-01-board-mandate-addendum-personer-med-stemme.md
 * Plan: docs/slices/09-board-mandate-rework-MASTER.md
 *
 * `buildBoardRoomPayload({ supabase, teamId })` er den ENESTE aggregator
 * for Boardroom-siden. Route'en (routes/api.js `GET /board/room`) holdes tynd:
 * flag-tjek + auth/team-scoping, resten af sammensætningen sker her, så den kan
 * unit-testes uden Express.
 *
 * KENDTE AFVIGELSER FRA DEN BINDENDE KONTRAKT (rapporteret i PR-beskrivelsen,
 * frontend-workeren skal kunne rette op):
 *
 *  1. `mandate.goals[].labelKey`/`labelParams` er en NY i18n-konvention
 *     (`goalType.<type>`) — der findes IKKE i dag i18n-nøgler for mål-typer i
 *     `board.json` (boardGoals.js::buildGoalLabel returnerer rå dansk tekst).
 *     Content for disse nøgler skal skrives, dette er kun den strukturelle krog.
 *  2. LUKKET 2/9 (#4579): `mandate.goals[].status`-udregningen brugte en LET
 *     håndbygget kontekst (planDuration 1, cumulativeStats 0/0 hardkodet) i
 *     stedet for den fulde `loadGoalContextForBoard`-loader. 177 af 237 aktive
 *     mandater i prod har et `relative_rank`-mål — den lette kontekst manglede
 *     `divisionManagerCount`, så ALLE disse mål evaluerede til
 *     `evaluateGoalProgress`s `awaiting_data` (mappet til `on_track`, se
 *     `mapGoalEvaluationToStatus`) uanset reel placering. Nu: mandatets 1yr-
 *     `board_profiles`-row (`mandateRow.source.from_board_id`, fallback
 *     team_id+plan_type='1yr') hentes best-effort, `loadGoalContextForBoard`
 *     kaldes med den (injicerbar via `loadGoalContext`-parameteren til test),
 *     og den DELTE `buildBoardEvalContext` (samme bygger som /board/status,
 *     weekend- og season-end-stierne, #2469) bygger evaluerings-konteksten.
 *     `awaiting_data` (ægte datamangel — fx plan-sæson 1 uden baseline,
 *     `domestic_dominance` som stadig er et skelet) mappes STADIG til
 *     `on_track` (aldrig en falsk alarm), men hvert `mandate.goals[]`-objekt
 *     bærer nu `awaitingData: boolean` så frontend kan skelne "reelt on
 *     track" fra "vi mangler data endnu".
 *  3. `mandate.goals[].unitKey` er altid `null` — der findes ikke et etableret
 *     enheds-nøgle-system for mål-typer i dag.
 *  4. LUKKET 2/9 (#4578): `board_satisfaction_events.goal_states` (ny nullable
 *     jsonb-kolonne, `database/2026-09-02-4578-board-satisfaction-events-goal-
 *     states.sql`) bærer nu et mål-for-mål-snapshot pr. kvittering, skrevet af
 *     `boardMandateEngine.js::buildGoalStatesFromEvaluation`. `deriveGoalMovements`
 *     sammenligner nabo-tilstande PR. `goal_key` (`boardGoals.js::buildGoalKey`
 *     — indholdsbaseret, IKKE et id, mål har aldrig haft id'er) og finder
 *     "bevægelser" (status/met skifter). `mandate.goals[].receipt.lastMovementAt`/
 *     `lastMovementKey` udfyldes nu fra den seneste bevægelse for målets
 *     nøgle, talt i EJERENS stemme. Rækker skrevet FØR denne PR (og enhver
 *     legacy-række uden `goal_states`) har intet at sammenligne imod og
 *     bidrager ikke til nogen bevægelse — kvitteringen forbliver `null` for
 *     dem, uden fejl (se `deriveGoalMovements`s "legacy-rækker springes over").
 *  5. LUKKET 2/9 (#4578): en `minutes[]`-række kan nu tale i EJERENS stemme,
 *     HVIS rækken bærer `goal_states` og mindst én bevægelse i netop den
 *     række kan tilskrives ét mål med en kendt ejer (`goal_key` slået op mod
 *     mandatets `goals[]` via `resolveGoalOwnerArchetypeKey`) — ved flere
 *     bevægede mål i samme række vinder den med størst `|toRank − fromRank|`
 *     (uafgjort: mandatets mål-rækkefølge). En række UDEN nogen tilskrivelig
 *     bevægelse (legacy-rækker, mandat-niveau-rækker uden `goal_states`,
 *     eller rækker hvor ingen af de bevægede mål har en ejer) falder STADIG
 *     tilbage til FORMANDEN med `receipt_positive`/`receipt_negative` ud fra
 *     fortegnet på `satisfaction_delta` — det er ikke længere ALLE mandat-
 *     niveau-rækker, kun dem uden en tilskrivelig mål-bevægelse. Milepæls-
 *     afgørelser (`mandate.milestone.*`) er stadig ALTID formands-beats,
 *     uanset `goal_states`.
 *  6. `board.members[].role` er en AFLEDT visning (chairman → "chair", ellers
 *     arketypens højeste `category_alignment`-kategori) — `role` er ikke et
 *     persisteret felt på `team_board_members`.
 *  7. LUKKET 2/9 (#4578): `board.members[].mood` afledes nu OGSÅ af mål-
 *     bevægelser på medlemmets EJEDE mål (improved = +1, worsened = -1),
 *     oveni de eksisterende milepæls-linkede kvitteringer — begge slags
 *     samles og sorteres nyeste-først FØR `deriveMemberMood`s 5-seneste-
 *     vindue (MOOD_WINDOW) vælger ud. `deriveMemberMood`s signatur er
 *     UÆNDRET (den filtrerer stadig `ownedEvents` på `ownerArchetypeKey`);
 *     det er kun INPUT-listen kalderen bygger der nu er bredere.
 *  8. `confidence.consequence.lineKey` genbruger `boardConsequences.js`'
 *     eksisterende `consequence.layer.*`-nøgler, som resolves i
 *     `backendMessages`-namespacet, IKKE `board`-namespacet addendummet ellers
 *     bruger til alt andet.
 *  9. `vision.startSeason` er mandatets `season_number` (indeværende sæson),
 *     `endSeason` er den seneste `target_season_number` blandt milepælene.
 *     Ingen af de to er et dedikeret persisteret "vision-vindue"-felt.
 *
 * OPDATERET 1/9 efter integrations-afstemning med frontend-PR'en (#4569, mod
 * denne PR #4570): orkestratoren godkendte afvigelse 2/4/5/6-9 uændret og
 * bad om fire konkrete tilføjelser (afvigelse 1 er dermed rettet, ikke længere
 * en afvigelse):
 *  - `mandate.goals[]`/`vision.milestones[]` bærer nu RÅ mål-felter
 *    (`type`, `target`, `label`, `cumulative`, `race_scope`,
 *    `nationality_code`) så frontend kan bruge sin egen kanoniske
 *    `getBoardGoalLabel`-resolver (`frontend/src/lib/boardGoalLabel.js`)
 *    direkte på objektet. `labelKey`/`labelParams` bevares som separat
 *    fallback (frontend afgør selv hvornår den bruges).
 *  - Ny top-level `team: { dnaKey }`.
 *  - `vision.titleKey` = `vision.title.<dnaKey>` (eller `.default` uden
 *    dnaKey) — ren nøgle-afledning, intet indhold her.
 *  - `board.members[].sinceSeason`: AFLEDT (ikke persisteret) af
 *    `teams.created_at` mod `seasons.start_date` — samme tal for alle
 *    medlemmer i denne runde (ejer-godkendt forenkling), se
 *    `deriveFoundingSeasonNumber`.
 *
 * RETTET 2/9 (#4586): alle tre `sampleVoiceLineOrNull`-kald (chairmanQuote,
 * goal-receipt, minutes) sender nu `context.members: assignedMembers` med —
 * den SAMME liste `namesByArchetype` bygges af. boardVoice.js's kollisions-
 * salt (se boardMandateNames.js) afhænger af de foregående medlemmer i
 * listen, så et enkelt-medlems-kald (uden `members`) kunne give et ANDET
 * navn end medlemskortene for samme (team, arketype) når to basisnavne
 * kolliderede. Se boardVoice.js's modul-header for kontrakten.
 *
 * RETTET 2/9 (#4578): kvitterings-events bærer nu mål-tilstande
 * (`board_satisfaction_events.goal_states`, skrevet af boardMandateEngine.js)
 * — lukker afvigelse 4/5/7 ovenfor. `deriveGoalMovements(events)` finder
 * status/met-skift PR. `goal_key` (`boardGoals.js::buildGoalKey`), og
 * `mandate.goals[].id` er nu SELVE `goal_key` i stedet for den tidligere
 * `type-index`-fallback (mål har aldrig haft persisterede id'er). Ingen
 * historik at migrere: 0 rækker med `mandate_id` var skrevet i prod pr. 2/9
 * (motoren skriver først ved fuld aktivering), så feltet er rent
 * fremadrettet — eksisterende/legacy-rækker uden `goal_states` bidrager
 * hverken til bevægelser eller stemning, og falder tilbage til den
 * eksisterende formands-adfærd (se afvigelse 4/5/7).
 */

import { getArchetypeByKey } from "./boardArchetypes.js";
import { BOARD_IDENTITY_RIDER_SELECT } from "./boardConstants.js";
import { generateBoardMemberNames } from "./boardMandateNames.js";
import { resolveGoalOwnerArchetypeKey } from "./boardMembers.js";
import { buildGoalKey, evaluateGoalProgress } from "./boardGoals.js";
import { buildBoardEvalContext, loadGoalContextForBoard } from "./boardGoalContext.js";
// #1237 · nettostilling-hjælpere (activeDebt/wageBillPerSeason) til
// no_outstanding_debt (scoreFinanceHealthGoal, boardUtils.js).
import { sumActiveLoanDebt, sumRiderSalaries } from "./boardUtils.js";
import { sampleVoiceLine, BoardVoiceEmptyBucketError } from "./boardVoice.js";
import { MANDATE_CATEGORIES } from "./boardMandate.js";
import { getActiveConsequencesForTeam, getLayerLabelKey } from "./boardConsequences.js";
import { captureException } from "./sentry.js";

const MINUTES_LIMIT = 10;
const EVENTS_FETCH_LIMIT = 50; // bredere vindue end minutes-loftet, så weekDelta + mood har nok historik
const MOOD_WINDOW = 5;
const WEEK_DELTA_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// #4578 · Rang-orden for goal_states's `status`, brugt af `deriveGoalMovements`
// til at afgøre om et mål er flyttet sig OP eller NED siden sin forrige kendte
// tilstand. `met:true` overtrumfer status og er altid rang 4 (uanset om
// status'en bag et opnået mål tilfældigvis stadig siger "ahead"/"on_track").
// `awaiting_data`/`neutral` (og enhver ukendt status) mapper til `undefined`
// → `null` via `??` → ignoreres helt (hverken bevægelse eller baseline-ændring).
const GOAL_STATUS_RANK = {
  behind: 0,
  watch: 1,
  near_miss: 1,
  on_track: 2,
  ahead: 3,
};

function rankOfGoalState(state) {
  if (!state) return null;
  if (state.met === true) return 4;
  return GOAL_STATUS_RANK[state.status] ?? null;
}

function ensureSupabase(supabase) {
  if (!supabase?.from) throw new Error("Supabase client is required");
}

// reason_category → boardVoice-beat for ÆGTE formands-beats. Milepæls-udfald
// skrives af boardMandateEngine.js's persistMilestoneOutcome (afvigelse 5/7 i
// modul-headeren); "mandate.signed"/"mandate.auto_signed" skrives af
// boardMandateMeeting.js::signMandate (#4557 S-M2c, spec §4.5: "formandens
// meeting_keep-linje som beat") — samme kort giver derfor automatisk et
// friskt formandscitat på Boardroom-payloaden underskrift returnerer.
const CHAIRMAN_BEAT_BY_REASON = {
  "mandate.milestone.achieved": "milestone_achieved",
  "mandate.milestone.achieved_early": "milestone_achieved",
  "mandate.milestone.missed": "milestone_missed",
  "mandate.signed": "meeting_keep",
  "mandate.auto_signed": "meeting_keep",
};

// ---------------------------------------------------------------------------
// Rene, testbare hjælpefunktioner
// ---------------------------------------------------------------------------

/** Chairman → "chair"; ellers arketypens højest-alignede kategori (afvigelse 6). */
export function deriveMemberRole({ archetypeKey, isChairman } = {}) {
  if (isChairman) return "chair";
  const archetype = getArchetypeByKey(archetypeKey);
  const alignment = archetype?.category_alignment || {};
  let best = null;
  for (const category of MANDATE_CATEGORIES) {
    const score = Number(alignment[category] ?? 0);
    if (!best || score > best.score) best = { category, score };
  }
  return best?.category ?? MANDATE_CATEGORIES[0];
}

/**
 * Mapper `evaluateGoalProgress`s status/met-udfald til kontraktens 5-værdi-enum.
 * `mandateStatus` afgør om et ikke-nået mål er "behind" (stadig tid) eller
 * "failed" (mandatet er completed/lapsed, sæsonen er slut).
 */
export function mapGoalEvaluationToStatus({ evaluation, mandateStatus } = {}) {
  if (!evaluation) return "behind";
  if (evaluation.met) return "achieved";
  const isConcluded = mandateStatus === "completed" || mandateStatus === "lapsed";
  if (evaluation.status === "ahead" || evaluation.status === "on_track") {
    return isConcluded ? "failed" : "on_track";
  }
  if (evaluation.status === "near_miss" || evaluation.status === "watch") {
    return isConcluded ? "failed" : "at_risk";
  }
  if (evaluation.status === "behind") {
    return isConcluded ? "failed" : "behind";
  }
  // awaiting_data/neutral (manglende live-data, se afvigelse 2) — en datamangel
  // skal aldrig læses som en falsk alarm, derfor on_track i stedet for et
  // opfundet 6. statustal.
  return isConcluded ? "failed" : "on_track";
}

/** Tal → visningsstreng. Heltal uden decimal, ellers ét decimal. `null` for manglende data. */
export function formatGoalDisplayValue(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const num = Number(value);
  return Number.isInteger(num) ? String(num) : String(Math.round(num * 10) / 10);
}

/**
 * Hvem "taler" for én `board_satisfaction_events`-række i referatet, og med
 * hvilket boardVoice-beat? Se afvigelse 5 i modul-headeren.
 *
 * #4578 · `movements` er kalderens FORUDFILTREREDE liste af
 * `deriveGoalMovements`-bevægelser der hører til DENNE række (`eventId ===
 * row.id`), hver beriget med `ownerArchetypeKey` (mål-nøglens ejer, eller
 * `null` hvis ukendt/ikke persisteret i mandatet) og `goalIndex` (målets
 * position i mandatets `goals[]`, brugt til uafgjort-tiebreak). Findes der
 * mindst én bevægelse MED en kendt ejer, taler ejeren af den bevægelse med
 * størst `|toRank − fromRank|` (uafgjort: laveste `goalIndex`, dvs.
 * mandatets egen mål-rækkefølge) — beat'et følger bevægelsens retning, IKKE
 * rækkens samlede `satisfaction_delta`-fortegn. Milepæls-rækker er ALTID
 * formands-beats, uanset `movements` — tjekket sker FØR movements-grenen.
 * Ingen tilskrivelig bevægelse → uændret formands-fallback (fortegn af
 * `satisfaction_delta`).
 */
export function resolveEventSpeaker({ row, chairmanArchetypeKey, movements = [] } = {}) {
  if (!chairmanArchetypeKey) return null;
  const milestoneBeat = CHAIRMAN_BEAT_BY_REASON[row?.reason_category];
  if (milestoneBeat) {
    return { archetypeKey: chairmanArchetypeKey, beat: milestoneBeat, isChairmanBeat: true };
  }

  const attributableMovements = (movements || [])
    .filter((m) => m?.eventId === row?.id && m?.ownerArchetypeKey);
  if (attributableMovements.length) {
    const best = attributableMovements.reduce((champion, candidate) => {
      const championMagnitude = Math.abs(champion.toRank - champion.fromRank);
      const candidateMagnitude = Math.abs(candidate.toRank - candidate.fromRank);
      if (candidateMagnitude > championMagnitude) return candidate;
      if (candidateMagnitude < championMagnitude) return champion;
      // Uafgjort magnitude: mandatets egen mål-rækkefølge afgør (laveste index vinder).
      const championIndex = champion.goalIndex ?? Number.POSITIVE_INFINITY;
      const candidateIndex = candidate.goalIndex ?? Number.POSITIVE_INFINITY;
      return candidateIndex < championIndex ? candidate : champion;
    });
    return {
      archetypeKey: best.ownerArchetypeKey,
      beat: best.direction === "improved" ? "receipt_positive" : "receipt_negative",
      isChairmanBeat: false,
    };
  }

  const beat = Number(row?.satisfaction_delta ?? 0) < 0 ? "receipt_negative" : "receipt_positive";
  return { archetypeKey: chairmanArchetypeKey, beat, isChairmanBeat: false };
}

/**
 * Stemning pr. medlem (addendum §5): seneste N=5 milepæls-kvitteringer på
 * medlemmets ejede mål → positive/neutral/negative. Kun milepæls-linkede
 * events indgår (afvigelse 7) — `ownedEvents` skal være FORUDFILTRERET og
 * -sorteret (nyeste først) af kalderen.
 */
export function deriveMemberMood({ ownedEvents = [], archetypeKey } = {}) {
  const relevant = (ownedEvents || [])
    .filter((e) => e.ownerArchetypeKey === archetypeKey)
    .slice(0, MOOD_WINDOW);
  if (!relevant.length) return "neutral";
  const sum = relevant.reduce((acc, e) => acc + Number(e.satisfaction_delta ?? 0), 0);
  if (sum > 0) return "positive";
  if (sum < 0) return "negative";
  return "neutral";
}

/**
 * #4578 · Finder "bevægelser" (status/met-skift) pr. mål-nøgle på tværs af
 * `board_satisfaction_events.goal_states`-snapshots. `events` forventes
 * NYESTE-FØRST (samme konvention som resten af filen — boardRoom's egen
 * fetch bruger `.order("created_at", { ascending: false })`); funktionen
 * behandler dem internt ÆLDST→NYEST pr. mål-nøgle, fordi en bevægelse er
 * defineret relativt til målets FORRIGE kendte tilstand.
 *
 * Den FØRSTE gang en `goal_key` optræder er IKKE en bevægelse (der er intet
 * at sammenligne med endnu) — den sætter kun baseline-rangen. Rækker uden
 * `goal_states` (legacy, eller skrevet før #4578) springes helt over: de
 * bidrager hverken til en bevægelse eller til at flytte en mål-nøgles
 * baseline. `awaiting_data`/`neutral`-tilstande (se `rankOfGoalState`)
 * ignoreres på samme måde — en datamangel er hverken en bevægelse eller en
 * ny baseline at sammenligne fremtidige tilstande imod.
 *
 * Returnerer bevægelserne i KRONOLOGISK rækkefølge (ældst → nyest) — den
 * SIDSTE bevægelse for en given `goalKey` i det returnerede array er derfor
 * altid den seneste, hvilket gør "seneste bevægelse pr. mål"-opslag til en
 * simpel sidste-skriv-vinder-reduktion for kaldere.
 */
export function deriveGoalMovements(events = []) {
  const chronological = [...(events || [])].reverse();
  const lastRankByGoalKey = new Map();
  const movements = [];

  for (const row of chronological) {
    const goalStates = Array.isArray(row?.goal_states) ? row.goal_states : null;
    if (!goalStates) continue;

    for (const state of goalStates) {
      const goalKey = state?.goal_key;
      if (!goalKey) continue;
      const rank = rankOfGoalState(state);
      if (rank == null) continue;

      const previousRank = lastRankByGoalKey.get(goalKey);
      if (previousRank != null && previousRank !== rank) {
        movements.push({
          eventId: row.id,
          goalKey,
          at: row.created_at,
          direction: rank > previousRank ? "improved" : "worsened",
          fromRank: previousRank,
          toRank: rank,
        });
      }
      lastRankByGoalKey.set(goalKey, rank);
    }
  }

  return movements;
}

/**
 * Wrapper om `sampleVoiceLine` der degraderer en tom bucket til `null` i
 * stedet for at lade `BoardVoiceEmptyBucketError` boble op og vælte
 * endpointet (design punkt 5 / opgavens arbejdsregler). Enhver ANDEN fejl
 * (ukendt beat/archetypeKey — programmørfejl, ikke en tom bucket) kastes
 * videre uændret.
 *
 * `sampleFn` er injicerbar KUN til test (alle 9 arketyper har i dag fuldt
 * indhold i alle buckets, se boardVoice.js's modul-header — der er derfor
 * ingen ægte tom-bucket-case at ramme med rigtige data i en unit-test).
 * Produktionskode kalder altid med default (den ægte `sampleVoiceLine`).
 */
export function sampleVoiceLineOrNull({ sampleFn = sampleVoiceLine, ...args } = {}) {
  try {
    return sampleFn(args);
  } catch (err) {
    if (err instanceof BoardVoiceEmptyBucketError) return null;
    throw err;
  }
}

/** Værste (højeste-lag) aktive konsekvens → confidence.consequence-linjen. */
export function deriveConsequenceLine(consequences = []) {
  if (!consequences?.length) return { active: false, lineKey: null, lineParams: {} };
  const worst = consequences.reduce((a, b) => (Number(b.layer) > Number(a.layer) ? b : a));
  return { active: true, lineKey: getLayerLabelKey(worst.layer), lineParams: {} };
}

/**
 * Rå mål-felter til frontends kanoniske `getBoardGoalLabel`-resolver
 * (`frontend/src/lib/boardGoalLabel.js`), som læser disse EXAKTE snake_case-
 * navne direkte af goal-objektet. Delt mellem mandate.goals[] og
 * vision.milestones[] — begge kommer fra samme rå mål-form.
 */
export function buildGoalLabelSource(goal = {}) {
  return {
    type: goal?.type ?? null,
    target: goal?.target ?? null,
    label: goal?.label ?? null,
    cumulative: Boolean(goal?.cumulative),
    race_scope: goal?.race_scope ?? null,
    nationality_code: goal?.nationality_code ?? null,
  };
}

/**
 * Team-ancienniteten et hold på boardet fik sin bestyrelse fra: den seneste
 * sæson hvis `start_date` ligger på eller før `teamCreatedAt`. Falder tilbage
 * til den TIDLIGSTE kendte sæson hvis holdet er oprettet før nogen sæsons
 * `start_date` (fx test-/migrations-data), aldrig `null` når mindst én sæson
 * findes. `seasons` behøver ikke være sorteret af kalderen.
 */
export function deriveFoundingSeasonNumber({ teamCreatedAt, seasons = [] } = {}) {
  const sorted = [...(seasons || [])]
    .filter((s) => Number.isFinite(Number(s?.number)))
    .sort((a, b) => Number(a.number) - Number(b.number));
  if (!sorted.length) return null;

  const createdMs = teamCreatedAt ? new Date(teamCreatedAt).getTime() : NaN;
  if (!Number.isFinite(createdMs)) return Number(sorted[0].number);

  let match = sorted[0];
  for (const season of sorted) {
    const startMs = season.start_date ? new Date(season.start_date).getTime() : null;
    if (startMs != null && Number.isFinite(startMs) && startMs <= createdMs) {
      match = season;
    }
  }
  return Number(match.number);
}

/** 'pending' + sæson-sammenligning → kontraktens current/upcoming; achieved/missed går igennem uændret. */
export function deriveMilestoneStatus({ milestone, currentSeasonNumber } = {}) {
  if (milestone?.status === "achieved") return { status: "achieved", isCurrentSeason: false };
  if (milestone?.status === "missed") return { status: "missed", isCurrentSeason: false };
  const target = Number(milestone?.target_season_number);
  const hasCurrent = currentSeasonNumber != null && Number.isFinite(Number(currentSeasonNumber));
  const isCurrentSeason = hasCurrent && target === Number(currentSeasonNumber);
  // Forfaldne-men-ikke-evaluerede milepæle (target < indeværende sæson, endnu
  // ikke behandlet af season-end-syncet) vises som "current" — de er ikke
  // fremtid, og "missed" må kun sættes af selve evalueringen, aldrig gættes
  // her ud fra sæson-tal alene.
  const isUpcoming = hasCurrent && target > Number(currentSeasonNumber);
  return { status: isUpcoming ? "upcoming" : "current", isCurrentSeason };
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

// Ingen `locale`-parameter: payloaden bærer kun i18n-NØGLER (+ params), aldrig
// oversat tekst — oversættelse sker i frontend (`board`-namespace), jf.
// addendummets stemme-kontrakt punkt 4. En locale-parameter her ville være
// død kode indtil endpointet en dag også skal levere serversiderenderet tekst.
export async function buildBoardRoomPayload({
  supabase,
  teamId,
  // #4579 · injicerbar KUN til test (samme mønster som boardWeekendFinalization.js's
  // deps.loadGoalContext) — produktionskode kalder altid med default.
  loadGoalContext = loadGoalContextForBoard,
} = {}) {
  ensureSupabase(supabase);
  if (!teamId) throw new Error("teamId is required");

  const [
    relationRes,
    membersRes,
    mandateRes,
    milestonesRes,
    teamRes,
    seasonRes,
    seasonsListRes,
    standingRes,
    ridersRes,
    loansRes,
    eventsRes,
  ] = await Promise.all([
    supabase.from("board_relations").select("*").eq("team_id", teamId).maybeSingle(),
    supabase.from("team_board_members")
      .select("archetype_key, selection_kind, alignment_score, is_chairman")
      .eq("team_id", teamId),
    supabase.from("board_mandates").select("*").eq("team_id", teamId).eq("status", "active")
      .order("signed_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("board_vision_milestones").select("*").eq("team_id", teamId)
      .order("target_season_number", { ascending: true }),
    // #4579 · sponsor_income tilføjet: buildBoardEvalContext's currentSponsorIncome
    // (sponsor_growth-målets ikke-baseline-halvdel, se boardGoalContext.js).
    // #1237 · balance tilføjet: nettostilling-input til no_outstanding_debt
    // (scoreFinanceHealthGoal).
    supabase.from("teams").select("team_dna_key, created_at, sponsor_income, balance").eq("id", teamId).maybeSingle(),
    supabase.from("seasons").select("id, number").eq("status", "active").maybeSingle(),
    // #4557 (1/9-tillæg) · Hele sæson-listen, kun til board.members[].sinceSeason
    // (deriveFoundingSeasonNumber). Lille tabel (én række pr. sæson) — billig
    // ekstra-query, ikke en ny tabel-afhængighed af betydning.
    supabase.from("seasons").select("number, start_date").order("number", { ascending: true }),
    supabase.from("season_standings").select("*").eq("team_id", teamId)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("riders").select(BOARD_IDENTITY_RIDER_SELECT).eq("team_id", teamId),
    // #1237 · amount_remaining tilføjet (droppet head:true): activeDebt-input til
    // nettostillingen (scoreFinanceHealthGoal).
    supabase.from("loans").select("id, amount_remaining")
      .eq("team_id", teamId).eq("status", "active"),
    // #4578 · goal_states tilføjet: mål-for-mål-snapshottet deriveGoalMovements
    // sammenligner naboer af pr. goal_key (se boardMandateEngine.js).
    // schema-columns-ok: goal_states tilføjes af database/2026-09-02-4578-board-
    // satisfaction-events-goal-states.sql (applies post-merge under #2642); nullable,
    // ingen graceful-fallback nødvendig (kolonnen findes altid efter merge).
    supabase.from("board_satisfaction_events")
      .select("id, race_name, satisfaction_before, satisfaction_after, satisfaction_delta, goals_met, goals_total, reason_category, created_at, mandate_id, milestone_id, goal_states")
      .eq("team_id", teamId)
      .or("mandate_id.not.is.null,milestone_id.not.is.null")
      .order("created_at", { ascending: false })
      .limit(EVENTS_FETCH_LIMIT),
  ]);

  for (const [label, res] of [
    ["board_relations", relationRes],
    ["team_board_members", membersRes],
    ["board_mandates", mandateRes],
    ["board_vision_milestones", milestonesRes],
    ["teams", teamRes],
    ["board_satisfaction_events", eventsRes],
  ]) {
    if (res.error) throw new Error(`${label} lookup failed: ${res.error.message}`);
  }
  // season_standings/riders/loans/seasons-listen er best-effort — et hold uden
  // aktiv sæson-standing (fx helt nyt) skal stadig kunne se sit Boardroom, og
  // en fejlende sæson-liste skal kun koste sinceSeason (null), ikke hele siden.
  const standing = standingRes.error ? null : (standingRes.data ?? null);
  const riders = ridersRes.error ? [] : (ridersRes.data ?? []);
  const activeLoanRows = loansRes.error ? [] : (loansRes.data ?? []);
  const activeLoanCount = activeLoanRows.length;
  // #1237 · nettostilling-input til no_outstanding_debt (scoreFinanceHealthGoal).
  const activeDebt = sumActiveLoanDebt(activeLoanRows);
  const seasonsList = seasonsListRes.error ? [] : (seasonsListRes.data ?? []);

  const relation = relationRes.data ?? null;
  const assignedMembers = membersRes.data ?? [];
  const mandateRow = mandateRes.data ?? null;
  const milestoneRows = milestonesRes.data ?? [];
  const dnaKey = teamRes.data?.team_dna_key ?? null;
  const currentSeasonNumber = seasonRes?.data?.number ?? null;
  const currentSeasonId = seasonRes?.data?.id ?? null;
  const events = eventsRes.data ?? [];
  const sinceSeason = deriveFoundingSeasonNumber({
    teamCreatedAt: teamRes.data?.created_at ?? null,
    seasons: seasonsList,
  });

  const fallbackChairmanKey = assignedMembers.find((m) => m.is_chairman)?.archetype_key
    ?? assignedMembers[0]?.archetype_key
    ?? null;

  // ---- #4578: mål-bevægelser (Last movement/stemning/ejer-stemme i referatet) ----
  // `goalOwnerByKey` slår en `goal_key` op mod mandatets EGNE `goals[]` (samme
  // resolveGoalOwnerArchetypeKey-regel `mandate.goals[]`-loopet bruger nedenfor)
  // — en mål-nøgle uden match i mandatet (fx et bonus-mål lagt på et 1yr-board
  // senere end mandatet blev underskrevet) har ingen kendt ejer og ignoreres.
  // Beregnes UBETINGET (tomt map når der ikke er noget mandat) så movements
  // altid kan berige sig selv, uanset om `mandate` ender null nedenfor.
  const mandateGoalsRaw = Array.isArray(mandateRow?.goals) ? mandateRow.goals : [];
  const goalOwnerByKey = new Map();
  mandateGoalsRaw.forEach((goal, index) => {
    goalOwnerByKey.set(buildGoalKey(goal), {
      ownerArchetypeKey: resolveGoalOwnerArchetypeKey({ goal, assignedMembers, fallbackChairmanKey }),
      goalIndex: index,
    });
  });

  // Kronologisk (ældst→nyest) — se deriveGoalMovements's modul-header. Beriges
  // med ejer + mandatets mål-rækkefølge (tiebreak i resolveEventSpeaker).
  const goalMovements = deriveGoalMovements(events);
  const movementsWithOwner = goalMovements.map((movement) => {
    const owner = goalOwnerByKey.get(movement.goalKey) ?? null;
    return { ...movement, ownerArchetypeKey: owner?.ownerArchetypeKey ?? null, goalIndex: owner?.goalIndex ?? null };
  });
  // Kronologisk kildeliste → sidste-skriv-vinder giver den SENESTE bevægelse
  // pr. mål-nøgle, brugt af mandate.goals[]-loopets receipt.lastMovementAt/Key.
  const lastMovementByGoalKey = new Map();
  for (const movement of goalMovements) lastMovementByGoalKey.set(movement.goalKey, movement);

  const namedMembers = generateBoardMemberNames({
    teamId,
    members: assignedMembers.length ? assignedMembers : (fallbackChairmanKey ? [fallbackChairmanKey] : []),
    dnaKey,
  });
  const namesByArchetype = new Map(namedMembers.map((m) => [m.archetype_key, m]));

  // ---- confidence ----
  let consequences = [];
  try {
    consequences = await getActiveConsequencesForTeam(supabase, teamId);
  } catch (err) {
    captureException(err);
    consequences = [];
  }

  const categoryScores = relation?.category_scores || {};
  const categories = MANDATE_CATEGORIES
    .filter((key) => categoryScores[key] != null)
    .map((key) => ({ key, score: Number(categoryScores[key]) }));

  const now = Date.now();
  const weekDelta = events
    .filter((e) => now - new Date(e.created_at).getTime() <= WEEK_DELTA_WINDOW_MS)
    .reduce((sum, e) => sum + Number(e.satisfaction_delta ?? 0), 0);

  const confidence = {
    value: relation?.confidence ?? null,
    weekDelta: relation ? weekDelta : null,
    updatedAt: relation?.last_event_at ?? relation?.updated_at ?? null,
    categories,
    consequence: deriveConsequenceLine(consequences),
  };

  // ---- board members (chairman + role, mood filled in efter milestone-events) ----
  const milestoneEventsWithOwner = events
    .filter((e) => e.milestone_id)
    .map((e) => {
      const milestone = milestoneRows.find((m) => m.id === e.milestone_id);
      const ownerArchetypeKey = milestone
        ? resolveGoalOwnerArchetypeKey({
          goal: milestone.goal || {},
          assignedMembers,
          fallbackChairmanKey,
        })
        : null;
      return { ...e, ownerArchetypeKey };
    });

  // #4578 · Mål-bevægelser med en kendt ejer bidrager til samme mood-pulje
  // som milepæls-kvitteringerne (improved = +1, worsened = -1, matcher
  // deriveMemberMood's sum-af-fortegn-regel). Slået sammen og sorteret
  // nyeste-først FØR deriveMemberMood's 5-seneste-vindue vælger ud — se
  // afvigelse 7 (lukket) i modul-headeren.
  const movementMoodEvents = movementsWithOwner
    .filter((m) => m.ownerArchetypeKey)
    .map((m) => ({
      ownerArchetypeKey: m.ownerArchetypeKey,
      satisfaction_delta: m.direction === "improved" ? 1 : -1,
      created_at: m.at,
    }));
  const moodEvents = [...milestoneEventsWithOwner, ...movementMoodEvents]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const boardMembers = assignedMembers.map((m) => {
    const named = namesByArchetype.get(m.archetype_key);
    return {
      archetypeKey: m.archetype_key,
      name: named?.full_name ?? null,
      initials: named?.initials ?? null,
      role: deriveMemberRole({ archetypeKey: m.archetype_key, isChairman: m.is_chairman }),
      mood: deriveMemberMood({ ownedEvents: moodEvents, archetypeKey: m.archetype_key }),
      // Samme tal for alle medlemmer i denne runde (ejer-godkendt forenkling,
      // 1/9-tillæg) — se deriveFoundingSeasonNumber.
      sinceSeason,
    };
  });

  // ---- chairmanQuote (seneste ægte formands-beat, ellers null) ----
  let chairmanQuote = null;
  if (fallbackChairmanKey) {
    const latestChairmanEvent = events.find((e) => CHAIRMAN_BEAT_BY_REASON[e.reason_category]);
    if (latestChairmanEvent) {
      const beat = CHAIRMAN_BEAT_BY_REASON[latestChairmanEvent.reason_category];
      const line = sampleVoiceLineOrNull({
        beat,
        archetypeKey: fallbackChairmanKey,
        seed: latestChairmanEvent.id,
        // #4586 · HELE bestyrelses-listen med, så boardVoice's kollisions-
        // salt matcher namesByArchetype (medlemskortene) i stedet for at
        // navngive dette ene medlem isoleret (salt altid 0).
        context: { teamId, dnaKey, members: assignedMembers },
      });
      chairmanQuote = line ? {
        textKey: line.quote_key,
        textParams: {},
        memberName: line.member.navn,
        contextKey: `chairmanBeat.${beat}`,
      } : null;
    }
  }

  // ---- 1yr-board mandatet stammer fra (#4579) ----
  // loadGoalContextForBoard kræver et board_id (til board_plan_snapshots).
  // Primært via mandatets migrations-kilde (planToMandate stempler
  // source.from_board_id, se boardMandate.js); fallback for mandater uden den
  // kilde: holdets seneste 1yr-row. Best-effort — en fejlende opslag logges
  // (captureException) men vælter ALDRIG siden; uden et 1yr-board falder
  // loadGoalContext tilbage til goalContext={} nedenfor.
  let oneYearBoard = null;
  if (mandateRow) {
    const BOARD_PROFILE_SELECT = "id, plan_type, seasons_completed, plan_start_season_number, plan_start_sponsor_income";
    try {
      const fromBoardId = mandateRow.source?.from_board_id ?? null;
      if (fromBoardId) {
        const { data, error } = await supabase.from("board_profiles")
          .select(BOARD_PROFILE_SELECT).eq("id", fromBoardId).maybeSingle();
        if (!error) oneYearBoard = data ?? null;
      }
      if (!oneYearBoard) {
        const { data, error } = await supabase.from("board_profiles")
          .select(BOARD_PROFILE_SELECT).eq("team_id", teamId).eq("plan_type", "1yr").maybeSingle();
        if (!error) oneYearBoard = data ?? null;
      }
    } catch (err) {
      captureException(err);
      oneYearBoard = null;
    }
  }

  // ---- fuld goal-kontekst (#4579) ----
  // Kaldes kun når der ER et mandat OG en aktiv sæson (uden currentSeasonId er
  // der intet at evaluere cumulative-felter imod). Best-effort: fejler
  // loaderen, fortsættes med goalContext={} — mål der kræver de manglende
  // felter falder tilbage til evaluateGoalProgress's egen awaiting_data-gren
  // (se awaitingData nedenfor).
  let goalContext = {};
  if (mandateRow && currentSeasonId) {
    try {
      goalContext = await loadGoalContext({
        supabase,
        teamId,
        boardId: oneYearBoard?.id ?? null,
        currentSeasonId,
        division: standing?.division ?? null,
        // #1608 · pulje-rang: divisionManagerCount skal tælles pr. pulje når
        // holdet er pulje-allokeret (ellers tier-bredt fallback, se boardGoalContext.js).
        leagueDivisionId: standing?.league_division_id ?? null,
        standings: null,
        planStartSeasonNumber: oneYearBoard?.plan_start_season_number ?? mandateRow.season_number ?? null,
      });
    } catch (err) {
      captureException(err);
      goalContext = {};
    }
  }

  // ---- mandate + goals ----
  let mandate = null;
  if (mandateRow) {
    // #4579 · DELT bygger (samme som /board/status, weekend + season-end,
    // #2469-princippet) — boardRoom driftede før fra de andre live-stier via
    // en håndbygget kontekst; nu er der ét sted en ny kontekst-parameter tilføjes.
    const evalContext = buildBoardEvalContext({
      board: oneYearBoard ?? { plan_type: "1yr", seasons_completed: 0 },
      standing,
      activeLoanCount,
      // #1237 · nettostilling til no_outstanding_debt (scoreFinanceHealthGoal).
      balance: teamRes.data?.balance ?? 0,
      activeDebt,
      wageBillPerSeason: sumRiderSalaries(riders),
      currentSponsorIncome: teamRes.data?.sponsor_income ?? null,
      goalContext,
      extra: { assignedMembers },
    });

    const goalsSource = Array.isArray(mandateRow.goals) ? mandateRow.goals : [];
    const goals = goalsSource.map((goal) => {
      const goalKey = buildGoalKey(goal);
      const evaluation = evaluateGoalProgress(goal, standing, { riders }, evalContext);
      const ownerArchetypeKey = resolveGoalOwnerArchetypeKey({
        goal,
        assignedMembers,
        fallbackChairmanKey,
      });
      const ownerName = ownerArchetypeKey ? namesByArchetype.get(ownerArchetypeKey) : null;
      const status = mapGoalEvaluationToStatus({ evaluation, mandateStatus: mandateRow.status });

      // #4578 · Last movement: den SENESTE goal_states-bevægelse for denne
      // mål-nøgle, talt i EJERENS stemme (ikke status-baseret som før — se
      // afvigelse 4, lukket, i modul-headeren). Ingen bevægelse endnu (ny
      // mål-nøgle, eller kun legacy-rækker uden goal_states) → begge felter
      // forbliver null, som frontends GoalReceipt allerede kræver.
      const lastMovement = lastMovementByGoalKey.get(goalKey) ?? null;
      let lastMovementKey = null;
      let lastMovementAt = null;
      if (lastMovement && ownerArchetypeKey) {
        const beat = lastMovement.direction === "improved" ? "receipt_positive" : "receipt_negative";
        const line = sampleVoiceLineOrNull({
          beat,
          archetypeKey: ownerArchetypeKey,
          seed: `${lastMovement.eventId}:${goalKey}`,
          // #4586 · se kommentaren ved chairmanQuote ovenfor.
          context: { teamId, dnaKey, members: assignedMembers },
        });
        lastMovementKey = line?.quote_key ?? null;
        lastMovementAt = lastMovement.at;
      }

      const achievedDisplay = formatGoalDisplayValue(evaluation?.actual);
      const targetDisplay = formatGoalDisplayValue(evaluation?.target ?? goal?.target);

      return {
        // #4578 · goal_key (indholdsbaseret) i stedet for den tidligere
        // type-index-fallback — mål har aldrig haft persisterede id'er.
        id: goalKey,
        // #4557 (1/9-tillæg) · rå felter til frontends getBoardGoalLabel — se
        // buildGoalLabelSource + modul-headeren.
        ...buildGoalLabelSource(goal),
        labelKey: `goalType.${goal?.type ?? "unknown"}`,
        labelParams: {
          target: goal?.target ?? null,
          nationalityCode: goal?.nationality_code ?? null,
          raceScope: goal?.race_scope ?? null,
          cumulative: Boolean(goal?.cumulative),
        },
        achievedDisplay,
        targetDisplay,
        unitKey: null,
        status,
        // #4579 · ægte datamangel (evaluateGoalProgress's awaiting_data, mappet
        // til on_track ovenfor for aldrig at vise en falsk alarm) — frontend kan
        // nu vise "vi mangler data endnu" i stedet for at læse status som reel.
        awaitingData: evaluation?.missing_data === true,
        isStretch: goal?.importance === "bonus",
        owner: ownerArchetypeKey ? {
          archetypeKey: ownerArchetypeKey,
          name: ownerName?.full_name ?? null,
          initials: ownerName?.initials ?? null,
        } : null,
        receipt: {
          countedKey: `goalReceipt.counted.${goal?.type ?? "unknown"}`,
          countedParams: { achieved: achievedDisplay, target: targetDisplay },
          lastMovementKey,
          lastMovementParams: {},
          lastMovementAt,
          weightedByName: ownerName?.full_name ?? null,
          weightedByLineKey: ownerArchetypeKey ? `archetypes.${ownerArchetypeKey}.label` : null,
        },
      };
    });

    mandate = {
      seasonNumber: mandateRow.season_number ?? null,
      signedAt: mandateRow.signed_at ?? null,
      goals,
    };
  }

  // ---- vision ----
  let vision = null;
  if (milestoneRows.length) {
    const targetSeasons = milestoneRows.map((m) => Number(m.target_season_number)).filter(Number.isFinite);
    vision = {
      startSeason: mandateRow?.season_number ?? (targetSeasons.length ? Math.min(...targetSeasons) : null),
      endSeason: targetSeasons.length ? Math.max(...targetSeasons) : null,
      // #4557 (1/9-tillæg) · ren nøgle-afledning, INTET indhold her — frontend
      // forfatter oversættelserne (`vision.title.<dnaKey>`/`.default`).
      titleKey: `vision.title.${dnaKey ?? "default"}`,
      milestones: milestoneRows.map((milestone) => {
        const { status, isCurrentSeason } = deriveMilestoneStatus({ milestone, currentSeasonNumber });
        return {
          id: milestone.id,
          seasonNumber: milestone.target_season_number ?? null,
          // #4557 (1/9-tillæg) · rå felter til frontends getBoardGoalLabel.
          ...buildGoalLabelSource(milestone.goal || {}),
          labelKey: `goalType.${milestone.goal?.type ?? "unknown"}`,
          labelParams: {
            target: milestone.goal?.target ?? null,
            nationalityCode: milestone.goal?.nationality_code ?? null,
            raceScope: milestone.goal?.race_scope ?? null,
            cumulative: Boolean(milestone.goal?.cumulative),
          },
          status,
          isCurrentSeason,
        };
      }),
    };
  }

  // ---- minutes (kvitterings-feed) ----
  const minutes = events.slice(0, MINUTES_LIMIT).map((row) => {
    // #4578 · resolveEventSpeaker filtrerer selv movementsWithOwner ned til
    // denne rækkes eventId — se afvigelse 5 (lukket) i modul-headeren.
    const speaker = resolveEventSpeaker({ row, chairmanArchetypeKey: fallbackChairmanKey, movements: movementsWithOwner });
    let textKey = null;
    let memberName = null;
    if (speaker) {
      const named = namesByArchetype.get(speaker.archetypeKey);
      memberName = named?.full_name ?? null;
      const line = sampleVoiceLineOrNull({
        beat: speaker.beat,
        archetypeKey: speaker.archetypeKey,
        seed: row.id,
        // #4586 · se kommentaren ved chairmanQuote ovenfor.
        context: { teamId, dnaKey, members: assignedMembers },
      });
      if (line) {
        textKey = line.quote_key;
        memberName = line.member.navn;
      }
    }
    return {
      id: row.id,
      delta: row.satisfaction_delta ?? null,
      textKey,
      textParams: { raceName: row.race_name ?? null },
      memberName,
      occurredAt: row.created_at,
    };
  });

  return {
    enabled: true,
    // #4557 (1/9-tillæg) · frontend viser mockup-undertitlen "{formand}, chair
    // · {DNA-label}" ud fra board.members (role=chair) + dette felt.
    team: { dnaKey },
    confidence,
    mandate,
    vision,
    board: { members: boardMembers, chairmanQuote },
    minutes,
  };
}
