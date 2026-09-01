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
 *  2. `mandate.goals[].status`-udregningen bruger en LET kontekst (standing +
 *     riders + aktive lån), IKKE den fulde `loadGoalContextForBoard`-loader
 *     (cumulative monument/jersey/transfer/u25-felter over flere sæsoner).
 *     Mål-typer der kræver den kontekst (monument_podium, jersey_wins
 *     cumulative, profitable_transfers, u25_development_delta,
 *     domestic_dominance, relative_rank) evaluerer derfor til
 *     `evaluateGoalProgress`s `awaiting_data`, som her mappes til `on_track`
 *     (se `mapGoalEvaluationToStatus`) i stedet for at opfinde et 6. statustal.
 *  3. `mandate.goals[].unitKey` er altid `null` — der findes ikke et etableret
 *     enheds-nøgle-system for mål-typer i dag.
 *  4. `mandate.goals[].receipt.lastMovementAt`/`lastMovementParams` er altid
 *     `null`/`{}` — `board_satisfaction_events` linker IKKE til enkelte mål,
 *     kun til mandatet (aggregeret weekend/season-delta) eller en milepæl.
 *     "Sidste bevægelse" pr. mål findes derfor ikke i datamodellen endnu.
 *  5. `minutes[]`-rækker uden `milestone_id` (dvs. `weekend_update`/`season_end`
 *     mandat-niveau kvitteringer) er IKKE knyttet til ét enkelt mål og kan derfor
 *     ikke tale i "målets ejers stemme" (addendum punkt 2). De falder tilbage til
 *     FORMANDEN med `receipt_positive`/`receipt_negative` ud fra fortegnet på
 *     `satisfaction_delta`. Kun milepæls-afgørelser (`mandate.milestone.*`) er
 *     ægte formands-beats i addendummets forstand.
 *  6. `board.members[].role` er en AFLEDT visning (chairman → "chair", ellers
 *     arketypens højeste `category_alignment`-kategori) — `role` er ikke et
 *     persisteret felt på `team_board_members`.
 *  7. `board.members[].mood` afledes KUN af milepæls-linkede kvitteringer
 *     (`board_vision_milestones` via `board_satisfaction_events.milestone_id`),
 *     fordi mandat-niveau weekend/season-kvitteringer (se punkt 5) ikke er
 *     knyttet til ét mål og derfor ikke entydigt kan tilskrives ét medlem.
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
 */

import { getArchetypeByKey } from "./boardArchetypes.js";
import { BOARD_IDENTITY_RIDER_SELECT } from "./boardConstants.js";
import { generateBoardMemberNames } from "./boardMandateNames.js";
import { resolveGoalOwnerArchetypeKey } from "./boardMembers.js";
import { evaluateGoalProgress } from "./boardGoals.js";
import { sampleVoiceLine, BoardVoiceEmptyBucketError } from "./boardVoice.js";
import { MANDATE_CATEGORIES } from "./boardMandate.js";
import { getActiveConsequencesForTeam, getLayerLabelKey } from "./boardConsequences.js";
import { captureException } from "./sentry.js";

const MINUTES_LIMIT = 10;
const EVENTS_FETCH_LIMIT = 50; // bredere vindue end minutes-loftet, så weekDelta + mood har nok historik
const MOOD_WINDOW = 5;
const WEEK_DELTA_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function ensureSupabase(supabase) {
  if (!supabase?.from) throw new Error("Supabase client is required");
}

