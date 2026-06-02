import { createInitialBoardProfile } from "./boardEngine.js";
import {
  DIVISION_CAPACITY,
  INITIAL_BALANCE,
  MAX_DIVISION,
  MIN_DIVISION,
  SPONSOR_INCOME_BASE,
} from "./economyConstants.js";

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
  const { data: teams, error } = await supabase
    .from("teams")
    .select("id")
    .ilike("name", normalizedName);

  if (error) {
    throw createHttpError(500, error.message);
  }

  const conflictingTeam = (teams || []).find((team) => team.id !== existingTeamId);
  if (conflictingTeam) {
    throw createHttpError(409, "Dette holdnavn er allerede taget — vælg et andet");
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
      throw createHttpError(500, updateError.message);
    }

    team = updatedTeam;
  } else {
    const division = await pickDivisionForNewTeam(supabase);
    const { data: insertedTeam, error: insertError } = await supabase
      .from("teams")
      .insert({
        user_id: userId,
        name: normalizedName,
        manager_name: normalizedManagerName,
        ...DEFAULT_TEAM_VALUES,
        division,
      })
      .select("*")
      .single();

    if (insertError) {
      throw createHttpError(500, insertError.message);
    }

    team = insertedTeam;
    created = true;
  }

  const boardProfileCreated = await ensureBoardProfile({ supabase, team });

  return {
    team,
    created,
    boardProfileCreated,
  };
}
