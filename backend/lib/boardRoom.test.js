import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBoardRoomPayload,
  buildGoalLabelSource,
  deriveConsequenceLine,
  deriveFoundingSeasonNumber,
  deriveMemberMood,
  deriveMemberRole,
  deriveMilestoneStatus,
  formatGoalDisplayValue,
  mapGoalEvaluationToStatus,
  resolveEventSpeaker,
  sampleVoiceLineOrNull,
} from "./boardRoom.js";
import { BoardVoiceEmptyBucketError } from "./boardVoice.js";
import { generateBoardMemberNames } from "./boardMandateNames.js";
import { BOARD_ARCHETYPE_KEYS } from "./boardArchetypes.js";

// #3514/#4557 S-M2b · boardRoom.js-kontrakten. Se modul-headeren i boardRoom.js
// for den fulde liste af rapporterede afvigelser fra Boardroom-kontrakten.

// ── Fake-supabase, samme mønster som boardMandateEngine.test.js ───────────────
// En generisk query-builder: .eq()/.order()/.limit() filtrerer/sorterer en kopi
// af tabellens rækker; .maybeSingle()/.single() henter første række, ellers
// resolver builderen selv (thenable) til en liste — samme to former routen og
// aggregatoren rent faktisk bruger.
function makeQueryBuilder(rows, { count = false } = {}) {
  let filtered = [...rows];
  const builder = {
    eq(col, value) {
      filtered = filtered.filter((r) => r[col] === value);
      return builder;
    },
    or() {
      // Testfixtures opfylder allerede invarianten (mandate_id ELLER
      // milestone_id sat) — .or() er et no-op i mock'en.
      return builder;
    },
    order(col, opts = {}) {
      const ascending = opts.ascending !== false;
      filtered = [...filtered].sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return ascending ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
      });
      return builder;
    },
    limit(n) {
      filtered = filtered.slice(0, n);
      return builder;
    },
    maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
    single: async () => (filtered[0]
      ? { data: filtered[0], error: null }
      : { data: null, error: { code: "PGRST116" } }),
    then(resolve, reject) {
      const result = count
        ? { data: null, error: null, count: filtered.length }
        : { data: filtered, error: null };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}

function makeSupabase(tables) {
  return {
    from(table) {
      const rows = tables[table] || [];
      return {
        select: (_cols, opts) => makeQueryBuilder(rows, { count: Boolean(opts?.count) }),
      };
    },
  };
}

const TEAM_ID = "team-1";

function baseTables(overrides = {}) {
  return {
    board_relations: [],
    team_board_members: [],
    board_mandates: [],
    board_vision_milestones: [],
    teams: [{ id: TEAM_ID, team_dna_key: null, created_at: "2026-08-15T00:00:00Z" }],
    seasons: [
      { id: "s1", number: 1, status: "completed", start_date: "2026-05-08T00:00:00Z" },
      { id: "s2", number: 2, status: "completed", start_date: "2026-06-19T00:00:00Z" },
      { id: "s3", number: 3, status: "active", start_date: "2026-07-31T00:00:00Z" },
    ],
    season_standings: [],
    riders: [],
    loans: [],
    board_satisfaction_events: [],
    board_consequences: [],
    // #4579 · det 1yr-board mandatet stammer fra (buildBoardRoomPayload slår
    // det op best-effort via mandateRow.source.from_board_id, fallback
    // team_id+plan_type='1yr'). Tom i de fleste fixtures — testene for de nye
    // mål-typer stubber loadGoalContext direkte i stedet for at gå gennem den
    // rigtige loader, så denne tabel er kun relevant for boardId-argument-testen.
    board_profiles: [],
    ...overrides,
  };
}

const FIVE_MEMBERS = [
  { team_id: TEAM_ID, archetype_key: "sponsoraten", selection_kind: "identity", alignment_score: 3, is_chairman: true },
  { team_id: TEAM_ID, archetype_key: "resultatjaegeren", selection_kind: "identity", alignment_score: 2, is_chairman: false },
  { team_id: TEAM_ID, archetype_key: "talentspejderen", selection_kind: "identity", alignment_score: 2, is_chairman: false },
  { team_id: TEAM_ID, archetype_key: "traditionalisten", selection_kind: "wildcard", alignment_score: 1, is_chairman: false },
  { team_id: TEAM_ID, archetype_key: "pragmatikeren", selection_kind: "wildcard", alignment_score: 1, is_chairman: false },
];

// ── flag off dækkes af route'en (GET /board/room), ikke af dette modul —
// buildBoardRoomPayload antager altid enabled:true (route'en tjekker flaget
// FØR den kalder aggregatoren, se boardRoom.js-headeren + api.js).

test("tomme skygge-tabeller: enabled:true, mandate:null, vision:null, tom minutes (ingen crash)", async () => {
  const supabase = makeSupabase(baseTables());
  const payload = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID });

  assert.equal(payload.enabled, true);
  assert.equal(payload.mandate, null);
  assert.equal(payload.vision, null);
  assert.deepEqual(payload.minutes, []);
  assert.deepEqual(payload.board.members, []);
  assert.equal(payload.board.chairmanQuote, null);
  assert.equal(payload.confidence.value, null);
  assert.equal(payload.confidence.weekDelta, null);
  assert.deepEqual(payload.confidence.categories, []);
  assert.deepEqual(payload.confidence.consequence, { active: false, lineKey: null, lineParams: {} });
});

