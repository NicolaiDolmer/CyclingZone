// #4750/ejer 5/9 — read-only prod-maaling til KALIBRERING (ikke et rollback-spoergsmaal
// laengere: det permanente +1/dag-loft er allerede shippet, se docs/TRAINING_RULES.md §2.2).
//
// ERSTATTER den tidligere, snaevrere maaling i denne fil (den talte KUN S3-akademi-
// signeringer og kunne ikke bevise et enkelt-dags spring uden et foer-signering-baseline,
// se git-historik). Ejerens langsigtede mål 5/9 er en anden model: udviklingsraterne skal
// kalibreres saa det permanente loft SJAELDENT binder — det kraever at vide, hvor ofte det
// HISTORISK (foer loftet fandtes) rent faktisk gjorde. Denne version maaler netop det, paa
// TVAERS af hele S3-populationen, ikke kun akademi-signeringer.
//
// Metode:
//   1. Find aktiv saeson (seasons.status='active').
//   2. Hent ALLE rider_derived_ability_history-raekker med source='daily_training' og
//      snapshot_date >= saesonens start_date, paginated (PostgREST 1000-raekke-loft, #3331,
//      via .range()).
//   3. Gruppér pr. rytter, sortér efter dato (allerede sorteret af queryen). For hvert par af
//      PAA-HINANDEN-FOELGENDE historik-raekker (samme rytter): for hver VISIBLE_ABILITIES-nøgle,
//      delta = evne(næste snapshot) − evne(nuværende snapshot). delta >= 2 tælles som ÉT
//      (rytter, dag-par, evne)-tilfælde.
//   4. Historik-rækker skrives KUN på dage med mindst én faktisk gevinst (flade dage springes
//      over af selve motoren, dailyTrainingEngine.js:499-503) — to på-hinanden-følgende RÆKKER
//      kan derfor være adskilt af >1 kalenderdag, hvis rytteren havde en flad dag imellem.
//      Vi rapporterer BEGGE tal: "any_gap" (alle på-hinanden-følgende rækker, uanset
//      kalenderafstand — literalt "fra én snapshot-dag til den næste") og
//      "same_day_adjacent" (kun par hvor kalenderafstanden er præcis 1 dag — det strammeste
//      bevis for et ÉGTE enkelt-tick-spring, uforstyrret af akkumuleret flerdages-vækst).
//   5. Rytterens alder PAA SNAPSHOT-DAGEN (via riderAge, samme helper som
//      valuationScorecard.js) og rytterens potentiale (statisk, ændrer sig ikke) bestemmer
//      hvilken (alders-bånd, potentiale)-bucket tilfældet lægges i.
//
// Alders-bånd følger ACADEMY-konstanterne (academyFlag.js: MIN_AGE 16, MAX_AGE 21,
// graduering ved 22, youthMultiplier-aftrapning 16→22): 16-17 (peak youthMultiplier),
// 18-19, 20-21 (akademiets sidste år), 22+ (voksen/graduate — youthMultiplier=1.0, men
// gap-proportional vækst kan stadig give store deltaer for lav-evne pot6-voksne).
// Potentiale rapporteres RAAT (1-6), ingen opfundne bånd.
//
// INGEN navne, INGEN rytter-id'er i outputtet — kun aggregerede tal pr. bucket.
// INGEN writes. Kun SELECT.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { riderAge } from "../lib/valuationScorecard.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("Mangler SUPABASE_URL/SUPABASE_SERVICE_KEY i backend/.env - kan ikke maale prod.");
  process.exit(1);
}
const supabase = createClient(url, key);

const PAGE = 1000; // PostgREST-loft, #3331
const RIDER_CHUNK = 200; // samme portioneringsmønster som backfillCores.js

const AGE_BANDS = Object.freeze([
  { key: "16-17", min: 16, max: 17 },
  { key: "18-19", min: 18, max: 19 },
  { key: "20-21", min: 20, max: 21 },
  { key: "22+", min: 22, max: Infinity },
]);
function ageBandFor(age) {
  if (age == null || !Number.isFinite(age)) return "ukendt";
  const band = AGE_BANDS.find((b) => age >= b.min && age <= b.max);
  return band ? band.key : "ukendt";
}

function daysBetween(dateStrA, dateStrB) {
  const a = new Date(dateStrA + "T12:00:00Z").getTime();
  const b = new Date(dateStrB + "T12:00:00Z").getTime();
  return Math.round((b - a) / 86400000);
}

async function fetchAllHistory(sinceDate) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("rider_derived_ability_history")
      .select("rider_id, snapshot_date, abilities")
      .eq("source", "daily_training")
      .gte("snapshot_date", sinceDate)
      .order("rider_id", { ascending: true })
      .order("snapshot_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`rider_derived_ability_history: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function fetchRidersInfo(riderIds) {
  const byId = new Map();
  for (let i = 0; i < riderIds.length; i += RIDER_CHUNK) {
    const chunk = riderIds.slice(i, i + RIDER_CHUNK);
    const { data, error } = await supabase
      .from("riders").select("id, birthdate, potentiale").in("id", chunk);
    if (error) throw new Error(`riders: ${error.message}`);
    for (const r of data ?? []) byId.set(r.id, r);
  }
  return byId;
}

