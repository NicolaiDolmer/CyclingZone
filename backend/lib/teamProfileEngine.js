import { createInitialBoardProfile } from "./boardEngine.js";
import {
  DIVISION_CAPACITY,
  INITIAL_BALANCE,
  MAX_DIVISION,
  MIN_DIVISION,
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

// #962 fyld-fra-toppen: nye hold tildeles den HØJESTE division (lavest nummer)
// med ledig plads — div 1 fyldes før div 2 osv. Kun "rigtige" hold tæller mod
// kapaciteten — samme filter som ranglisten (StandingsPage): AI-, test- og frosne
// hold ignoreres, ellers spiser de pladser uden at være synlige og skubber rigtige
// hold ned. Bund-divisionen (MAX_DIVISION) er overflow og bruges når alle højere
// divisioner er fyldt til DIVISION_CAPACITY.
async function pickDivisionForNewTeam(supabase) {
  const { data: teams, error } = await supabase
    .from("teams")
    .select("division")
    .eq("is_ai", false)
    .eq("is_test_account", false)
    .eq("is_frozen", false);

  if (error) {
    throw createHttpError(500, error.message);
  }

  const counts = new Map();
  for (const team of teams || []) {
    counts.set(team.division, (counts.get(team.division) || 0) + 1);
  }

  for (let division = MIN_DIVISION; division < MAX_DIVISION; division++) {
    if ((counts.get(division) || 0) < DIVISION_CAPACITY) {
      return division;
    }
  }

  return MAX_DIVISION;
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

export async function upsertOwnTeamProfile({
  supabase,
  userId,
  existingTeam = null,
  name,
  managerName,
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
    const division = await pickDivisionForNewTeam(supabase);
    const insertResult = await insertTeamHandlingConflicts({
      supabase,
      userId,
      normalizedName,
      normalizedManagerName,
      division,
    });

    team = insertResult.team;
    created = insertResult.created;
  }

  const boardProfileCreated = await ensureBoardProfile({ supabase, team });

  return {
    team,
    created,
    boardProfileCreated,
  };
}
