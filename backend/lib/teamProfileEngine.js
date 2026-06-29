import { createInitialBoardProfile } from "./boardEngine.js";
import { computeSeasonOneIdentity } from "./boardIdentity.js";
import { BOARD_IDENTITY_RIDER_SELECT } from "./boardConstants.js";
import { allocateStarterSquadForTeam } from "./starterSquadAllocator.js";
import { runAcademyIntakeForTeam } from "./academyIntake.js";
import { isAcademyEnabled } from "./academyFlag.js";
import { reconcileAiTeamsForPool } from "./aiTeamGenerator.js";
import { captureException as sentryCapture } from "./sentry.js";
import {
  INITIAL_BALANCE,
  MANAGER_ENTRY_DIVISION,
  SPONSOR_INCOME_BASE,
} from "./economyConstants.js";
import { likeEscape } from "./likeEscape.js";

const DEFAULT_TEAM_VALUES = {
  balance: INITIAL_BALANCE,
  sponsor_income: SPONSOR_INCOME_BASE,
};

const LEGACY_SIGNUP_PLACEHOLDER_VALUES = {
  balance: new Set([500]),
  sponsor_income: new Set([100, 500]),
};

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// ── #1264 · DB-håndhævet unikhed ──────────────────────────────────────────────
// Check-then-insert er racet under samtidige signups (empirisk bekræftet i
// load-testen 2026-06-11): applikations-prechecket ser intet, men en samtidig
// transaktion committer mellem precheck og insert. Autoriteten er derfor
// Postgres-unique-indexes (migration 2026-06-11-teams-unique-user-and-name.sql),
// og 23505-violations håndteres gracefully her.
const UNIQUE_VIOLATION_CODE = "23505";
const TEAMS_USER_ID_UNIQUE_INDEX = "teams_user_id_unique_idx";
const TEAMS_NAME_UNIQUE_INDEX = "teams_name_lower_unique_idx";
const NAME_CONFLICT_RETRY_LIMIT = 3;
const NAME_TAKEN_MESSAGE = "Dette holdnavn er allerede taget — vælg et andet";

function isUniqueViolation(error) {
  return error?.code === UNIQUE_VIOLATION_CODE;
}

