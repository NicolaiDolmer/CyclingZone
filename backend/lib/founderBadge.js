// Founder-badge (#1103) — permanent achievement til beta-grundlæggere ved relaunch.
//
// Tildeles alle menneske-managers (samme selector som beta-reset) og UNDTAGES fra
// resetBetaAchievements, så badgen overlever fremtidige resets. Tosproget i UI:
// frontend oversætter title/description via i18n-namespace "achievements" (key =
// achievement-id) med DB-værdien (engelsk, kanonisk) som fallback. category lægges
// under den eksisterende "sæson"-gruppe (åbningssæsonen) for at undgå ny rå-dansk
// kategori-overflade. INGEN em-dash (player-facing copy-regel).

export const FOUNDER_BADGE_KEY = "founder_badge";

// DB-def = kanonisk engelsk fallback. UI oversætter via i18n (en+da). Ingen em-dash.
export const FOUNDER_BADGE_DEF = Object.freeze({
  id: FOUNDER_BADGE_KEY,
  category: "sæson",
  title: "Founding Manager",
  description: "Here from the opening season. Permanent. Survives every reset.",
  icon: "🏅",
  is_secret: false,
  sort_order: 0,
});

export async function ensureFounderBadgeDef(supabase, { dryRun = true } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (dryRun) return { ensured: false, dryRun: true };
  const { error } = await supabase.from("achievements").upsert(FOUNDER_BADGE_DEF, { onConflict: "id" });
  if (error) throw new Error(`ensureFounderBadgeDef: ${error.message}`);
  return { ensured: true };
}

// Tildel founder-badge til alle beta-managers der ikke allerede har den (idempotent).
// managerUserIds kan injiceres (orchestratoren har dem allerede); ellers hentes de
// via samme selector som beta-reset.
export async function grantFounderBadges(supabase, { dryRun = true, managerUserIds, now } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  await ensureFounderBadgeDef(supabase, { dryRun });

  let userIds = managerUserIds;
  if (!userIds) {
    const { getBetaManagerTeams } = await import("./betaResetService.js");
    const teams = await getBetaManagerTeams(supabase);
    userIds = teams.map((t) => t.user_id);
  }
  userIds = [...new Set((userIds || []).filter(Boolean))];

  const { data: existing, error } = await supabase
    .from("manager_achievements")
    .select("user_id")
    .eq("achievement_id", FOUNDER_BADGE_KEY);
  if (error) throw new Error(`grantFounderBadges read: ${error.message}`);
  const have = new Set((existing || []).map((r) => r.user_id));
  const toGrant = userIds.filter((id) => !have.has(id));

  if (dryRun) return { dryRun: true, eligible: userIds.length, wouldGrant: toGrant.length };
  if (toGrant.length === 0) return { eligible: userIds.length, granted: 0 };

  const stamp = now || new Date().toISOString();
  const rows = toGrant.map((user_id) => ({ user_id, achievement_id: FOUNDER_BADGE_KEY, unlocked_at: stamp }));
  const { error: insErr } = await supabase.from("manager_achievements").insert(rows);
  if (insErr) throw new Error(`grantFounderBadges insert: ${insErr.message}`);
  return { eligible: userIds.length, granted: rows.length };
}
