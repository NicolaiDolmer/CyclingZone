/** Dry-run-kilden er den senest afsluttede sæson, ikke en kommende sæsonrække. */
export async function loadLatestCompletedSeason(supabase) {
  return supabase.from("seasons")
    .select("id, number, status")
    .eq("status", "completed")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
}
