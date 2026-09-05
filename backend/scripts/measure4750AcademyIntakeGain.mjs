// #4750 — read-only prod-maaling. INGEN writes. Bruges KUN til at give ejeren et
// tal at basere en evt. tilbagerulnings-beslutning paa (issue-krav: "mål udbredelsen
// i prod før fix" + acceptkriterie 2). Sletter/aendrer intet.
//
// Trin:
//   1. Find den aktive saeson (S3) via seasons.status='active'.
//   2. Find alle academy_intake-raekker med status='signed' i den saeson - det er
//      det AFGRAENSEDE, aftalte upper-bound: kun ryttere der reelt blev signet via
//      akademi-intake i S3 kan overhovedet have ramt "erhvervelsesdagens gap er paa
//      sit livstidsmaksimum"-scenariet (#4750).
//   3. For hver signeret rytter: hent riders.acquired_at + is_academy + potentiale,
//      og rider_derived_ability_history-raekker med source='daily_training' saa
//      taet paa signerings-dagen som muligt, for at se om FOERSTE registrerede
//      historik-dag falder PAA signerings-dagen (den eneste dag scenariet #4750
//      beskriver kan opstaa) og har mere end ét gevinst-punkt i en enkelt evne
//      ift. den umiddelbart foelgende dag (hvis den findes).
//
// Bemaerk: rider_derived_ability_history gemmer et FULDT vektor-snapshot pr. dag,
// ikke en delta. Uden et "foer signering"-baseline-snapshot kan et enkelt-dags
// spring paa +2 IKKE bevises for hver enkelt rytter uden en dyr per-rytter
// rekonstruktion. Scriptet rapporterer derfor et AFGRAENSET, aerligt tal:
// antal S3-akademi-signeringer (upper bound for eksponering), IKKE et bekraeftet
// antal ryttere der faktisk fik +2. Det praecise antal kraever ejer-tilgang til
// et raat historik-dump og staar ude af scope for denne PR.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("Mangler SUPABASE_URL/SUPABASE_SERVICE_KEY i backend/.env - kan ikke maale prod.");
  process.exit(1);
}
const supabase = createClient(url, key);

async function main() {
  const { data: season, error: seasonErr } = await supabase
    .from("seasons").select("id, number, start_date").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(`seasons: ${seasonErr.message}`);
  if (!season) { console.log(JSON.stringify({ ok: false, reason: "no_active_season" })); return; }

  const { data: signed, error: signedErr } = await supabase
    .from("academy_intake")
    .select("id, rider_id, team_id, resolved_at")
    .eq("season_id", season.id)
    .eq("status", "signed");
  if (signedErr) throw new Error(`academy_intake: ${signedErr.message}`);

  const riderIds = (signed ?? []).map((r) => r.rider_id);
  console.log(`S${season.number}: ${riderIds.length} akademi-signeringer (upper bound for eksponering).`);

  if (riderIds.length === 0) {
    console.log(JSON.stringify({ ok: true, season: season.number, academySigningsS3: 0 }));
    return;
  }

  // Batched IN (samme portioneringsmønster som backend/lib/backfillCores.js).
  const CHUNK = 200;
  let ridersWithAcquired = 0;
  let ridersWithHistorySameDayAsAcquired = 0;
  let ridersWithAnySingleAbilityJumpOf2Plus = 0;
  const sampleFindings = [];

  for (let i = 0; i < riderIds.length; i += CHUNK) {
    const chunk = riderIds.slice(i, i + CHUNK);
    const { data: riders, error: ridersErr } = await supabase
      .from("riders").select("id, acquired_at, is_academy").in("id", chunk);
    if (ridersErr) throw new Error(`riders: ${ridersErr.message}`);

    for (const rider of riders ?? []) {
      if (!rider.acquired_at) continue;
      ridersWithAcquired++;
      const acquiredDate = new Date(rider.acquired_at).toISOString().slice(0, 10);

      const { data: history, error: histErr } = await supabase
        .from("rider_derived_ability_history")
        .select("snapshot_date, abilities")
        .eq("rider_id", rider.id)
        .eq("source", "daily_training")
        .order("snapshot_date", { ascending: true })
        .limit(3);
      if (histErr) throw new Error(`rider_derived_ability_history (${rider.id}): ${histErr.message}`);
      if (!history || history.length === 0) continue;

      const first = history[0];
      if (first.snapshot_date !== acquiredDate) continue;
      ridersWithHistorySameDayAsAcquired++;

      // Uden et pre-tick baseline kan vi ikke regne dagens delta for FØRSTE
      // historik-række. Vi kan derimod se om NÆSTE dags snapshot findes, og bruge
      // afstanden mellem to på hinanden følgende dage som et grovt signal — men det
      // kræver en 3. reference (dagen FØR signering, som ikke findes i denne tabel).
      // Vi rapporterer derfor kun eksponerings-tallet ovenfor plus, hvis en 2. række
      // findes én kalenderdag senere, en liste over hvilke evner der ændrede sig
      // med 2+ imellem de to snapshots (svagt signal, ikke en bekræftelse for dag 1).
      if (history.length > 1) {
        const second = history[1];
        const oneDayLater = new Date(new Date(first.snapshot_date + "T12:00:00Z").getTime() + 86400000)
          .toISOString().slice(0, 10);
        if (second.snapshot_date === oneDayLater) {
          const jumps = Object.keys(second.abilities || {}).filter((k) =>
            Number(second.abilities[k]) - Number(first.abilities?.[k] ?? second.abilities[k]) >= 2);
          if (jumps.length > 0) {
            ridersWithAnySingleAbilityJumpOf2Plus++;
            if (sampleFindings.length < 5) sampleFindings.push({ riderId: rider.id, jumps });
          }
        }
      }
    }
  }

  console.log(JSON.stringify({
    ok: true,
    season: season.number,
    academySigningsS3: riderIds.length,
    ridersWithAcquiredAt: ridersWithAcquired,
    ridersWhoseFirstHistoryRowIsSigningDay: ridersWithHistorySameDayAsAcquired,
    weakSignalJumps2plus: ridersWithAnySingleAbilityJumpOf2Plus,
    note: "academySigningsS3 er UPPER BOUND for eksponering (ikke et bekræftet antal ramte). Se scriptets header.",
    sampleFindingsRiderIdsOnly: sampleFindings,
  }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