// Milepæls-udfaldets reason_category (skrevet af boardMandateEngine.js's
// persistMilestoneOutcome) → boardVoice-beat. Kun disse to er ægte
// formands-beats i den nuværende datamodel (afvigelse 5/7 i modul-headeren).
const MILESTONE_BEAT_BY_REASON = {
  "mandate.milestone.achieved": "milestone_achieved",
  "mandate.milestone.achieved_early": "milestone_achieved",
  "mandate.milestone.missed": "milestone_missed",
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
 */
export function resolveEventSpeaker({ row, chairmanArchetypeKey } = {}) {
  if (!chairmanArchetypeKey) return null;
  const milestoneBeat = MILESTONE_BEAT_BY_REASON[row?.reason_category];
  if (milestoneBeat) {
    return { archetypeKey: chairmanArchetypeKey, beat: milestoneBeat, isChairmanBeat: true };
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
export async function buildBoardRoomPayload({ supabase, teamId } = {}) {
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
    supabase.from("teams").select("team_dna_key, created_at").eq("id", teamId).maybeSingle(),
    supabase.from("seasons").select("id, number").eq("status", "active").maybeSingle(),
    // #4557 (1/9-tillæg) · Hele sæson-listen, kun til board.members[].sinceSeason
    // (deriveFoundingSeasonNumber). Lille tabel (én række pr. sæson) — billig
    // ekstra-query, ikke en ny tabel-afhængighed af betydning.
    supabase.from("seasons").select("number, start_date").order("number", { ascending: true }),
    supabase.from("season_standings").select("*").eq("team_id", teamId)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("riders").select(BOARD_IDENTITY_RIDER_SELECT).eq("team_id", teamId),
    supabase.from("loans").select("id", { count: "exact", head: true })
      .eq("team_id", teamId).eq("status", "active"),
    supabase.from("board_satisfaction_events")
      .select("id, race_name, satisfaction_before, satisfaction_after, satisfaction_delta, goals_met, goals_total, reason_category, created_at, mandate_id, milestone_id")
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
  const activeLoanCount = loansRes.error ? 0 : (loansRes.count || 0);
  const seasonsList = seasonsListRes.error ? [] : (seasonsListRes.data ?? []);

  const relation = relationRes.data ?? null;
  const assignedMembers = membersRes.data ?? [];
  const mandateRow = mandateRes.data ?? null;
  const milestoneRows = milestonesRes.data ?? [];
  const dnaKey = teamRes.data?.team_dna_key ?? null;
  const currentSeasonNumber = seasonRes?.data?.number ?? null;
  const events = eventsRes.data ?? [];
  const sinceSeason = deriveFoundingSeasonNumber({
    teamCreatedAt: teamRes.data?.created_at ?? null,
    seasons: seasonsList,
  });

  const fallbackChairmanKey = assignedMembers.find((m) => m.is_chairman)?.archetype_key
    ?? assignedMembers[0]?.archetype_key
    ?? null;

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

  const boardMembers = assignedMembers.map((m) => {
    const named = namesByArchetype.get(m.archetype_key);
    return {
      archetypeKey: m.archetype_key,
      name: named?.full_name ?? null,
      initials: named?.initials ?? null,
      role: deriveMemberRole({ archetypeKey: m.archetype_key, isChairman: m.is_chairman }),
      mood: deriveMemberMood({ ownedEvents: milestoneEventsWithOwner, archetypeKey: m.archetype_key }),
      // Samme tal for alle medlemmer i denne runde (ejer-godkendt forenkling,
      // 1/9-tillæg) — se deriveFoundingSeasonNumber.
      sinceSeason,
    };
  });

  // ---- chairmanQuote (seneste ægte formands-beat, ellers null) ----
  let chairmanQuote = null;
  if (fallbackChairmanKey) {
    const latestChairmanEvent = events.find((e) => MILESTONE_BEAT_BY_REASON[e.reason_category]);
    if (latestChairmanEvent) {
      const beat = MILESTONE_BEAT_BY_REASON[latestChairmanEvent.reason_category];
      const line = sampleVoiceLineOrNull({
        beat,
        archetypeKey: fallbackChairmanKey,
        seed: latestChairmanEvent.id,
        context: { teamId, dnaKey },
      });
      chairmanQuote = line ? {
        textKey: line.quote_key,
        textParams: {},
        memberName: line.member.navn,
        contextKey: `chairmanBeat.${beat}`,
      } : null;
    }
  }

  // ---- mandate + goals ----
  let mandate = null;
  if (mandateRow) {
    const goalEvalContext = {
      planDuration: 1,
      seasonsCompleted: 1,
      isFinalSeason: true,
      activeLoanCount,
      cumulativeStats: { stageWins: 0, gcWins: 0 },
      assignedMembers,
    };

    const goalsSource = Array.isArray(mandateRow.goals) ? mandateRow.goals : [];
    const goals = goalsSource.map((goal, index) => {
      const evaluation = evaluateGoalProgress(goal, standing, { riders }, goalEvalContext);
      const ownerArchetypeKey = resolveGoalOwnerArchetypeKey({
        goal,
        assignedMembers,
        fallbackChairmanKey,
      });
      const ownerName = ownerArchetypeKey ? namesByArchetype.get(ownerArchetypeKey) : null;
      const status = mapGoalEvaluationToStatus({ evaluation, mandateStatus: mandateRow.status });

      let receiptQuoteKey = null;
      if (ownerArchetypeKey && (status === "achieved" || status === "at_risk" || status === "behind" || status === "failed")) {
        const beat = status === "achieved" ? "receipt_positive" : "receipt_negative";
        const line = sampleVoiceLineOrNull({
          beat,
          archetypeKey: ownerArchetypeKey,
          seed: `${mandateRow.id}:${goal.id ?? goal.type ?? index}:${beat}`,
          context: { teamId, dnaKey },
        });
        receiptQuoteKey = line?.quote_key ?? null;
      }

      const achievedDisplay = formatGoalDisplayValue(evaluation?.actual);
      const targetDisplay = formatGoalDisplayValue(evaluation?.target ?? goal?.target);

      return {
        id: goal?.id ?? `${goal?.type ?? "goal"}-${index}`,
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
        isStretch: goal?.importance === "bonus",
        owner: ownerArchetypeKey ? {
          archetypeKey: ownerArchetypeKey,
          name: ownerName?.full_name ?? null,
          initials: ownerName?.initials ?? null,
        } : null,
        receipt: {
          countedKey: `goalReceipt.counted.${goal?.type ?? "unknown"}`,
          countedParams: { achieved: achievedDisplay, target: targetDisplay },
          lastMovementKey: receiptQuoteKey,
          lastMovementParams: {},
          lastMovementAt: null,
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
    const speaker = resolveEventSpeaker({ row, chairmanArchetypeKey: fallbackChairmanKey });
    let textKey = null;
    let memberName = null;
    if (speaker) {
      const named = namesByArchetype.get(speaker.archetypeKey);
      memberName = named?.full_name ?? null;
      const line = sampleVoiceLineOrNull({
        beat: speaker.beat,
        archetypeKey: speaker.archetypeKey,
        seed: row.id,
        context: { teamId, dnaKey },
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
