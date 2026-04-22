const RECENT_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

function buildRecentDuplicateLookup({
  supabase,
  userId,
  type,
  title,
  message,
  relatedId,
  sinceIso,
}) {
  let query = supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .eq("type", type)
    .eq("title", title)
    .eq("message", message)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false });

  query = relatedId ? query.eq("related_id", relatedId) : query.is("related_id", null);

  return query.limit(1);
}

export async function notifyUser({
  supabase,
  userId,
  type,
  title,
  message,
  relatedId = null,
  dedupeWindowMs = RECENT_DUPLICATE_WINDOW_MS,
  now = new Date(),
}) {
  if (!userId) {
    return { delivered: false, deduped: false, reason: "missing_user" };
  }

  // Identical recent payloads represent the same event and should not spam the user.
  const sinceIso = new Date(now.getTime() - dedupeWindowMs).toISOString();
  const { data: existing, error: lookupError } = await buildRecentDuplicateLookup({
    supabase,
    userId,
    type,
    title,
    message,
    relatedId,
    sinceIso,
  });

  if (lookupError) {
    throw lookupError;
  }

  if (existing?.length) {
    return { delivered: false, deduped: true, reason: "recent_duplicate" };
  }

  const { error } = await supabase.from("notifications").insert({
    user_id: userId,
    type,
    title,
    message,
    related_id: relatedId,
  });

  if (error) {
    throw error;
  }

  return { delivered: true, deduped: false };
}

export async function notifyTeamOwner({
  supabase,
  teamId,
  type,
  title,
  message,
  relatedId = null,
  dedupeWindowMs = RECENT_DUPLICATE_WINDOW_MS,
  now = new Date(),
}) {
  if (!teamId) {
    return { delivered: false, deduped: false, reason: "missing_team" };
  }

  const { data: team, error } = await supabase
    .from("teams")
    .select("user_id")
    .eq("id", teamId)
    .single();

  if (error) {
    throw error;
  }

  return notifyUser({
    supabase,
    userId: team?.user_id ?? null,
    type,
    title,
    message,
    relatedId,
    dedupeWindowMs,
    now,
  });
}