test("mandate med mål der IKKE har owner_archetype_key persisteret falder tilbage til kategori-alignment", async () => {
  const tables = baseTables({
    board_relations: [{
      id: "rel-1", team_id: TEAM_ID, confidence: 62,
      category_scores: { results: 70, economy: 55 },
      last_event_at: "2026-08-20T10:00:00Z",
    }],
    team_board_members: FIVE_MEMBERS,
    board_mandates: [{
      id: "mand-1", team_id: TEAM_ID, season_number: 3, status: "active",
      signed_at: "2026-08-01T00:00:00Z",
      // Intet owner_archetype_key — skal afledes læse-tid (aldrig gen-stemplet).
      goals: [{ type: "min_riders", target: 20, category: "economy", importance: "required" }],
    }],
  });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID });

  assert.ok(payload.mandate);
  assert.equal(payload.mandate.goals.length, 1);
  const goal = payload.mandate.goals[0];
  // economy-kategorien er stærkest alignet med sponsoraten (som også er chairman
  // her) — den rene resolveGoalOwnerArchetypeKey-regel, ikke re-stemplet på målet.
  assert.equal(goal.owner.archetypeKey, "sponsoraten");
  assert.equal(goal.labelKey, "goalType.min_riders");
  assert.ok(["on_track", "at_risk", "behind", "achieved", "failed"].includes(goal.status));
});

test("mandat-mål med PERSISTERET owner_archetype_key bruges uændret, ingen genudregning", async () => {
  const tables = baseTables({
    board_relations: [{ id: "rel-1", team_id: TEAM_ID, confidence: 50, category_scores: {} }],
    team_board_members: FIVE_MEMBERS,
    board_mandates: [{
      id: "mand-1", team_id: TEAM_ID, season_number: 3, status: "active", signed_at: null,
      goals: [{
        type: "min_riders", target: 20, category: "results",
        // Bevidst "forkert" ift. kategori-alignment (results ville normalt pege
        // på resultatjaegeren) — det persisterede felt vinder ALTID.
        owner_archetype_key: "traditionalisten",
      }],
    }],
  });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID });
  assert.equal(payload.mandate.goals[0].owner.archetypeKey, "traditionalisten");
});

test("vision: milepæle uden mandat-row (mandate:null) vises stadig", async () => {
  const tables = baseTables({
    team_board_members: FIVE_MEMBERS,
    board_vision_milestones: [
      { id: "ms-1", team_id: TEAM_ID, milestone_key: "k1", goal: { type: "gc_wins", target: 2 }, target_season_number: 3, status: "pending" },
      { id: "ms-2", team_id: TEAM_ID, milestone_key: "k2", goal: { type: "gc_wins", target: 3 }, target_season_number: 5, status: "achieved" },
    ],
  });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID });

  assert.equal(payload.mandate, null);
  assert.ok(payload.vision);
  assert.equal(payload.vision.endSeason, 5);
  const [ms1, ms2] = payload.vision.milestones;
  assert.equal(ms1.status, "current");
  assert.equal(ms1.isCurrentSeason, true);
  assert.equal(ms2.status, "achieved");
});

test("minutes: milepæls-udfald attribueres til FORMANDEN (chairman-beat), ikke målets ejer", async () => {
  const tables = baseTables({
    team_board_members: FIVE_MEMBERS,
    board_vision_milestones: [
      { id: "ms-1", team_id: TEAM_ID, milestone_key: "k1", goal: { type: "gc_wins", target: 2, category: "results" }, target_season_number: 3, status: "achieved" },
    ],
    board_satisfaction_events: [
      {
        id: "evt-1", team_id: TEAM_ID, mandate_id: null, milestone_id: "ms-1",
        satisfaction_delta: 8, reason_category: "mandate.milestone.achieved",
        created_at: "2026-08-25T00:00:00Z", race_name: null,
      },
    ],
  });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID });

  assert.equal(payload.minutes.length, 1);
  const row = payload.minutes[0];
  assert.equal(row.delta, 8);
  // Chairman = sponsoraten i FIVE_MEMBERS-fixturen.
  assert.match(row.textKey, /^archetypes\.sponsoraten\.reactions\.milestone_achieved\.\d+$/);
});

test("weekend/season-end-rækker (kun mandate_id) falder tilbage til chairman receipt_positive/negative", async () => {
  const tables = baseTables({
    team_board_members: FIVE_MEMBERS,
    board_mandates: [{ id: "mand-1", team_id: TEAM_ID, season_number: 3, status: "active", goals: [] }],
    board_satisfaction_events: [
      { id: "evt-1", team_id: TEAM_ID, mandate_id: "mand-1", milestone_id: null, satisfaction_delta: 3, reason_category: "weekend_update", created_at: "2026-08-26T00:00:00Z", race_name: "Race A" },
      { id: "evt-2", team_id: TEAM_ID, mandate_id: "mand-1", milestone_id: null, satisfaction_delta: -2, reason_category: "season_end", created_at: "2026-08-25T00:00:00Z", race_name: null },
    ],
  });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID });

  assert.equal(payload.minutes.length, 2);
  assert.match(payload.minutes[0].textKey, /reactions\.receipt_positive\./);
  assert.match(payload.minutes[1].textKey, /reactions\.receipt_negative\./);
});

