// READ-ONLY måling til #4704 — er puncheur-potentialet (loft-rating pr. type,
// beregnet af den FAKTISKE kode i weights/displayRecipes.js) systematisk
// næsthøjest blandt de 8 typer, på tværs af populationen?
//
// Bruger backend/.env (SUPABASE_URL + SUPABASE_SERVICE_KEY), kun SELECT.
// Ingen rytternavne, ingen rå vægte i output — kun aggregerede rangfordelinger.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { ratingForRole, DISPLAY_RECIPE_KEYS } from "../../backend/lib/weights/displayRecipes.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function fetchAll(table, select, filters = (q) => q) {
  const pageSize = 1000;
  let from = 0;
  const out = [];
  for (;;) {
    let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
    q = filters(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function main() {
  const riders = await fetchAll("riders", "id, primary_type, secondary_type, is_retired");
  const activeRiders = riders.filter((r) => !r.is_retired);
  const riderById = new Map(activeRiders.map((r) => [r.id, r]));

  const abilities = await fetchAll("rider_derived_abilities", "rider_id, ability_caps");

  let n = 0;
  const rankCounts = Object.fromEntries(DISPLAY_RECIPE_KEYS.map((k) => [k, [0, 0, 0, 0, 0, 0, 0, 0]])); // index = rank-1
  const rankCountsByPrimary = new Map(); // primaryType -> rank array for puncheur
  let punchTop3 = 0;

  for (const row of abilities) {
    const rider = riderById.get(row.rider_id);
    if (!rider || !row.ability_caps) continue;
    const caps = row.ability_caps;
    const ratings = DISPLAY_RECIPE_KEYS.map((key) => ({ key, rating: ratingForRole(caps, key) }))
      .filter((r) => r.rating != null);
    if (ratings.length < DISPLAY_RECIPE_KEYS.length) continue; // ufuldstændig række, spring over
    ratings.sort((a, b) => b.rating - a.rating);
    n += 1;
    ratings.forEach((r, idx) => { rankCounts[r.key][idx] += 1; });

    const punchRank = ratings.findIndex((r) => r.key === "puncheur") + 1;
    if (punchRank >= 1 && punchRank <= 3) punchTop3 += 1;

    const primary = rider.primary_type ?? "ukendt";
    if (!rankCountsByPrimary.has(primary)) rankCountsByPrimary.set(primary, [0, 0, 0, 0, 0, 0, 0, 0]);
    rankCountsByPrimary.get(primary)[punchRank - 1] += 1;
  }

  const expectedShare = 1 / DISPLAY_RECIPE_KEYS.length; // uafhængig-baseline for "top-3"
  const expectedTop3 = expectedShare * 3;

  console.log("=== #4704 — potentiale-rang pr. type (ability_caps, faktisk kode), hele populationen ===");
  console.log(`Ryttere maalt (fuldt udfyldte evne-caps): ${n}`);
  console.log(`Forventet andel i top-3 hvis uafhaengig fordeling: ${(expectedTop3 * 100).toFixed(1)}%\n`);

  console.log("-- Rang-fordeling pr. type (rang 1 = hoejeste af de 8) --");
  for (const key of DISPLAY_RECIPE_KEYS) {
    const counts = rankCounts[key];
    const pretty = counts.map((c, i) => `r${i + 1}:${((100 * c) / n).toFixed(1)}%`).join(" ");
    const top3 = ((100 * (counts[0] + counts[1] + counts[2])) / n).toFixed(1);
    console.log(`${key}: ${pretty}  [top3=${top3}%]`);
  }

  console.log(`\nPuncheur specifikt i top-3 (rang 1-3 blandt 8): ${((100 * punchTop3) / n).toFixed(1)}% af alle ryttere`);

  console.log("\n-- Puncheur-rang opdelt paa rytterens PRIMÆRE arketype (ekskl. selve puncheur-typen) --");
  for (const [primary, counts] of rankCountsByPrimary) {
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const pretty = counts.map((c, i) => `r${i + 1}:${((100 * c) / total).toFixed(1)}%`).join(" ");
    console.log(`primary=${primary} (n=${total}): ${pretty}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
