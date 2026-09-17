// Dry-run #4860 (ejer-beslutning 17/9) — READ-ONLY, kun SELECT.
//
// Viser for hver pending S4-aftale hvad de to rettelser ville have givet:
//
//   A  Før første løb: da aftalen blev tegnet var S3's season_standings tom, så
//      renownTarget faldt til multiplier 1,00. Med A ville S2's SLUTSTILLING have
//      været brugt i stedet. A-kolonnen er derfor guaranteed_base prissat mod
//      S2-stillingen, med aftalens EGEN variant-fraktion og signed_division.
//
//   D  Ikke-svar: hvad holdet ville have fået tildelt hvis det ALDRIG havde valgt.
//      Default-'safe' prissættes nu til vindues-prisen (S2's slutstilling, fordi
//      tilbudsvinduet for S4 åbnede da S3 startede og standings var tom),
//      begrænset opad af S3's slutstilling.
//
// Pointen er ejerens invariant: D må aldrig ligge OVER det manageren selv kunne
// have fået samme dag. Kolonnen `D>A?` skal være tom hele vejen ned.
//
// Scriptet SKRIVER ingenting. Ingen UPDATE, ingen INSERT, ingen RPC.
//
//   infisical run --env=dev -- node backend/scripts/dry-run-4860-small.js
//   infisical run --env=prod -- node backend/scripts/dry-run-4860-small.js

import { createClient } from "@supabase/supabase-js";

import { SPONSOR_INCOME_BY_DIVISION } from "../lib/economyConstants.js";
import { renownTarget } from "../lib/renownEngine.js";
import { generateOffers } from "../lib/sponsorOffers.js";

const TARGET_START_SEASON = Number(process.env.DRY_RUN_START_SEASON || 4);
const DEFAULT_VARIANT = "safe";

async function loadSeasonStandings(supabase, seasonNumber) {
  if (seasonNumber < 1) return [];
  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, number")
    .eq("number", seasonNumber)
    .maybeSingle();
  if (seasonError) throw seasonError;
  if (!season?.id) return [];

  const { data, error } = await supabase
    .from("season_standings")
    .select("season_id, team_id, division, rank_in_division, total_points")
    .eq("season_id", season.id);
  if (error) throw error;
  return data || [];
}

// Samme opslag som loadRenownTargetValue: holdets egen række, og medianen fra
// den division holdet FAKTISK kørte i den sæson (standingens egen division).
function targetFrom(standings, teamId, division) {
  const mine = standings.find((s) => s.team_id === teamId) || null;
  const divisionStandings = mine ? standings.filter((s) => s.division === mine.division) : [];
  return renownTarget({ division, lastSeasonStanding: mine, divisionStandings });
}

function baseForVariant(teamId, seasonNumber, target, variant) {
  const offer = generateOffers({
    teamId,
    seasonNumber,
    renownTargetValue: target,
  }).find((o) => o.variant === variant);
  return offer ? offer.guaranteedBase : null;
}

function fmt(n) {
  return n === null || n === undefined ? "-" : Number(n).toLocaleString("da-DK");
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error(
      "FEJL: Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY (kør via `infisical run --env=dev -- node backend/scripts/dry-run-4860-small.js`)",
    );
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const windowOpenStandings = await loadSeasonStandings(supabase, TARGET_START_SEASON - 2);
  const finalStandings = await loadSeasonStandings(supabase, TARGET_START_SEASON - 1);

  const { data: pending, error: pendingError } = await supabase
    .from("sponsor_contracts")
    .select(
      "id, team_id, variant, guaranteed_base, guaranteed_fraction, signed_division, length_seasons, created_at",
    )
    .eq("status", "pending")
    .eq("start_season", TARGET_START_SEASON);
  if (pendingError) throw pendingError;

  const teamIds = [...new Set((pending || []).map((c) => c.team_id))];
  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, name, division")
    .in("id", teamIds);
  if (teamsError) throw teamsError;
  const teamById = new Map((teams || []).map((t) => [t.id, t]));

  console.log(
    `\n#4860 dry-run (READ-ONLY) — ${pending?.length || 0} pending S${TARGET_START_SEASON}-aftaler\n`,
  );
  console.log(
    "| Hold | Variant | Tegnet | Prissat div | Base i dag | A (S%d-stilling) | D (tavshed, safe) | D>A? |".replace(
      "%d",
      TARGET_START_SEASON - 2,
    ),
  );
  console.log("|---|---|---|---|---|---|---|---|");

  let violations = 0;
  let deltaSum = 0;

  const rows = (pending || []).slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  for (const contract of rows) {
    const team = teamById.get(contract.team_id) || null;
    const division = Number.isInteger(contract.signed_division)
      ? contract.signed_division
      : (team?.division ?? null);
    const variant = contract.variant || DEFAULT_VARIANT;

    const windowOpenTarget = targetFrom(windowOpenStandings, contract.team_id, division);
    const finalTarget = targetFrom(finalStandings, contract.team_id, division);

    // A bider KUN på aftaler der blev tegnet mens stillingen var tom — dem hvor det
    // frosne target ligger på divisionens flade base (multiplier 1,00). Er aftalen
    // tegnet efter sæsonens første løb, har den allerede en rigtig multiplier, og A
    // ville ikke have ændret noget. Udledningen af target er den samme baglæns-regning
    // som recomputeActivationRate bruger (docs/SPONSOR_RULES.md §1).
    const signedTarget = contract.guaranteed_fraction
      ? Math.round(contract.guaranteed_base / contract.guaranteed_fraction)
      : null;
    const flatBase = SPONSOR_INCOME_BY_DIVISION[division] ?? null;
    const appliesA =
      signedTarget !== null && flatBase !== null && Math.abs(signedTarget - flatBase) <= 1;
    // A: managerens EGEN variant, prissat mod den stilling A ville have fundet.
    const aBase = appliesA
      ? baseForVariant(contract.team_id, TARGET_START_SEASON, windowOpenTarget, variant)
      : contract.guaranteed_base;
    // D: default-'safe' til vindues-prisen, begrænset opad af slutstillingen.
    const dBase = baseForVariant(
      contract.team_id,
      TARGET_START_SEASON,
      Math.min(windowOpenTarget, finalTarget),
      DEFAULT_VARIANT,
    );
    // Sammenligningen der skal holde: tavshed mod samme 'safe'-valg samme dag.
    const safeToday = baseForVariant(
      contract.team_id,
      TARGET_START_SEASON,
      finalTarget,
      DEFAULT_VARIANT,
    );
    const breaksInvariant = dBase !== null && safeToday !== null && dBase > safeToday;
    if (breaksInvariant) violations += 1;
    if (aBase !== null) deltaSum += aBase - contract.guaranteed_base;

    console.log(
      `| ${team?.name ?? contract.team_id} | ${variant} | ${(contract.created_at || "").slice(0, 10)} | D${division ?? "?"} | ${fmt(contract.guaranteed_base)} | ${fmt(aBase)} | ${fmt(dBase)} | ${breaksInvariant ? "JA" : ""} |`,
    );
  }

  console.log(
    `\nSum af (A − base i dag) over ${rows.length} aftaler: ${deltaSum >= 0 ? "+" : ""}${fmt(deltaSum)} CZ$`,
  );
  console.log(
    `Invariant "tavshed må aldrig give mere end handling samme dag": ${violations === 0 ? "holder for alle rækker" : `BRUDT for ${violations} rækker`}`,
  );
  console.log("\nIngen skrivninger foretaget (SELECT only).\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