test("stemning pr. medlem afledes KUN af milepæls-linkede kvitteringer på medlemmets ejede mål", async () => {
  const tables = baseTables({
    team_board_members: FIVE_MEMBERS,
    board_vision_milestones: [
      { id: "ms-1", team_id: TEAM_ID, milestone_key: "k1", goal: { type: "min_riders", target: 20, owner_archetype_key: "traditionalisten" }, target_season_number: 3, status: "achieved" },
    ],
    board_satisfaction_events: [
      { id: "evt-1", team_id: TEAM_ID, mandate_id: null, milestone_id: "ms-1", satisfaction_delta: 6, reason_category: "mandate.milestone.achieved", created_at: "2026-08-20T00:00:00Z" },
      // Mandat-niveau (ikke milestone-linket) — tæller IKKE med i mood.
      { id: "evt-2", team_id: TEAM_ID, mandate_id: "mand-1", milestone_id: null, satisfaction_delta: -50, reason_category: "weekend_update", created_at: "2026-08-21T00:00:00Z" },
    ],
  });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID });

  const traditionalisten = payload.board.members.find((m) => m.archetypeKey === "traditionalisten");
  const pragmatikeren = payload.board.members.find((m) => m.archetypeKey === "pragmatikeren");
  assert.equal(traditionalisten.mood, "positive");
  // Intet milepæls-event ejet af pragmatikeren → neutral default, uanset det
  // store negative mandat-niveau-event (som ikke er knyttet til ét mål).
  assert.equal(pragmatikeren.mood, "neutral");
});

test("aktiv konsekvens sætter confidence.consequence.active + lineKey fra det VÆRSTE lag", async () => {
  const tables = baseTables({
    board_relations: [{ id: "rel-1", team_id: TEAM_ID, confidence: 12, category_scores: {} }],
    board_consequences: [
      { id: "c1", team_id: TEAM_ID, status: "active", layer: 3 },
      { id: "c2", team_id: TEAM_ID, status: "active", layer: 5 },
    ],
  });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID });

  assert.equal(payload.confidence.consequence.active, true);
  assert.equal(payload.confidence.consequence.lineKey, "consequence.layer.sponsorPullout");
});

// ── #4586: navne-konsistens mellem medlemskort og citater ─────────────────────
//
// Brute-forcet kollisions-fixture (samme som boardVoice.test.js): ved
// (teamId: "team-1" = denne fils TEAM_ID, dnaKey: "skandinavisk_udvikling")
// kolliderer "pragmatikeren"s basisnavn med et andet medlems, så
// generateBoardMemberNames giver "pragmatikeren" salt > 0 når HELE
// bestyrelsen navngives samlet (namesByArchetype-kortene). Før #4586 kaldte
// sampleVoiceLine ind med ét medlem ad gangen (salt altid 0), så
// chairmanQuote.memberName/minutes[].memberName kunne hedde noget ANDET end
// board.members[].name for samme person. `resolveEventSpeaker` peger citat-
// og kvitterings-stemmen på formanden, så testen sætter "pragmatikeren" som
// formand for at ramme netop den kolliderede arketype begge steder.

const COLLISION_DNA_KEY = "skandinavisk_udvikling"; // TEAM_ID ("team-1") er allerede kollisions-teamet.
const COLLISION_CHAIRMAN_KEY = "pragmatikeren";
const COLLISION_MEMBERS = [
  { team_id: TEAM_ID, archetype_key: "sponsoraten", selection_kind: "identity", alignment_score: 3, is_chairman: false },
  { team_id: TEAM_ID, archetype_key: "resultatjaegeren", selection_kind: "identity", alignment_score: 2, is_chairman: false },
  { team_id: TEAM_ID, archetype_key: "talentspejderen", selection_kind: "identity", alignment_score: 2, is_chairman: false },
  { team_id: TEAM_ID, archetype_key: "traditionalisten", selection_kind: "wildcard", alignment_score: 1, is_chairman: false },
  { team_id: TEAM_ID, archetype_key: COLLISION_CHAIRMAN_KEY, selection_kind: "wildcard", alignment_score: 1, is_chairman: true },
];

test("#4586: board.members[].name, chairmanQuote.memberName og minutes[].memberName er ÉT og samme navn for den kolliderede arketype", async () => {
  // Egen-verificeret forudsætning (se boardVoice.test.js): den saltede
  // liste-navngivning for pragmatikeren er FAKTISK forskellig fra en
  // enkelt-medlems-navngivning i denne fixture, ellers beviser testen intet.
  const listNamed = generateBoardMemberNames({
    teamId: TEAM_ID,
    members: BOARD_ARCHETYPE_KEYS.slice(0, 5),
    dnaKey: COLLISION_DNA_KEY,
  });
  const [singleNamed] = generateBoardMemberNames({
    teamId: TEAM_ID,
    members: [COLLISION_CHAIRMAN_KEY],
    dnaKey: COLLISION_DNA_KEY,
  });
  const expectedName = listNamed.find((m) => m.archetype_key === COLLISION_CHAIRMAN_KEY).full_name;
  assert.notEqual(expectedName, singleNamed.full_name, "fixturen skal reelt indeholde en salt-kollision");

  const tables = baseTables({
    teams: [{ id: TEAM_ID, team_dna_key: COLLISION_DNA_KEY, created_at: "2026-08-15T00:00:00Z" }],
    team_board_members: COLLISION_MEMBERS,
    board_vision_milestones: [
      { id: "ms-1", team_id: TEAM_ID, milestone_key: "k1", goal: { type: "gc_wins", target: 2, category: "results" }, target_season_number: 3, status: "achieved" },
    ],
    board_satisfaction_events: [
      {
        id: "evt-1", team_id: TEAM_ID, mandate_id: null, milestone_id: "ms-1",
        satisfaction_delta: 8, reason_category: "mandate.milestone.achieved",
        created_at: "2026-08-25T00:00:00Z", race_name: null,
      },
    ],
  });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID });

  const memberCard = payload.board.members.find((m) => m.archetypeKey === COLLISION_CHAIRMAN_KEY);
  assert.equal(memberCard.name, expectedName);
  assert.equal(payload.board.chairmanQuote.memberName, expectedName);
  assert.equal(payload.minutes.length, 1);
  assert.equal(payload.minutes[0].memberName, expectedName);

  // Og dermed IKKE den forkerte (usaltede) enkelt-medlems-navngivning nogen
  // af de tre steder — det er selve regressions-beviset for #4586.
  assert.notEqual(payload.board.chairmanQuote.memberName, singleNamed.full_name);
  assert.notEqual(payload.minutes[0].memberName, singleNamed.full_name);
});

