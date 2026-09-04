// Resolve a Discord DM recipient (id + prefs) from a teamId or a userId.
// Client-injectable and creates no Supabase client at import, so it unit-tests
// without env/websocket coupling (same separation as discordDmTarget.js).
// Enforces the master switch (users.discord_dm_enabled); the per-type gate lives
// in discordDmPrefs.js and is applied by the caller.

/**
 * #4734: also returns the recipient's `users.language`, so the DM text can be
 * rendered in their language instead of always EN. Same source of truth as the
 * retention mails (backend/lib/emailService.js). Null/unknown languages are
 * normalized to EN by i18nServer.normalizeLanguage at render time.
 *
 * @returns {Promise<{discordId: string, prefs: object, language: string|null} | null>}
 *   null when: no user resolves, the user has no discord_id, or DMs are disabled.
 */
export async function resolveDmRecipient({ teamId = null, userId = null, client }) {
  let uid = userId;
  if (!uid && teamId) {
    const { data: team } = await client
      .from("teams")
      .select("user_id")
      .eq("id", teamId)
      .single();
    uid = team?.user_id ?? null;
  }
  if (!uid) return null;

  const { data: user } = await client
    .from("users")
    .select("discord_id, discord_dm_enabled, discord_dm_prefs, language")
    .eq("id", uid)
    .single();

  if (!user?.discord_id) return null;
  if (user.discord_dm_enabled === false) return null;

  return { discordId: user.discord_id, prefs: user.discord_dm_prefs ?? {}, language: user.language ?? null };
}