// Hvilket unique-index udløste 23505? PostgREST sender constraint-navnet i
// message og nøglen i details — vi matcher begge som fallback for hinanden.
function uniqueViolationTarget(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`;
  if (text.includes(TEAMS_USER_ID_UNIQUE_INDEX) || text.includes("(user_id)")) {
    return "user_id";
  }
  if (text.includes(TEAMS_NAME_UNIQUE_INDEX) || text.includes("lower(name)")) {
    return "name";
  }
  return "unknown";
}

async function fetchTeamByUserId({ supabase, userId }) {
  const { data: teams, error } = await supabase
    .from("teams")
    .select("*")
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    throw createHttpError(500, error.message);
  }

  return (teams || [])[0] || null;
}

// Insert med 23505-håndtering:
// - user_id-konflikt → et samtidigt bootstrap-kald vandt; returnér det
//   eksisterende hold (idempotent svar, ikke 500 → kontoen er aldrig hold-løs).
// - navne-konflikt → en anden bruger tog navnet i race-vinduet; bounded retry
//   med talsuffiks ("Navn 2", "Navn 3", ...) så signup altid lander et
//   funktionelt hold. Brugeren kan omdøbe bagefter via Min Profil.
// Bemærk: ved dobbelt-bootstrap med SAMME navn kan Postgres rapportere navne-
// indexet før user_id-indexet — suffiks-retryet rammer da user_id-konflikten i
// næste forsøg og konvergerer stadig idempotent.
async function insertTeamHandlingConflicts({
  supabase,
  userId,
  normalizedName,
  normalizedManagerName,
  division,
  leagueDivisionId,
}) {
  let nameAttempt = 0;

  while (true) {
    const candidateName = nameAttempt === 0
      ? normalizedName
      : `${normalizedName} ${nameAttempt + 1}`;

    const { data: insertedTeam, error: insertError } = await supabase
      .from("teams")
      .insert({
        user_id: userId,
        name: candidateName,
        manager_name: normalizedManagerName,
        ...DEFAULT_TEAM_VALUES,
        division,
        // #1608 Task 9: pulje-referencen sættes ved team-create (bund-op-placering).
        // null tilladt indtil puljerne findes (pre-migration / mock).
        league_division_id: leagueDivisionId,
      })
      .select("*")
      .single();

    if (!insertError) {
      return { team: insertedTeam, created: true };
    }

    if (!isUniqueViolation(insertError)) {
      throw createHttpError(500, insertError.message);
    }

    const target = uniqueViolationTarget(insertError);

    if (target === "user_id") {
      const existingTeam = await fetchTeamByUserId({ supabase, userId });
      if (!existingTeam) {
        throw createHttpError(500, "Holdoprettelsen ramte en user_id-konflikt, men holdet kunne ikke findes — prøv igen");
      }
      return { team: existingTeam, created: false };
    }

    if (target === "name") {
      nameAttempt += 1;
      if (nameAttempt > NAME_CONFLICT_RETRY_LIMIT) {
        throw createHttpError(409, NAME_TAKEN_MESSAGE);
      }
      continue;
    }

    throw createHttpError(500, insertError.message);
  }
}

function normalizeValue(value) {
  return String(value ?? "").trim();
}

function getEconomyRepairValues(team) {
  const repair = {};

  if (team?.balance == null || LEGACY_SIGNUP_PLACEHOLDER_VALUES.balance.has(Number(team.balance))) {
    repair.balance = INITIAL_BALANCE;
  }

  if (team?.sponsor_income == null || LEGACY_SIGNUP_PLACEHOLDER_VALUES.sponsor_income.has(Number(team.sponsor_income))) {
    repair.sponsor_income = SPONSOR_INCOME_BASE;
  }

  return repair;
}

// #1608 Task 9 / #1688 (ejer-besluttet 22/6) · pulje-bevidst placering. ERSTATTER #962
// fyld-fra-toppen for ÆGTE nye managere: forever-relaunch-politikken er at managere kommer
// ind i MANAGER_ENTRY_DIVISION (=3, IKKE den strukturelle bund tier 4) og rykker op over
// sæsoner. Et nyt hold placeres i den MINDST-FYLDTE entry-pulje (league_divisions med tier
// = MANAGER_ENTRY_DIVISION), op til POOL_TARGET_SIZE som blød cap (vi lander altid i mindst-
// fyldte pulje, også når alle er forbi target). Kun "rigtige" hold tæller mod pulje-fyldningen
// — samme filter som ranglisten (StandingsPage): AI-, test- og frosne hold ignoreres.
//
// Returnerer { division, leagueDivisionId }. Graceful fallback: hvis ingen entry-puljer
// findes (pre-migration / minimal test-mock), placeres holdet stadig i entry-divisionen med
// leagueDivisionId = null (samme NULL-tolerante adfærd som updateStandings, #1608).
async function pickDivisionForNewTeam(supabase) {
  const { data: pools, error: poolsError } = await supabase
    .from("league_divisions")
    .select("id")
    .eq("tier", MANAGER_ENTRY_DIVISION);

  if (poolsError) {
    throw createHttpError(500, poolsError.message);
  }

  const entryPools = pools || [];
  if (entryPools.length === 0) {
    // Pre-migration / mock-edge: ingen puljer at sprede på. Hold kommer stadig ind i
    // entry-divisionen; pulje-referencen efter-allokeres når puljerne findes.
    return { division: MANAGER_ENTRY_DIVISION, leagueDivisionId: null };
  }

  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("league_division_id")
    .eq("is_ai", false)
    .eq("is_test_account", false)
    .eq("is_frozen", false);

  if (teamsError) {
    throw createHttpError(500, teamsError.message);
  }

  const counts = new Map(entryPools.map((pool) => [pool.id, 0]));
  for (const team of teams || []) {
    if (counts.has(team.league_division_id)) {
      counts.set(team.league_division_id, counts.get(team.league_division_id) + 1);
    }
  }

  // Mindst-fyldte entry-pulje (deterministisk: laveste pulje-id ved lige fyldning).
  let chosenPoolId = entryPools[0].id;
  let chosenCount = counts.get(chosenPoolId);
  for (const pool of entryPools) {
    const count = counts.get(pool.id);
    if (count < chosenCount) {
      chosenPoolId = pool.id;
      chosenCount = count;
    }
  }

  return { division: MANAGER_ENTRY_DIVISION, leagueDivisionId: chosenPoolId };
}

async function ensureUniqueTeamName({ supabase, normalizedName, existingTeamId = null }) {
  // Security-audit 2026-06-12 (P4, #1338): dette er et EXACT-match unikheds-check,
  // ikke en søgning. Uden escaping ville et holdnavn som "%" eller "Te_m" virke
  // som LIKE-wildcards og matche fremmede hold (falsk 409 / utilsigtet kollision).
  const { data: teams, error } = await supabase
    .from("teams")
    .select("id")
    .ilike("name", likeEscape(normalizedName));

  if (error) {
    throw createHttpError(500, error.message);
  }

  const conflictingTeam = (teams || []).find((team) => team.id !== existingTeamId);
  if (conflictingTeam) {
    throw createHttpError(409, NAME_TAKEN_MESSAGE);
  }
}

async function ensureBoardProfile({ supabase, team }) {
  const { data: boardProfiles, error: boardLookupError } = await supabase
    .from("board_profiles")
    .select("id")
    .eq("team_id", team.id)
    .limit(1);

  if (boardLookupError) {
    throw createHttpError(500, boardLookupError.message);
  }

  if ((boardProfiles || []).length > 0) {
    return false;
  }

  const { error: boardInsertError } = await supabase
    .from("board_profiles")
    .insert(createInitialBoardProfile({
      teamId: team.id,
      balance: team.balance,
      sponsorIncome: team.sponsor_income,
    }));

  if (boardInsertError) {
    // #1264: et samtidigt bootstrap-kald vandt board-insertet
    // (UNIQUE (team_id, plan_type)) — profilen findes, intet at reparere.
    if (isUniqueViolation(boardInsertError)) {
      return false;
    }
    throw createHttpError(500, boardInsertError.message);
  }

  return true;
}

// #2022 · Sæson-agnostisk identitets-grundlag. Et nyt holds board-identitet
// (grundlaget DNA-forslagene udledes af) skal sættes ved DANNELSE — uanset
// hvilken global sæson holdet starter i — så en sæson-2+-nykommer ikke låses ude
// af DNA-valg. Tidligere skrev kun startSequentialNegotiation feltet (ved sæson-1-
// slut). Idempotent: skriver kun når feltet stadig er NULL, så den ikke
// overskriver et frosset grundlag (samme guard som backfill-stien).
export async function ensureSeasonIdentityBasis({ supabase, team, seasonNumber = 1 } = {}) {
  if (!team?.id) {
    throw createHttpError(500, "team is required for identity basis");
  }
  if (team.season_1_identity_basis) {
    return false;
  }

  const { data: riders, error: ridersError } = await supabase
    .from("riders")
    .select(BOARD_IDENTITY_RIDER_SELECT)
    .eq("team_id", team.id);
  if (ridersError) {
    throw createHttpError(500, ridersError.message);
  }

  const basis = computeSeasonOneIdentity({
    team,
    riders: riders || [],
    seasonNumber: seasonNumber ?? 1,
  });

  const { error: updateError } = await supabase
    .from("teams")
    .update({ season_1_identity_basis: basis })
    .eq("id", team.id)
    .is("season_1_identity_basis", null);
  if (updateError) {
    throw createHttpError(500, updateError.message);
  }

  return true;
}

export async function upsertOwnTeamProfile({
  supabase,
  userId,
  existingTeam = null,
  name,
  managerName,
  // #1560: DI så testen kan verificere at allokeringen kaldes (created===true) vs.
  // ikke (created===false) uden at skulle mocke hele riders/derive-kæden.
  allocateStarterSquad = allocateStarterSquadForTeam,
  // Forever-relaunch (spejler #1560): et NYT hold skal også have ét akademi-kuld.
  // DI så testen kan verificere koblingen + den globale flag-gate uden at mocke
  // hele riders/derive-kæden eller app_config.
  runAcademyCohort = runAcademyIntakeForTeam,
  academyEnabled = isAcademyEnabled,
  // #1739: trim ét AI-fyld-hold fra den pulje det nye hold lander i, så pulje-
  // størrelsen holdes konstant. DI så testen kan verificere koblingen uden at mocke
  // hele AI-generator-kæden.
  reconcileAiTeams = reconcileAiTeamsForPool,
} = {}) {
  if (!supabase?.from) {
    throw createHttpError(500, "Supabase client is required");
  }

  if (!userId) {
    throw createHttpError(400, "userId is required");
  }

  const normalizedName = normalizeValue(name);
  const normalizedManagerName = normalizeValue(managerName);

  if (normalizedName.length < 3) {
    throw createHttpError(400, "Holdnavn skal være mindst 3 tegn");
  }

  if (normalizedManagerName.length < 2) {
    throw createHttpError(400, "Managernavn skal være mindst 2 tegn");
  }

  await ensureUniqueTeamName({
    supabase,
    normalizedName,
    existingTeamId: existingTeam?.id ?? null,
  });

  let team;
  let created = false;

  if (existingTeam?.id) {
    const { data: updatedTeam, error: updateError } = await supabase
      .from("teams")
      .update({
        name: normalizedName,
        manager_name: normalizedManagerName,
        ...getEconomyRepairValues(existingTeam),
      })
      .eq("id", existingTeam.id)
      .select("*")
      .single();

    if (updateError) {
      // #1264: en anden bruger tog navnet mellem precheck og update — ved en
      // eksplicit omdøbning er det rigtige svar 409, ikke auto-suffiks.
      if (isUniqueViolation(updateError) && uniqueViolationTarget(updateError) === "name") {
        throw createHttpError(409, NAME_TAKEN_MESSAGE);
      }
      throw createHttpError(500, updateError.message);
    }

    team = updatedTeam;
  } else {
    const { division, leagueDivisionId } = await pickDivisionForNewTeam(supabase);
    const insertResult = await insertTeamHandlingConflicts({
      supabase,
      userId,
      normalizedName,
      normalizedManagerName,
      division,
      leagueDivisionId,
    });

    team = insertResult.team;
    created = insertResult.created;
  }

  const boardProfileCreated = await ensureBoardProfile({ supabase, team });

  // #1560: et NYT hold skal have en spilbar start-trup (8 ryttere fra den svage
  // #1487-pulje) FØR signup-responsen — ellers er holdet en tom-trup-blindgyde
  // (kan ikke stille op til løb, onboarding-trin 2 kan aldrig fuldføres).
  // Kun ved created===true: en idempotent created===false (et samtidigt bootstrap
  // vandt) håndteres af det VINDENDE kald — og allocateStarterSquadForTeam har
  // selv en idempotens-guard, så dobbelt-allokering er umulig uanset.
  // En fejl her er alvorlig (= hele bug'en) → log tydeligt og bobl op, så holdet
  // ikke stille efterlades tomt.
  if (created) {
    try {
      await allocateStarterSquad(supabase, team.id);
    } catch (allocError) {
      console.error(
        `[teamProfileEngine] #1560 starter-squad-allokering FEJLEDE for nyt hold ${team.id}:`,
        allocError?.message || allocError,
      );
      throw createHttpError(500, `Holdet blev oprettet, men start-truppen kunne ikke tildeles: ${allocError?.message || allocError}`);
    }

    // #2022: beregn holdets identitets-grundlag fra den netop-tildelte start-trup,
    // så board+DNA er valgbart fra dag 1 — uanset global sæson. Skal køre EFTER
    // allokeringen (ellers tom trup). BEVIDST IKKE-FATAL: et manglende grundlag er
    // en blødere blindgyde end en tom trup (backfill-stien i
    // startSequentialNegotiation + boardIdentityBackfillDryRun.js fanger det), så
    // en fejl her må ikke blokere signup.
    try {
      await ensureSeasonIdentityBasis({ supabase, team });
    } catch (basisError) {
      console.error(
        `[teamProfileEngine] #2022 identitets-grundlag FEJLEDE for nyt hold ${team.id} (ikke-fatal, signup fortsætter):`,
        basisError?.message || basisError,
      );
      sentryCapture(
        basisError instanceof Error ? basisError : new Error(String(basisError)),
        { tags: { component: "team-create-identity-basis" }, extra: { teamId: team.id } },
      );
    }

    // Forever-relaunch (spejler #1560): et NYT hold får også ét akademi-kuld
    // (3-5 offered, nul tvungen cost) ved signup — ellers er akademiet en
    // forever-relaunch-blindgyde for nye signups. Gated GLOBALT via
    // isAcademyEnabled(supabase) UDEN beta-opts (samme som relaunch-stien,
    // relaunchOrchestrator trin 6.4), så ikke-beta nye signups ikke stille
    // springes over mens flaget er 'on'.
    //
    // BEVIDST IKKE-FATAL DELVIS-FEJL: i modsætning til start-truppen ovenfor
    // (hvis fejl = hele bug'en → bobl op) er et manglende akademi en blødere,
    // genoprettelig blindgyde end en blokeret signup. Fanger vi en fejl her,
    // logger vi den (Sentry + console.error) og FORTSÆTTER — holdet beholder sin
    // start-trup og signup lykkes. (Opfølgning: en retry-sweep der hærder
    // akademi-seedingen mod forbigående fejl, analogt til #1563 for start-truppe.)
    try {
      if (await academyEnabled(supabase)) {
        await runAcademyCohort(supabase, team.id);
      }
    } catch (academyError) {
      console.error(
        `[teamProfileEngine] akademi-kuld-seeding FEJLEDE for nyt hold ${team.id} (ikke-fatal, signup fortsætter):`,
        academyError?.message || academyError,
      );
      sentryCapture(
        academyError instanceof Error ? academyError : new Error(String(academyError)),
        { tags: { component: "team-create-academy" }, extra: { teamId: team.id } },
      );
    }

    // #1739: et nyt ægte hold medregnes nu i puljens felt, så AI-fyld-target falder
    // med 1 — trim ét overskuds-AI-hold fra netop denne pulje, så pulje-størrelsen
    // holdes på POOL_TARGET_SIZE i stedet for at vokse. (Tidligere kørte trim-logikken
    // KUN ved relaunch, så et nyt hold midt i sæsonen efterlod AI-feltet urørt.)
    //
    // BEVIDST IKKE-FATAL: et utrimmet AI-hold er en kosmetisk pulje-overfyldning, ikke
    // en blokeret signup. Fanger vi en fejl, logger vi (Sentry + console.error) og
    // FORTSÆTTER — holdet er oprettet, har trup + akademi, og signup lykkes. Trimmen
    // er desuden idempotent (reconcileAiTeamsForPool top-up'er/trimmer mod target hver
    // gang), så en næste reconcile/relaunch retter en sprunget kørsel. Springes når
    // holdet ikke landede i en pulje (league_division_id=null, pre-migration / mock).
    if (team.league_division_id != null) {
      try {
        await reconcileAiTeams({ supabase, poolId: team.league_division_id });
      } catch (reconcileError) {
        console.error(
          `[teamProfileEngine] #1739 AI-fyld-trim FEJLEDE for nyt hold ${team.id} i pulje ${team.league_division_id} (ikke-fatal, signup fortsætter):`,
          reconcileError?.message || reconcileError,
        );
        sentryCapture(
          reconcileError instanceof Error ? reconcileError : new Error(String(reconcileError)),
          { tags: { component: "team-create-ai-trim" }, extra: { teamId: team.id, poolId: team.league_division_id } },
        );
      }
    }
  }

  return {
    team,
    created,
    boardProfileCreated,
  };
}