// ── 1/9-tillæg (orkestrator-afstemning mod frontend-PR #4569) ─────────────────

test("mandate.goals[] og vision.milestones[] bærer rå mål-felter til frontends getBoardGoalLabel", async () => {
  const tables = baseTables({
    team_board_members: FIVE_MEMBERS,
    board_mandates: [{
      id: "mand-1", team_id: TEAM_ID, season_number: 3, status: "active", signed_at: null,
      goals: [{
        type: "monument_podium", target: 2, label: "Top-3 i mindst 2 Monuments-loeb",
        cumulative: false, race_scope: "classics", category: "results",
      }],
    }],
    board_vision_milestones: [
      { id: "ms-1", team_id: TEAM_ID, milestone_key: "k1", target_season_number: 5, status: "pending",
        goal: { type: "min_national_riders", target: 3, label: "Min. 3 ryttere fra DNK", nationality_code: "DNK" } },
    ],
  });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID });

  const goal = payload.mandate.goals[0];
  assert.equal(goal.type, "monument_podium");
  assert.equal(goal.target, 2);
  assert.equal(goal.label, "Top-3 i mindst 2 Monuments-loeb");
  assert.equal(goal.cumulative, false);
  assert.equal(goal.race_scope, "classics");
  assert.equal(goal.nationality_code, null);
  // labelKey/labelParams bevares som separat fallback.
  assert.equal(goal.labelKey, "goalType.monument_podium");

  const milestone = payload.vision.milestones[0];
  assert.equal(milestone.type, "min_national_riders");
  assert.equal(milestone.target, 3);
  assert.equal(milestone.nationality_code, "DNK");
  assert.equal(milestone.label, "Min. 3 ryttere fra DNK");
});

test("top-level team.dnaKey + vision.titleKey afledt af holdets DNA", async () => {
  const tables = baseTables({
    teams: [{ id: TEAM_ID, team_dna_key: "sprint_kommerciel", created_at: "2026-08-15T00:00:00Z" }],
    board_vision_milestones: [
      { id: "ms-1", team_id: TEAM_ID, milestone_key: "k1", target_season_number: 5, status: "pending", goal: { type: "gc_wins", target: 2 } },
    ],
  });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID });

  assert.deepEqual(payload.team, { dnaKey: "sprint_kommerciel" });
  assert.equal(payload.vision.titleKey, "vision.title.sprint_kommerciel");
});

test("vision.titleKey falder tilbage til .default uden dnaKey", async () => {
  const tables = baseTables({
    board_vision_milestones: [
      { id: "ms-1", team_id: TEAM_ID, milestone_key: "k1", target_season_number: 5, status: "pending", goal: { type: "gc_wins", target: 2 } },
    ],
  });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID });
  assert.equal(payload.vision.titleKey, "vision.title.default");
});

test("board.members[].sinceSeason afledes af teams.created_at mod seasons.start_date (samme tal for alle medlemmer)", async () => {
  const tables = baseTables({ team_board_members: FIVE_MEMBERS });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID });

  // Fixture: teams.created_at = 2026-08-15, sæson 3 startede 2026-07-31 (seneste
  // sæson hvis start_date <= created_at) -> sinceSeason = 3 for alle 5 medlemmer.
  assert.equal(payload.board.members.length, 5);
  for (const member of payload.board.members) {
    assert.equal(member.sinceSeason, 3);
  }
});

// ── #4579: mandate.goals[].status bruger nu FULD goal-kontekst ────────────────
//
// Før #4579 evaluerede boardRoom.js ALTID med en håndbygget LET kontekst
// (planDuration 1, cumulativeStats 0/0 hardkodet, INGEN divisionManagerCount/
// cumulative*/planStart*-felter). Mål-typer der kræver den fulde kontekst
// evaluerede derfor altid til `evaluateGoalProgress`s awaiting_data (mappet
// til on_track — en falsk "on track", ikke en ærlig datamangel). Hver test
// herunder stubber `loadGoalContext` (den nye injicerbare parameter) med
// netop de felter mål-typen kræver og assert'er den REELLE status — ikke
// on_track-af-datamangel — plus `awaitingData: false`.

function tablesWithSingleGoal(goal, overrides = {}) {
  return baseTables({
    team_board_members: FIVE_MEMBERS,
    board_mandates: [{
      id: "mand-4579", team_id: TEAM_ID, season_number: 3, status: "active",
      signed_at: "2026-08-01T00:00:00Z",
      goals: [goal],
    }],
    ...overrides,
  });
}

async function payloadForGoal(goal, { loadGoalContext = async () => ({}), ...overrides } = {}) {
  const supabase = makeSupabase(tablesWithSingleGoal(goal, overrides));
  const payload = await buildBoardRoomPayload({ supabase, teamId: TEAM_ID, loadGoalContext });
  return payload.mandate.goals[0];
}

test("#4579 top_n_finish: reel status fra standing.rank_in_division (ikke awaiting_data)", async () => {
  const goal = await payloadForGoal(
    { type: "top_n_finish", target: 3, category: "results" },
    { season_standings: [{ team_id: TEAM_ID, rank_in_division: 2, updated_at: "2026-08-20T00:00:00Z" }] },
  );
  assert.equal(goal.status, "achieved");
  assert.equal(goal.awaitingData, false);
});

