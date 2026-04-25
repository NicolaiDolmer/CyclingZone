import { createInitialBoardProfile } from "./boardEngine.js";

const DEFAULT_TEAM_VALUES = {
  division: 3,
  balance: 2000000,
  sponsor_income: 400000,
};

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeValue(value) {
  return String(value ?? "").trim();
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
      })
      .eq("id", existingTeam.id)
      .select("*")
      .single();

    if (updateError) {
      throw createHttpError(500, updateError.message);
    }

    team = updatedTeam;
  } else {
    const { data: insertedTeam, error: insertError } = await supabase
      .from("teams")
      .insert({
        user_id: userId,
        name: normalizedName,
        manager_name: normalizedManagerName,
        ...DEFAULT_TEAM_VALUES,
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
