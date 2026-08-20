// backend/lib/aiContractAutoRenewal.js
// #1150 · AI-hold har ingen manager til at trykke "forlæng" (#1720/extend-contract)
// — uden en automatisk beslutning ville contract_expiry_release (#2744-B) frigive
// ALLE deres udløbne senior-kontrakter blindt, ligesom for menneskehold. Ved
// S1→S2 (196 ryttere, 195 på AI-hold, prod 23/7) var det trygt: værste AI-hold
// endte med 18 ryttere tilbage, langt over MIN_RIDERS_FOR_RACE=8.
//
// Ved S2→S3 er billedet et andet — dry-run mod prod 5/8 (scripts/dryRunContractExpirySeasonEnd.js)
// viser AI-hold der ville falde fra 8-12 ryttere til 3-5 hvis intet fornys, under
// BÅDE MIN_RIDERS_FOR_RACE=8 (marketUtils.js) og DIVISION_SQUAD_LIMITS-gulvet
// (boardConstants.js, division 3/4 = min 8). Uden denne fase ville hele
// divisioner risikere AI-hold der ikke kan stille et løbshold ved cutover —
// et FUNKTIONELT brud, ikke kun en balance-ulejlighed, og langt værre end den
// oprindelige worst-case-måling (#2748, 23/7) antog for den daværende, mindre
// population.
//
// Løsningen: AI-hold "genforhandler" automatisk ALLE deres udløbende senior-
// kontrakter — samme rene prisformel som en manager ville fået ved at trykke
// "forlæng" (computeContractExtension, contractSeed.js, #1720). Ingen ny
// prissætning opfindes her. Ingen pengeomkostning (matcher extend-contract-
// endpointet præcist: "Ingen pengebevægelse — kun kontraktfelterne opdateres").
//
// Kører FØR contract_expiry_release i samme transitions-fase (seasonTransition.js),
// så en fornyet AI-rytter aldrig rammer release-forespørgslens <=-gate — ingen
// ændring af contractExpiryRelease.js's forespørgsel er nødvendig, fornyelsen
// udelukker sig selv naturligt (samme komposition som en menneske-manager der
// selv har trykket "forlæng" før skiftet).
//
// Menneskehold RØRES ALDRIG her — deres beslutning forbliver frivillig
// (extend-contract via UI). Ejer-designvalget "genforhandling MED frigivelse"
// (#1150, 3/8) betyder netop at ikke-handling = frigivelse for MENNESKER; AI-hold
// har ingen "ikke-handling"-mulighed at udtrykke, og den sikre erstatning for et
// hold uden manager er "forny altid" (matcher hvordan AI-hold allerede opfører
// sig andre steder i motoren — ingen strategisk exit-beslutning, kun overlevelse
// af squad-integriteten). **Åben for ejer-review, se PR-beskrivelsen.**

import { fetchAllRows } from "./supabasePagination.js";
import { computeContractExtension } from "./contractSeed.js";
import { captureException } from "./sentry.js";

async function defaultFetchExpiringAiContractRiders({ supabase, seasonNumber }) {
  return fetchAllRows(() =>
    supabase
      .from("riders")
      .select(
        "id, firstname, lastname, team_id, contract_length, contract_end_season, current_production_value, " +
          "team:team_id!inner(is_ai, is_bank, is_frozen, is_test_account, division)"
      )
      .not("team_id", "is", null)
      .eq("is_academy", false)
      .eq("is_retired", false)
      .lte("contract_end_season", seasonNumber)
      .eq("team.is_ai", true)
      .eq("team.is_bank", false)
      .eq("team.is_frozen", false)
      .eq("team.is_test_account", false)
      .order("id")
  );
}

/**
 * #1150 · Automatisk kontraktfornyelse for AI-hold ved sæsonskifte.
 * Kaldes fra seasonTransition.js som en ny, isoleret fase (parallelt/FØR
 * contract_expiry_release) — en fejl her må ALDRIG vælte resten af transitionen
 * (samme disciplin som de øvrige additive faser, fx contractExpiryRelease.js).
 *
 * Idempotent: en fornyet rytter får contract_end_season > seasonNumber, så en
 * re-run (samme sæson) finder ham ikke igen via <=-gaten.
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {number} args.seasonNumber — den AFSLUTTEDE sæsons nummer (fromSeason.number),
 *   samme værdi som sendes til releaseExpiredContractRiders og bruges som
 *   `currentSeason`-anker i computeContractExtension (spejler manuel
 *   extend-contract kaldt lige inden sæsonskiftet).
 * @param {Function} [args.fetchExpiringAiContractRiders] — injicerbar (test)
 * @returns {Promise<{candidates:number, renewed:number, failed:number}>}
 */
export async function renewExpiringAiContracts({
  supabase,
  seasonNumber,
  fetchExpiringAiContractRiders = defaultFetchExpiringAiContractRiders,
}) {
  const stats = { candidates: 0, renewed: 0, failed: 0 };
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!Number.isFinite(seasonNumber)) return stats;

  let candidates;
  try {
    candidates = await fetchExpiringAiContractRiders({ supabase, seasonNumber });
  } catch (err) {
    err.partialStats = { ...stats };
    throw err;
  }
  stats.candidates = candidates.length;
  if (!candidates.length) return stats;

  for (const rider of candidates) {
    try {
      const next = computeContractExtension({
        current_production_value: rider.current_production_value,
        contract_end_season: rider.contract_end_season,
        contract_length: rider.contract_length,
        currentSeason: seasonNumber,
      });

      // Concurrency-guard: kun forny hvis rytteren stadig er på det hold vi læste
      // (samme mønster som releaseExpiredContractRiders).
      const { data: updated, error } = await supabase
        .from("riders")
        .update({
          salary: next.salary,
          contract_length: next.contract_length,
          contract_end_season: next.contract_end_season,
        })
        .eq("id", rider.id)
        .eq("team_id", rider.team_id)
        .select("id");
      if (error) throw new Error(`renewExpiringAiContracts(${rider.id}): ${error.message}`);
      if (!updated || updated.length === 0) continue;
      stats.renewed += 1;
    } catch (err) {
      stats.failed += 1;
      console.error(`  ❌ ai-contract-auto-renewal fejlede for rytter ${rider.id}:`, err?.message || err);
      captureException(err, { tags: { flow: "season-transition", stage: "ai-contract-auto-renewal" }, riderId: rider.id });
    }
  }

  return stats;
}