test("#4579 stage_wins (ikke-kumulativ): reel status fra standing.stage_wins", async () => {
  const goal = await payloadForGoal(
    { type: "stage_wins", target: 2, cumulative: false, category: "results" },
    { season_standings: [{ team_id: TEAM_ID, stage_wins: 3, updated_at: "2026-08-20T00:00:00Z" }] },
  );
  assert.equal(goal.status, "achieved");
  assert.equal(goal.awaitingData, false);
});

test("#4579 stage_wins (ikke-kumulativ) tæller seasonOneDayWins med (#4034-paritet)", async () => {
  // 1 (etapesejr) + 2 (endagssejre, stubbet) = 3 >= target 3.
  const tables = tablesWithSingleGoal(
    { type: "stage_wins", target: 3, cumulative: false, category: "results" },
    { season_standings: [{ team_id: TEAM_ID, stage_wins: 1, updated_at: "2026-08-20T00:00:00Z" }] },
  );
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({
    supabase, teamId: TEAM_ID,
    loadGoalContext: async () => ({ seasonOneDayWins: 2 }),
  });
  const goal = payload.mandate.goals[0];
  assert.equal(goal.status, "achieved");
  assert.equal(goal.awaitingData, false);
  assert.equal(goal.achievedDisplay, "3");
});

test("#4579 gc_wins (ikke-kumulativ): reel status fra standing.gc_wins", async () => {
  const goal = await payloadForGoal(
    { type: "gc_wins", target: 1, cumulative: false, category: "results" },
    { season_standings: [{ team_id: TEAM_ID, gc_wins: 0, updated_at: "2026-08-20T00:00:00Z" }] },
  );
  assert.equal(goal.status, "behind");
  assert.equal(goal.awaitingData, false);
});

test("#4579 min_u25_riders: reel status fra riders", async () => {
  const goal = await payloadForGoal(
    { type: "min_u25_riders", target: 2, category: "identity" },
    { riders: [{ id: "r1", team_id: TEAM_ID, is_u25: true }, { id: "r2", team_id: TEAM_ID, is_u25: true }, { id: "r3", team_id: TEAM_ID, is_u25: false }] },
  );
  assert.equal(goal.status, "achieved");
  assert.equal(goal.awaitingData, false);
});

test("#4579 min_national_riders: reel status fra riders.nationality_code", async () => {
  const goal = await payloadForGoal(
    { type: "min_national_riders", target: 2, nationality_code: "DNK", category: "identity" },
    { riders: [{ id: "r1", team_id: TEAM_ID, nationality_code: "DNK" }, { id: "r2", team_id: TEAM_ID, nationality_code: "DNK" }, { id: "r3", team_id: TEAM_ID, nationality_code: "FRA" }] },
  );
  assert.equal(goal.status, "achieved");
  assert.equal(goal.awaitingData, false);
});

test("#4579 min_riders: reel status fra riders.length", async () => {
  // 8/20 = 0.4-ratio -> scoreHigherBetter under 0.65-grænsen -> "behind" (ikke "on_track").
  const goal = await payloadForGoal(
    { type: "min_riders", target: 20, category: "economy" },
    { riders: Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, team_id: TEAM_ID })) },
  );
  assert.equal(goal.status, "behind");
  assert.equal(goal.awaitingData, false);
});

test("#4579 no_outstanding_debt: reel status fra activeLoanCount", async () => {
  const goal = await payloadForGoal(
    { type: "no_outstanding_debt", target: 0, category: "economy" },
    { loans: [] },
  );
  assert.equal(goal.status, "achieved");
  assert.equal(goal.awaitingData, false);
});

test("#4579 signature_rider: reel status fra riders' star-score", async () => {
  const goal = await payloadForGoal(
    { type: "signature_rider", target: 1, category: "identity" },
    { riders: [{ id: "r1", team_id: TEAM_ID, popularity: 100, uci_points: 900 }] },
  );
  assert.equal(goal.status, "achieved");
  assert.equal(goal.awaitingData, false);
});

test("#4579 relative_rank: BEHIND når beatCount < target (divisionManagerCount stubbet)", async () => {
  // Kun 3 managere i puljen (stubbet) -> beatCount = 3 - 2 = 1 < target 3.
  const tables = tablesWithSingleGoal(
    { type: "relative_rank", target: 3, category: "results" },
    { season_standings: [{ team_id: TEAM_ID, rank_in_division: 2, league_division_id: 11, updated_at: "2026-08-20T00:00:00Z" }] },
  );
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({
    supabase, teamId: TEAM_ID,
    loadGoalContext: async () => ({ divisionManagerCount: 3 }),
  });
  assert.equal(payload.mandate.goals[0].status, "behind");
  assert.equal(payload.mandate.goals[0].awaitingData, false);
});

test("#4579 relative_rank: ACHIEVED når beatCount >= target (divisionManagerCount stubbet)", async () => {
  const tables = tablesWithSingleGoal(
    { type: "relative_rank", target: 3, category: "results" },
    { season_standings: [{ team_id: TEAM_ID, rank_in_division: 2, league_division_id: 11, updated_at: "2026-08-20T00:00:00Z" }] },
  );
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({
    supabase, teamId: TEAM_ID,
    // 6 managere i puljen -> beatCount = 6 - 2 = 4 >= target 3.
    loadGoalContext: async () => ({ divisionManagerCount: 6 }),
  });
  assert.equal(payload.mandate.goals[0].status, "achieved");
  assert.equal(payload.mandate.goals[0].awaitingData, false);
});