function emptyBucket(ageBand, potentiale) {
  return {
    ageBand, potentiale,
    consecutivePairs: 0,
    pairsWithAnyJump2Plus: 0,
    abilityJumpInstances2Plus: 0,
    sameDayAdjacentPairs: 0,
    sameDayAdjacentPairsWithJump2Plus: 0,
  };
}

async function main() {
  const { data: season, error: seasonErr } = await supabase
    .from("seasons").select("id, number, start_date").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(`seasons: ${seasonErr.message}`);
  if (!season) { console.log(JSON.stringify({ ok: false, reason: "no_active_season" })); return; }

  const history = await fetchAllHistory(season.start_date);
  console.log(`S${season.number}: ${history.length} daily_training-snapshots siden ${season.start_date}.`);

  const byRider = new Map();
  for (const row of history) {
    if (!byRider.has(row.rider_id)) byRider.set(row.rider_id, []);
    byRider.get(row.rider_id).push(row);
  }

  const ridersInfo = await fetchRidersInfo([...byRider.keys()]);

  const buckets = new Map();
  let totalConsecutivePairs = 0;
  let totalPairsWithAnyJump = 0;
  let totalInstances = 0;
  let totalSameDayAdjacentPairs = 0;
  let totalSameDayAdjacentWithJump = 0;

  for (const [riderId, rows] of byRider) {
    const info = ridersInfo.get(riderId);
    for (let i = 0; i < rows.length - 1; i++) {
      const cur = rows[i];
      const next = rows[i + 1];
      const gap = daysBetween(cur.snapshot_date, next.snapshot_date);
      if (gap <= 0) continue; // korrupt/duplikeret dato — spring over, tæller ikke
      totalConsecutivePairs++;

      const age = info?.birthdate ? riderAge(info.birthdate, new Date(cur.snapshot_date + "T12:00:00Z")) : null;
      const band = ageBandFor(age);
      const pot = info?.potentiale ?? "ukendt";
      const bucketKey = `${band}|pot${pot}`;
      if (!buckets.has(bucketKey)) buckets.set(bucketKey, emptyBucket(band, pot));
      const bucket = buckets.get(bucketKey);
      bucket.consecutivePairs++;
      const isSameDayAdjacent = gap === 1;
      if (isSameDayAdjacent) { bucket.sameDayAdjacentPairs++; totalSameDayAdjacentPairs++; }

      let pairHadJump = false;
      for (const ability of VISIBLE_ABILITIES) {
        const before = Number(cur.abilities?.[ability]);
        const after = Number(next.abilities?.[ability]);
        if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
        if (after - before >= 2) {
          bucket.abilityJumpInstances2Plus++;
          totalInstances++;
          pairHadJump = true;
        }
      }
      if (pairHadJump) {
        bucket.pairsWithAnyJump2Plus++;
        totalPairsWithAnyJump++;
        if (isSameDayAdjacent) { bucket.sameDayAdjacentPairsWithJump2Plus++; totalSameDayAdjacentWithJump++; }
      }
    }
  }

  const breakdown = [...buckets.values()].sort((a, b) =>
    a.ageBand === b.ageBand
      ? String(a.potentiale).localeCompare(String(b.potentiale))
      : a.ageBand.localeCompare(b.ageBand));

  console.log(JSON.stringify({
    ok: true,
    season: season.number,
    seasonStartDate: season.start_date,
    totalDailyTrainingSnapshots: history.length,
    totalRidersObserved: byRider.size,
    totalConsecutiveSnapshotPairs: totalConsecutivePairs,
    anyGap: {
      pairsWithAbilityJumpOf2Plus: totalPairsWithAnyJump,
      abilityJumpInstances2Plus: totalInstances,
      shareOfPairsPct: totalConsecutivePairs > 0
        ? Math.round((totalPairsWithAnyJump / totalConsecutivePairs) * 10000) / 100 : null,
    },
    sameDayAdjacentOnly: {
      note: "Strammeste bevis for et ÉGTE enkelt-tick-spring (kalenderafstand præcis 1 dag mellem to snapshots) — uforstyrret af akkumuleret flerdages-vækst.",
      pairs: totalSameDayAdjacentPairs,
      pairsWithAbilityJumpOf2Plus: totalSameDayAdjacentWithJump,
      shareOfPairsPct: totalSameDayAdjacentPairs > 0
        ? Math.round((totalSameDayAdjacentWithJump / totalSameDayAdjacentPairs) * 10000) / 100 : null,
    },
    note: "Måling FØR det permanente +1/dag-loft (#4750/ejer 5/9) blev shippet — historikken er snapshottet med den gamle uden-loft-adfærd og viser derfor hvor tit et enkelt tick VILLE have ramt loftet. Datagrundlag for et separat kalibrerings-issue (§2.2 i TRAINING_RULES.md). Ingen navne/id'er, kun aggregater pr. (alders-bånd, potentiale).",
    breakdown,
  }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
