// Population-swap (#1103) — pensionér legacy-ryttere (rigtige navne, pcm_id IS NOT NULL)
// ved relaunch til frisk sæson 1. Ikke-destruktivt: rows bevares (is_retired=true,
// team_id=null) for historik + rollback. Kun fiktive (pcm_id IS NULL) forbliver aktive.
//
// Rollback: reactivateLegacyRiders sætter is_retired=false igen (team_id genskabes
// ikke — re-aktiverede legacy-ryttere går til free agency).

async function countActiveLegacy(supabase, retired) {
  const { count, error } = await supabase
    .from("riders")
    .select("id", { count: "exact", head: true })
    .not("pcm_id", "is", null)
    .is("is_retired", retired);
  if (error) throw new Error(`legacy-count: ${error.message}`);
  return count ?? null;
}

export async function retireLegacyRiders(supabase, { dryRun = true } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (dryRun) {
    return { dryRun: true, wouldRetire: await countActiveLegacy(supabase, false) };
  }
  const { data, error } = await supabase
    .from("riders")
    .update({ is_retired: true, team_id: null })
    .not("pcm_id", "is", null)
    .select("id");
  if (error) throw new Error(`retireLegacyRiders: ${error.message}`);
  return { dryRun: false, retired: data?.length ?? 0 };
}

export async function reactivateLegacyRiders(supabase, { dryRun = true } = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (dryRun) {
    return { dryRun: true, wouldReactivate: await countActiveLegacy(supabase, true) };
  }
  const { data, error } = await supabase
    .from("riders")
    .update({ is_retired: false })
    .not("pcm_id", "is", null)
    .select("id");
  if (error) throw new Error(`reactivateLegacyRiders: ${error.message}`);
  return { dryRun: false, reactivated: data?.length ?? 0 };
}