test("#4579 sponsor_growth: BEHIND når vækst < target (sponsorGrowth*Income stubbet)", async () => {
  const tables = tablesWithSingleGoal({ type: "sponsor_growth", target: 20, category: "economy" });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({
    supabase, teamId: TEAM_ID,
    // (105-100)/100 = 5% < target 20%.
    loadGoalContext: async () => ({ sponsorGrowthBaselineIncome: 100, sponsorGrowthCurrentIncome: 105 }),
  });
  assert.equal(payload.mandate.goals[0].status, "behind");
  assert.equal(payload.mandate.goals[0].awaitingData, false);
});

test("#4579 sponsor_growth: ACHIEVED når vækst >= target (sponsorGrowth*Income stubbet)", async () => {
  const tables = tablesWithSingleGoal({ type: "sponsor_growth", target: 20, category: "economy" });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({
    supabase, teamId: TEAM_ID,
    // (150-100)/100 = 50% >= target 20%.
    loadGoalContext: async () => ({ sponsorGrowthBaselineIncome: 100, sponsorGrowthCurrentIncome: 150 }),
  });
  assert.equal(payload.mandate.goals[0].status, "achieved");
  assert.equal(payload.mandate.goals[0].awaitingData, false);
});

test("#4579 monument_podium: reel status fra cumulativeMonumentPodiums (stubbet)", async () => {
  const tables = tablesWithSingleGoal({ type: "monument_podium", target: 2, category: "results" });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({
    supabase, teamId: TEAM_ID,
    loadGoalContext: async () => ({ cumulativeMonumentPodiums: 3 }),
  });
  assert.equal(payload.mandate.goals[0].status, "achieved");
  assert.equal(payload.mandate.goals[0].awaitingData, false);
});

test("#4579 jersey_wins (kumulativ): reel status fra cumulativeJerseyWins (stubbet)", async () => {
  const tables = tablesWithSingleGoal({ type: "jersey_wins", target: 4, cumulative: true, category: "results" });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({
    supabase, teamId: TEAM_ID,
    loadGoalContext: async () => ({ cumulativeJerseyWins: 5 }),
  });
  assert.equal(payload.mandate.goals[0].status, "achieved");
  assert.equal(payload.mandate.goals[0].awaitingData, false);
});

test("#4579 jersey_wins (ikke-kumulativ): reel status fra seasonJerseyWins (stubbet)", async () => {
  const tables = tablesWithSingleGoal({ type: "jersey_wins", target: 2, cumulative: false, category: "results" });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({
    supabase, teamId: TEAM_ID,
    loadGoalContext: async () => ({ seasonJerseyWins: 3 }),
  });
  assert.equal(payload.mandate.goals[0].status, "achieved");
  assert.equal(payload.mandate.goals[0].awaitingData, false);
});

test("#4579 profitable_transfers: reel status fra cumulativeTransferBalance (stubbet)", async () => {
  const tables = tablesWithSingleGoal({ type: "profitable_transfers", target: 50_000, category: "economy" });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({
    supabase, teamId: TEAM_ID,
    loadGoalContext: async () => ({ cumulativeTransferBalance: 80_000 }),
  });
  assert.equal(payload.mandate.goals[0].status, "achieved");
  assert.equal(payload.mandate.goals[0].awaitingData, false);
});

test("#4579 u25_development_delta: reel status fra planStart*-baseline (stubbet) + rytternes stats", async () => {
  const tables = tablesWithSingleGoal(
    { type: "u25_development_delta", target: 8, category: "identity" },
    // planStartAvg = 100/2 = 50. currentAvg = (58+58)/2 = 58. delta/season(1) = 8 >= target 8.
    { riders: [{ id: "r1", team_id: TEAM_ID, is_u25: true, stat_fl: 58 }, { id: "r2", team_id: TEAM_ID, is_u25: true, stat_fl: 58 }] },
  );
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({
    supabase, teamId: TEAM_ID,
    loadGoalContext: async () => ({ planStartU25StatSum: 100, planStartU25Count: 2 }),
  });
  assert.equal(payload.mandate.goals[0].status, "achieved");
  assert.equal(payload.mandate.goals[0].awaitingData, false);
});

test("#4579 domestic_dominance: FORBLIVER awaiting_data (S-02g-skelet, dokumenteret kendt begrænsning)", async () => {
  const tables = tablesWithSingleGoal({ type: "domestic_dominance", target: 1, category: "identity" });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({
    supabase, teamId: TEAM_ID,
    loadGoalContext: async () => ({}),
  });
  const goal = payload.mandate.goals[0];
  // mapGoalEvaluationToStatus: awaiting_data -> on_track (aldrig en falsk alarm),
  // MEN awaitingData:true afslører nu at det er en datamangel, ikke en reel status.
  assert.equal(goal.status, "on_track");
  assert.equal(goal.awaitingData, true);
});

test("#4579 loadGoalContext kaster: payloaden leveres stadig, målet får awaitingData:true (best-effort-garanti)", async () => {
  const tables = tablesWithSingleGoal({ type: "relative_rank", target: 3, category: "results" });
  const supabase = makeSupabase(tables);
  const payload = await buildBoardRoomPayload({
    supabase, teamId: TEAM_ID,
    loadGoalContext: async () => { throw new Error("boom"); },
  });
  assert.ok(payload.mandate);
  const goal = payload.mandate.goals[0];
  assert.equal(goal.status, "on_track");
  assert.equal(goal.awaitingData, true);
});

