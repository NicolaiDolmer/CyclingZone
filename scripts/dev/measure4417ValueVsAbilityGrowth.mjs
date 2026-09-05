// READ-ONLY måling til #4417 — hvor mange ryttere har udviklet sig ABILITY-
// mæssigt i et 14-dages vindue uden at markedsværdien (riders.market_value)
// er blevet rørt siden (proxy: riders.updated_at).
//
// Bruger backend/.env, kun SELECT. Ingen rytternavne i output.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const ABILITY_KEYS = [
  "climbing", "time_trial", "sprint", "punch", "endurance", "cobblestone",
  "acceleration", "recovery", "tactics", "positioning", "flat", "tempo",
  "durability", "descending", "aggression",
];

async function fetchAll(table, select, apply = (q) => q) {
  const pageSize = 1000;
  let from = 0;
  const out = [];
  for (;;) {
    let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
    q = apply(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

function sumAbilities(row) {
  let s = 0;
  for (const k of ABILITY_KEYS) { const v = Number(row?.[k]); if (Number.isFinite(v)) s += v; }
  return s;
}

async function main() {
  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 14);
  const cutoffIso = cutoffDate.toISOString().slice(0, 10);

  const riders = await fetchAll(
    "riders",
    "id, updated_at, is_retired, is_academy, team_id, market_value",
    (q) => q.eq("is_retired", false).not("team_id", "is", null),
  );
  const riderById = new Map(riders.map((r) => [r.id, r]));
  const riderIds = riders.map((r) => r.id);

  const nowAbilities = await fetchAll("rider_derived_abilities", "rider_id, " + ABILITY_KEYS.join(", "));
  const nowByRider = new Map(nowAbilities.map((r) => [r.rider_id, r]));

  // Ældste history-snapshot pr. rytter der er PÅ ELLER FØR cutoff (dvs. ~14 dage
  // gammel eller ældre) — vi vil sammenligne "abilities dengang" mod "nu".
  const oldSnaps = await fetchAll(
    "rider_derived_ability_history",
    "rider_id, snapshot_date, abilities",
    (q) => q.lte("snapshot_date", cutoffIso).order("snapshot_date", { ascending: false }),
  );
  const oldByRider = new Map();
  for (const s of oldSnaps) {
    if (!oldByRider.has(s.rider_id)) oldByRider.set(s.rider_id, s); // første = nyeste <= cutoff, pga. order
  }

  const lastSunday = new Date();
  // find seneste søndag (UTC)
  lastSunday.setUTCDate(lastSunday.getUTCDate() - lastSunday.getUTCDay());
  const lastSundayIso = lastSunday.toISOString().slice(0, 10);

  let matched = 0, grew = 0, grewButStaleValue = 0;
  const growthBuckets = { none: 0, small: 0, notable: 0, large: 0 };

  for (const riderId of riderIds) {
    const rider = riderById.get(riderId);
    const now = nowByRider.get(riderId);
    const old = oldByRider.get(riderId);
    if (!rider || !now || !old || !old.abilities) continue;
    matched += 1;

    const nowSum = sumAbilities(now);
    const oldSum = sumAbilities(old.abilities);
    const delta = nowSum - oldSum;

    if (delta <= 0) growthBuckets.none += 1;
    else if (delta < 5) growthBuckets.small += 1;
    else if (delta < 15) growthBuckets.notable += 1;
    else growthBuckets.large += 1;

    if (delta >= 5) {
      grew += 1;
      const updatedAt = rider.updated_at ? rider.updated_at.slice(0, 10) : null;
      const staleValue = !updatedAt || updatedAt < lastSundayIso;
      if (staleValue) grewButStaleValue += 1;
    }
  }

  console.log("=== #4417 — evne-vaekst vs. vaerdi-touch (proxy: riders.updated_at), 14-dages vindue ===");
  console.log(`Cutoff-dato (14 dage tilbage): ${cutoffIso}`);
  console.log(`Seneste soendag (UTC): ${lastSundayIso}`);
  console.log(`Ryttere med baade now-abilities og >=14 dage gammel snapshot: ${matched}`);
  console.log("Vaekst-fordeling (delta = sum af 15 evner, nu minus for 14+ dage siden):");
  console.log(`  ingen/negativ vaekst: ${growthBuckets.none}`);
  console.log(`  lille vaekst (1-4 point samlet): ${growthBuckets.small}`);
  console.log(`  maerkbar vaekst (5-14 point samlet): ${growthBuckets.notable}`);
  console.log(`  stor vaekst (15+ point samlet): ${growthBuckets.large}`);
  console.log(`\nRyttere med maerkbar+ vaekst (>=5 point): ${grew}`);
  console.log(`...heraf med market_value UBERØRT siden foer seneste soendag (updated_at < ${lastSundayIso}): ${grewButStaleValue} (${grew ? (100 * grewButStaleValue / grew).toFixed(1) : "n/a"}%)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
