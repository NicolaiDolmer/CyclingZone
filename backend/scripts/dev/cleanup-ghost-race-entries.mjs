// Engangs-oprydning (#1800/#1742/#1823 Rod B): slet "ghost"-race_entries i KOMMENDE
// (scheduled, ikke-startede) løb — entries hvis rytter er akademi, pensioneret, solgt/
// fyret (off-team) eller slettet. Disse renderede blankt i lineup, talte i 6/6 og låste
// redigeringen (kunne ikke fjernes). Eligibility-koden forhindrer NYE; dette rydder de
// eksisterende (264 akademi + 151 off-team målt 2026-06-25).
//
// Genbruger den DELTE isEligibleRider-helper, så scriptet og runtime-koden er enige om
// hvad en ghost er. Dry-run default; --apply sletter. READ-tunge dele paginerer.
//
// Dry-run: infisical run --env=prod -- node backend/scripts/dev/cleanup-ghost-race-entries.mjs
// Apply:   infisical run --env=prod -- node backend/scripts/dev/cleanup-ghost-race-entries.mjs --apply
import { createClient } from "@supabase/supabase-js";
import { isEligibleRider } from "../../lib/riderEligibility.js";

const APPLY = process.argv.includes("--apply");
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY (kør via infisical run --env=prod)");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const PAGE = 1000;
async function selectAll(table, columns, applyFilters) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(columns).range(from, from + PAGE - 1);
    if (applyFilters) q = applyFilters(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function main() {
  // 1. Kommende løb (scheduled, ingen etaper kørt) — kun her må vi røre felter.
  const races = await selectAll("races", "id, status, stages_completed",
    (q) => q.eq("status", "scheduled"));
  const futureIds = new Set(races.filter((r) => (r.stages_completed ?? 0) === 0).map((r) => r.id));
  console.log(`Kommende (scheduled, ikke-startede) løb: ${futureIds.size}`);

  // 2. Alle entries i de løb.
  const entries = (await selectAll("race_entries", "race_id, rider_id, team_id"))
    .filter((e) => futureIds.has(e.race_id));
  console.log(`Entries i kommende løb: ${entries.length}`);

  // 3. Ryttere for entry-id'erne (id, team_id, is_academy, is_retired) — chunked .in().
  const riderIds = [...new Set(entries.map((e) => e.rider_id))];
  const ridersById = new Map();
  for (let i = 0; i < riderIds.length; i += 200) {
    const chunk = riderIds.slice(i, i + 200);
    const { data, error } = await db.from("riders")
      .select("id, team_id, is_academy, is_retired").in("id", chunk);
    if (error) throw new Error(`riders: ${error.message}`);
    for (const r of data || []) ridersById.set(r.id, r);
  }

  // 4. Klassificér ghosts via den delte helper (samme definition som runtime).
  const cat = { academy: 0, retired: 0, offTeam: 0, missing: 0 };
  const ghosts = [];
  for (const e of entries) {
    const r = ridersById.get(e.rider_id);
    if (isEligibleRider(r, { teamId: e.team_id })) continue;
    if (!r) cat.missing++;
    else if (r.is_academy === true) cat.academy++;
    else if (r.is_retired === true) cat.retired++;
    else cat.offTeam++;
    ghosts.push(e);
  }
  console.log(`Ghost-entries: ${ghosts.length}`, cat);
  if (ghosts.length) {
    console.log("Eksempel (op til 5):", ghosts.slice(0, 5));
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — intet slettet. Kør med --apply for at slette.");
    return;
  }
  // 5. Slet ghost-entries (PK = race_id, rider_id). Én pr. række — lavt volumen (~400).
  let deleted = 0;
  for (const e of ghosts) {
    const { error } = await db.from("race_entries").delete()
      .eq("race_id", e.race_id).eq("rider_id", e.rider_id).eq("team_id", e.team_id);
    if (error) throw new Error(`delete (${e.race_id}/${e.rider_id}): ${error.message}`);
    deleted++;
  }
  console.log(`\nAPPLY — slettede ${deleted} ghost-entries.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