test("#4579 loadGoalContext kaldes med boardId=source.from_board_id og leagueDivisionId=standing.league_division_id", async () => {
  const tables = tablesWithSingleGoal(
    { type: "relative_rank", target: 3, category: "results" },
    {
      board_mandates: [{
        id: "mand-4579", team_id: TEAM_ID, season_number: 3, status: "active",
        signed_at: "2026-08-01T00:00:00Z",
        source: { from_board_id: "board-xyz" },
        goals: [{ type: "relative_rank", target: 3, category: "results" }],
      }],
      board_profiles: [{ id: "board-xyz", team_id: TEAM_ID, plan_type: "1yr", seasons_completed: 0, plan_start_season_number: 3, plan_start_sponsor_income: 100 }],
      season_standings: [{ team_id: TEAM_ID, rank_in_division: 2, league_division_id: 42, updated_at: "2026-08-20T00:00:00Z" }],
    },
  );
  const supabase = makeSupabase(tables);
  let capturedArgs = null;
  const payload = await buildBoardRoomPayload({
    supabase, teamId: TEAM_ID,
    loadGoalContext: async (args) => { capturedArgs = args; return { divisionManagerCount: 5 }; },
  });
  assert.ok(payload.mandate);
  assert.ok(capturedArgs);
  assert.equal(capturedArgs.boardId, "board-xyz");
  assert.equal(capturedArgs.leagueDivisionId, 42);
});

// ── Rene hjælpefunktioner ──────────────────────────────────────────────────────

test("deriveMemberRole: chairman -> chair, ellers højeste category_alignment", () => {
  assert.equal(deriveMemberRole({ archetypeKey: "sponsoraten", isChairman: true }), "chair");
  assert.equal(deriveMemberRole({ archetypeKey: "sponsoraten", isChairman: false }), "economy");
  assert.equal(deriveMemberRole({ archetypeKey: "resultatjaegeren", isChairman: false }), "results");
});

test("mapGoalEvaluationToStatus: met -> achieved, uanset mandate-status", () => {
  assert.equal(mapGoalEvaluationToStatus({ evaluation: { met: true, status: "behind" }, mandateStatus: "active" }), "achieved");
});

test("mapGoalEvaluationToStatus: behind + aktivt mandat -> behind; behind + completed -> failed", () => {
  assert.equal(mapGoalEvaluationToStatus({ evaluation: { met: false, status: "behind" }, mandateStatus: "active" }), "behind");
  assert.equal(mapGoalEvaluationToStatus({ evaluation: { met: false, status: "behind" }, mandateStatus: "completed" }), "failed");
});

test("mapGoalEvaluationToStatus: near_miss/watch -> at_risk", () => {
  assert.equal(mapGoalEvaluationToStatus({ evaluation: { met: false, status: "near_miss" }, mandateStatus: "active" }), "at_risk");
  assert.equal(mapGoalEvaluationToStatus({ evaluation: { met: false, status: "watch" }, mandateStatus: "active" }), "at_risk");
});

test("mapGoalEvaluationToStatus: awaiting_data (manglende live-data) mappes til on_track, aldrig en falsk alarm", () => {
  assert.equal(mapGoalEvaluationToStatus({ evaluation: { met: false, status: "awaiting_data" }, mandateStatus: "active" }), "on_track");
});

test("formatGoalDisplayValue: heltal uden decimal, ellers ét decimal, null for manglende data", () => {
  assert.equal(formatGoalDisplayValue(5), "5");
  assert.equal(formatGoalDisplayValue(5.26), "5.3");
  assert.equal(formatGoalDisplayValue(null), null);
  assert.equal(formatGoalDisplayValue(undefined), null);
  assert.equal(formatGoalDisplayValue(NaN), null);
});

test("resolveEventSpeaker: milepæls-reason_category -> chairman + milestone-beat", () => {
  const speaker = resolveEventSpeaker({
    row: { reason_category: "mandate.milestone.missed", satisfaction_delta: -6 },
    chairmanArchetypeKey: "sponsoraten",
  });
  assert.deepEqual(speaker, { archetypeKey: "sponsoraten", beat: "milestone_missed", isChairmanBeat: true });
});

test("resolveEventSpeaker: ukendt reason_category falder tilbage til receipt_positive/negative ud fra fortegn", () => {
  assert.equal(resolveEventSpeaker({ row: { reason_category: "weekend_update", satisfaction_delta: 2 }, chairmanArchetypeKey: "x" }).beat, "receipt_positive");
  assert.equal(resolveEventSpeaker({ row: { reason_category: "weekend_update", satisfaction_delta: -2 }, chairmanArchetypeKey: "x" }).beat, "receipt_negative");
});

test("deriveMemberMood: ingen events -> neutral; positiv sum -> positive; negativ sum -> negative", () => {
  assert.equal(deriveMemberMood({ ownedEvents: [], archetypeKey: "sponsoraten" }), "neutral");
  assert.equal(deriveMemberMood({
    ownedEvents: [{ ownerArchetypeKey: "sponsoraten", satisfaction_delta: 4 }, { ownerArchetypeKey: "sponsoraten", satisfaction_delta: -1 }],
    archetypeKey: "sponsoraten",
  }), "positive");
  assert.equal(deriveMemberMood({
    ownedEvents: [{ ownerArchetypeKey: "sponsoraten", satisfaction_delta: -4 }],
    archetypeKey: "sponsoraten",
  }), "negative");
});

test("deriveMemberMood: kun de seneste 5 (vinduet) tælles med", () => {
  const ownedEvents = [
    { ownerArchetypeKey: "x", satisfaction_delta: -1 },
    { ownerArchetypeKey: "x", satisfaction_delta: -1 },
    { ownerArchetypeKey: "x", satisfaction_delta: -1 },
    { ownerArchetypeKey: "x", satisfaction_delta: -1 },
    { ownerArchetypeKey: "x", satisfaction_delta: -1 },
    // Ligger UDENFOR N=5-vinduet (kaldet forudsætter allerede sorteret nyeste-først).
    { ownerArchetypeKey: "x", satisfaction_delta: 100 },
  ];
  assert.equal(deriveMemberMood({ ownedEvents, archetypeKey: "x" }), "negative");
});

test("deriveConsequenceLine: ingen aktive -> active:false", () => {
  assert.deepEqual(deriveConsequenceLine([]), { active: false, lineKey: null, lineParams: {} });
});

test("deriveMilestoneStatus: pending i indeværende sæson -> current + isCurrentSeason", () => {
  const result = deriveMilestoneStatus({ milestone: { status: "pending", target_season_number: 4 }, currentSeasonNumber: 4 });
  assert.deepEqual(result, { status: "current", isCurrentSeason: true });
});

test("deriveMilestoneStatus: pending i fremtidig sæson -> upcoming", () => {
  const result = deriveMilestoneStatus({ milestone: { status: "pending", target_season_number: 6 }, currentSeasonNumber: 4 });
  assert.deepEqual(result, { status: "upcoming", isCurrentSeason: false });
});

test("deriveMilestoneStatus: forfalden-men-ikke-evalueret (target < indeværende) -> current, ikke gættet missed", () => {
  const result = deriveMilestoneStatus({ milestone: { status: "pending", target_season_number: 2 }, currentSeasonNumber: 4 });
  assert.equal(result.status, "current");
  assert.equal(result.isCurrentSeason, false);
});

test("deriveMilestoneStatus: achieved/missed går igennem uændret uanset sæson-tal", () => {
  assert.deepEqual(deriveMilestoneStatus({ milestone: { status: "achieved", target_season_number: 99 }, currentSeasonNumber: 1 }), { status: "achieved", isCurrentSeason: false });
  assert.deepEqual(deriveMilestoneStatus({ milestone: { status: "missed", target_season_number: 1 }, currentSeasonNumber: 1 }), { status: "missed", isCurrentSeason: false });
});

test("buildGoalLabelSource: eksponerer rå snake_case-felter til frontends getBoardGoalLabel, defaults til null/false", () => {
  assert.deepEqual(
    buildGoalLabelSource({ type: "jersey_wins", target: 4, label: "Mindst 4 etapeloeb-troejer", cumulative: true, race_scope: null, nationality_code: null }),
    { type: "jersey_wins", target: 4, label: "Mindst 4 etapeloeb-troejer", cumulative: true, race_scope: null, nationality_code: null }
  );
  assert.deepEqual(
    buildGoalLabelSource({}),
    { type: null, target: null, label: null, cumulative: false, race_scope: null, nationality_code: null }
  );
  assert.deepEqual(
    buildGoalLabelSource(undefined),
    { type: null, target: null, label: null, cumulative: false, race_scope: null, nationality_code: null }
  );
});

test("deriveFoundingSeasonNumber: vælger seneste sæson hvis start_date <= teamCreatedAt", () => {
  const seasons = [
    { number: 1, start_date: "2026-05-08T00:00:00Z" },
    { number: 2, start_date: "2026-06-19T00:00:00Z" },
    { number: 3, start_date: "2026-07-31T00:00:00Z" },
  ];
  assert.equal(deriveFoundingSeasonNumber({ teamCreatedAt: "2026-08-15T00:00:00Z", seasons }), 3);
  assert.equal(deriveFoundingSeasonNumber({ teamCreatedAt: "2026-06-01T00:00:00Z", seasons }), 1);
});

test("deriveFoundingSeasonNumber: hold oprettet FØR nogen sæson startede falder tilbage til tidligste sæson", () => {
  const seasons = [
    { number: 2, start_date: "2026-06-19T00:00:00Z" },
    { number: 3, start_date: "2026-07-31T00:00:00Z" },
  ];
  assert.equal(deriveFoundingSeasonNumber({ teamCreatedAt: "2026-01-01T00:00:00Z", seasons }), 2);
});

test("deriveFoundingSeasonNumber: ingen sæsoner eller manglende teamCreatedAt-match uden sæsoner -> null", () => {
  assert.equal(deriveFoundingSeasonNumber({ teamCreatedAt: "2026-08-15T00:00:00Z", seasons: [] }), null);
  assert.equal(deriveFoundingSeasonNumber({ teamCreatedAt: null, seasons: [] }), null);
});

test("deriveFoundingSeasonNumber: manglende teamCreatedAt men sæsoner findes -> tidligste sæson (defensivt, aldrig crash)", () => {
  const seasons = [{ number: 1, start_date: "2026-05-08T00:00:00Z" }, { number: 2, start_date: "2026-06-19T00:00:00Z" }];
  assert.equal(deriveFoundingSeasonNumber({ teamCreatedAt: null, seasons }), 1);
});

// ── Tom voice-bucket → null-citat, ikke crash (design punkt 5) ────────────────
// `sampleFn` er kun injicerbar til DENNE test — alle 9 arketyper har i dag
// fuldt indhold i alle buckets (se boardVoice.test.js), så der er ingen ægte
// tom-bucket-case at ramme med rigtige data.

test("sampleVoiceLineOrNull: BoardVoiceEmptyBucketError degraderer til null, IKKE en crash", () => {
  const throwingFn = () => { throw new BoardVoiceEmptyBucketError("nationalist_purist", "receipt_positive"); };
  const result = sampleVoiceLineOrNull({ sampleFn: throwingFn, beat: "receipt_positive", archetypeKey: "nationalist_purist", seed: "x" });
  assert.equal(result, null);
});

test("sampleVoiceLineOrNull: andre fejl (ukendt beat/archetype = programmørfejl) kastes videre, IKKE svalgt", () => {
  const throwingFn = () => { throw new Error("ukendt beat"); };
  assert.throws(
    () => sampleVoiceLineOrNull({ sampleFn: throwingFn, beat: "not_a_beat", archetypeKey: "x", seed: "x" }),
    /ukendt beat/
  );
});
