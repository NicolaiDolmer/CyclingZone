// Reparation #4376 — sæson 3s sponsor-timing-hul + divisions-tillæg-efterbetaling
// + tilbageførsel af det for meget udbetalte, i ét script.
//
// UDBETALINGSMODEL FOR guaranteed_base (bevis, verificeret FØR trin (c) blev bygget):
//   `guaranteed_base` er et ENGANGSBELØB udbetalt ved sæsonstart, IKKE en løbende
//   ydelse. Bevis: docs/SPONSOR_RULES.md linje 27 ("Den garanterede del, udbetalt
//   ved sæsonstart" / "Frosset ved valg-tidspunktet. Rører sig ALDRIG i kontraktens
//   løbetid"); backend/lib/sponsorContractsService.js linje ~559 ("INGEN
//   guaranteed_base-udbetaling her. Basen krediteres udelukkende af
//   economyEngine.processSeasonStart ved den næste RIGTIGE sæson-start"); og denne
//   fils EGEN oprindelige (a)-kommentar ("guaranteed_base var allerede udbetalt som
//   engangsbeløb ved sæsonstart 23/8"). Ingen finance_transactions-rækker at
//   forholdsmæssigt nedskalere — HELE beløbet ramte balancen én gang. Derfor er
//   tilbageførslen model (a) fra opgavebeskrivelsen: clawback = base_før − base_efter
//   (fuldt), ikke en sum af delvise udbetalinger.
//
// TRE TING I ÉN KØRSEL (ejer-beslutning 4/9 kl. ~16:15 om selve timing-hullet,
// `gh issue view 4376 --comments`; ejer-beslutning 4/9 kl. ~17:10 om tilbageførslen:
// "De hold der skal miste penge skal også gøre det i dag, og få det fjernet fra
// deres konto. Dem der har manglet penge skal få dem nu." — dette OVERSKRIVER (a)'s
// oprindelige "ingen nedad-korrektion i S3"-grandfathering for netop disse 29 hold):
//
//   (a) NED — TIMING-HUL (docs/audits/auto-sponsor-aftaler-2026-09-04.md +
//       docs/audits/sponsor-timing-hul-alle-divisioner-2026-09-04.md): 30 hold (D1 3,
//       D2 15, D3 12) fik deres auto-'safe'-fornyelse ved sæsonskiftet 23/8 prissat
//       mod den NYE division (komprimeringen skriver oprykningen til teams.division
//       FØR expireAndRenewContracts kører i samme batch — lukket ved kilden i #4376s
//       timing-fix, backend/lib/sponsorContractsService.js). Disse 30 hold fik derfor
//       den fulde nye divisions base i stedet for den gamle. Dette script retter
//       `guaranteed_base` og `signed_division` på deres AKTIVE kontrakt til hvad
//       fornyelsen VILLE have skrevet med timing-fixet på plads — samme
//       renownTarget/generateOffers-kæde som motoren selv bruger, prissat mod holdets
//       season_standings-division fra sæsonen der lige sluttede (S2). Selve UPDATE'et
//       flytter ingen penge — det er trin (c) nedenfor der gør det.
//
//   (c) NED — TILBAGEFØRSEL AF FOR MEGET UDBETALT (ny, 4/9 ~17:10): for de hold hvor
//       (a) rettede `guaranteed_base` NED (base_efter < base_før — 29 af de 30, ét
//       hold havde kun forkert signed_division, ikke forkert beløb), trækkes
//       differencen (base_før − base_efter) fra holdets saldo via DEN SAMME
//       atomiske sti som (b) (incrementBalanceWithAudit/debitTeam-mønstret,
//       negativt delta), reason_code `sponsor_division_correction_clawback` (egen
//       kode, IKKE genbrugt fra SPONSOR_DIVISION_CORRECTION — den er opad, denne er
//       nedad). Egen idempotency_key pr. kontrakt (sponsorDivisionClawbackIdempotencyKey)
//       — kan ikke dobbelt-trækkes ved gentagen kørsel.
//
//   (b) OP — DIVISIONS-TILLÆGGET (backend/lib/divisionAdjustment.js, "gulv + 50 %"):
//       ALLE hold prissat under deres NUVÆRENDE division — inklusive de 30 fra (a),
//       med deres NETOP korrigerede `signed_division` — får S3-korrektionslinjen
//       udbetalt via den EKSISTERENDE atomiske balance-sti
//       (incrementBalanceWithAudit), ALDRIG en direkte UPDATE på teams.balance.
//       Samme idempotency_key som motoren (divisionAdjustmentIdempotencyKey) —
//       kan derfor ikke dobbeltbetale med hverken economyEngine.processSeasonStart
//       eller scripts/creditDivisionAdjustment-4376.mjs, uanset kørselsrækkefølge.
//       Ejer-valg 5 (29/8): kun opad i S3 — computeDivisionAdjustment håndhæver det
//       selv via DOWNWARD_ADJUSTMENT_ENABLED=false, scriptet gætter ikke.
//
//   NETTO PR. HOLD: (c) og (b) er to SEPARATE transaktioner (revisionsspor — ingen
//   sammenlægning i selve bogføringen), men rapporteres samlet som `netByTeam` og
//   bruges samlet i negativ-saldo-guarden: et hold der ville gå under 0 CZ$ efter
//   BEGGE bevægelser stopper HELE apply (samme abort-mønster som repair-4485).
//
// MODELLERET PRÆCIS EFTER repair-4485-young-classification.js: samme dry-run/apply-
// struktur, samme backup-før-skrivning-disciplin, samme negativ-saldo-guard, samme
// --apply/--confirm/OWNER_ACK-gate.
//
// MIGRATION-AFHÆNGIGHED: `sponsor_contracts.signed_division` findes først efter
// database/2026-08-29-division-adjustment.sql er applied (CI, post-merge, #2642).
// Kør scriptet FØR det, og det opdager den manglende kolonne og stopper med en klar
// besked i stedet for at fejle kryptisk eller gætte.
//
// KØR ALDRIG mod prod uden ejer-godkendelse:
//   node backend/scripts/repair-4376-sponsor-division-correction.js
//       → dry-run (DEFAULT): fuld rapport, read-only. Intet skrives.
//   node backend/scripts/repair-4376-sponsor-division-correction.js --apply --confirm "REPAIR 4376 SPONSOR DIVISION CORRECTION"
//       → RIGTIG kørsel. Kræver DESUDEN REPAIR_4376_OWNER_ACK=true i miljøet.
//         Backup skrives FØR enhver ændring (backup_4376_*-tabellerne, DDL i
//         database/2026-09-04-4376-backup-tables.sql). Post-verify køres til sidst.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { renownTarget } from "../lib/renownEngine.js";
import { generateOffers } from "../lib/sponsorOffers.js";
import { resolveDivisionAdjustment, divisionAdjustmentIdempotencyKey } from "../lib/divisionAdjustment.js";
import { incrementBalanceWithAudit } from "../lib/balanceRpc.js";
import { FINANCE_ACTOR_TYPE, FINANCE_REASON, FINANCE_RELATED_ENTITY } from "../lib/economyConstants.js";
import { fetchAllRows } from "../lib/supabasePagination.js";

export const SEASON_NUMBER = 3;
export const BACKUP_CONTRACTS_TABLE = "backup_4376_sponsor_contracts_20260904";
export const BACKUP_TEAMS_TABLE = "backup_4376_teams_balance_20260904";

// Sæsonskifte-batchens skrivevindue (S2→S3, 23/8 — begge audits), UTC. Alle 30
// timing-hul-kontrakter blev oprettet i dette vindue af expireAndRenewContracts'
// default-gren; intet uden for vinduet er en auto-batch-fornyelse.
export const TIMING_HOLE_WINDOW_START = "2026-08-23T18:21:48Z";
export const TIMING_HOLE_WINDOW_END = "2026-08-23T18:23:01Z";

// ─── Rene funktioner (testbare uden DB, node --test) ───────────────────────────

export function isInTimingHoleWindow(createdAt) {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= new Date(TIMING_HOLE_WINDOW_START).getTime() && t <= new Date(TIMING_HOLE_WINDOW_END).getTime();
}

/**
 * Finder aktive kontrakter ramt af #4376-timing-hullet: auto-'safe'-fornyelser
 * (variant 'safe', length_seasons 1 — #2914-defaulten) oprettet i sæsonskifte-
 * batchens skrivevindue, for et hold hvis S2-standings-division er DÅRLIGERE
 * (højere tal) end dets nuværende division — altså oprykket i den samme
 * transition kontrakten blev skrevet i. Samme kriterie som
 * docs/audits/sponsor-timing-hul-alle-divisioner-2026-09-04.md.
 *
 * @param {Array<object>} contracts  aktive sponsor_contracts-rækker
 * @param {Map<string,object>} teamById
 * @param {Map<string,number>} oldDivisionByTeamId  team_id -> season_standings.division (S2)
 * @returns {Array<{contract:object, team:object, oldDivision:number}>}
 */
export function detectTimingHoleContracts({ contracts = [], teamById = new Map(), oldDivisionByTeamId = new Map() }) {
  const hits = [];
  for (const contract of contracts) {
    if (contract.status !== "active") continue;
    if (contract.variant !== "safe" || contract.length_seasons !== 1) continue;
    if (!isInTimingHoleWindow(contract.created_at)) continue;

    const team = teamById.get(contract.team_id);
    const oldDivision = oldDivisionByTeamId.get(contract.team_id);
    if (!team || !Number.isInteger(team.division)) continue;
    if (!Number.isInteger(oldDivision)) continue;
    if (oldDivision <= team.division) continue; // ikke oprykket i denne transition

    hits.push({ contract, team, oldDivision });
  }
  return hits;
}

/**
 * Den `guaranteed_base` en 'safe'-fornyelse VILLE have fået med #4376s timing-fix
 * på plads: samme renownTarget/generateOffers-kæde som
 * sponsorContractsService.expireAndRenewContracts, blot prissat mod `oldDivision`
 * i stedet for holdets nuværende (nye) division.
 */
export function correctedSafeGuaranteedBase({ oldDivision, lastSeasonStanding = null, divisionStandings = [], seasonNumber = SEASON_NUMBER }) {
  const target = renownTarget({ division: oldDivision, lastSeasonStanding, divisionStandings });
  const offers = generateOffers({ teamId: "repair-4376", seasonNumber, renownTargetValue: target });
  const safe = offers.find((o) => o.variant === "safe");
  return safe ? safe.guaranteedBase : null;
}

/**
 * Bygger listen af faktiske NED-rettelser (a): kun hold hvor det korrigerede
 * `guaranteed_base` eller den korrigerede `signed_division` faktisk AFVIGER fra
 * den lagrede værdi. En gentaget kørsel efter apply finder derfor 0 tilbage
 * (idempotent), selvom detection-kriteriet (batch-vindue + oprykning) stadig
 * matcher de samme rækker.
 *
 * @param {Array<{contract:object, team:object, oldDivision:number}>} hits
 * @param {Map<string,object>} standingByTeamId
 * @param {Array<object>} allStandings  hele S2-standings (til divisionStandings-filtrering)
 * @param {number} seasonNumber
 */
export function buildTimingHoleCorrections(hits, standingByTeamId, allStandings, seasonNumber = SEASON_NUMBER) {
  return hits.map(({ contract, team, oldDivision }) => {
    const mine = standingByTeamId.get(team.id) || null;
    const divisionStandings = allStandings.filter((s) => s.division === oldDivision);
    const guaranteedBaseAfter = correctedSafeGuaranteedBase({ oldDivision, lastSeasonStanding: mine, divisionStandings, seasonNumber });
    const needsUpdate =
      guaranteedBaseAfter !== contract.guaranteed_base || contract.signed_division !== oldDivision;
    return {
      contract_id: contract.id,
      team_id: team.id,
      team_name: team.name,
      division_now: team.division,
      signed_division_before: contract.signed_division,
      signed_division_after: oldDivision,
      guaranteed_base_before: contract.guaranteed_base,
      guaranteed_base_after: guaranteedBaseAfter,
      needsUpdate,
    };
  });
}

/**
 * Divisions-tillægget (b) for ALLE hold med en aktiv kontrakt, ud fra en EFFEKTIV
 * signed_division pr. hold (de 30 NED-rettede hold bruger deres NYE — dvs.
 * korrigerede gamle — signed_division, andre bruger den lagrede uændret).
 * Ren funktion: resolveDivisionAdjustment (divisionAdjustment.js) håndhæver selv
 * "kun opad i S3" via DOWNWARD_ADJUSTMENT_ENABLED.
 *
 * @returns {Array<{team_id, team_name, division_now, signed_division, raw, correction_cz, modifier}>}
 */
export function buildDivisionAdjustments({
  contractByTeamId,
  teamById,
  effectiveSignedDivisionByTeamId,
  modifierByTeamId,
  seasonNumber = SEASON_NUMBER,
}) {
  const out = [];
  for (const [teamId, contract] of contractByTeamId.entries()) {
    const team = teamById.get(teamId);
    if (!team) continue;
    const signedDivision = effectiveSignedDivisionByTeamId.get(teamId);
    if (!Number.isInteger(signedDivision)) continue;

    const modifier = modifierByTeamId.get(teamId) ?? 1.0;
    const result = resolveDivisionAdjustment({
      team,
      contract: { ...contract, signed_division: signedDivision },
      seasonNumber,
      modifier,
    });
    if (!result.applies) continue;
    out.push({
      team_id: teamId,
      team_name: team.name,
      division_now: team.division,
      signed_division: signedDivision,
      raw: result.raw,
      correction_cz: result.payout,
      modifier,
    });
  }
  return out;
}

/**
 * Hold der ville gå under 0 CZ$ af en NEGATIV korrektion. I sæson 3 er dette
 * strukturelt umuligt (DOWNWARD_ADJUSTMENT_ENABLED=false → alle payouts >= 0),
 * men guarden er generisk og genbrugelig hvis scriptet nogensinde køres for en
 * sæson hvor nedad er slået til.
 */
export function findNegativeBalanceRisk(divisionAdjustments, teamById) {
  const risks = [];
  for (const adj of divisionAdjustments) {
    if (adj.correction_cz >= 0) continue;
    const team = teamById.get(adj.team_id);
    const balance = team?.balance || 0;
    const projected = balance + adj.correction_cz;
    if (projected < 0) {
      risks.push({ team_id: adj.team_id, balance, correction_cz: adj.correction_cz, projectedBalance: projected });
    }
  }
  return risks;
}

/**
 * Tilbageførsel (c): guaranteed_base var et ENGANGSBELØB udbetalt ved sæsonstart
 * (se header-kommentar for beviset) — clawback pr. hold er derfor det FULDE
 * for-meget-udbetalte: guaranteed_base_before − guaranteed_base_after. Hold hvor
 * (a) kun rettede signed_division (basen var allerede korrekt) får INGEN clawback.
 *
 * @param {Array<object>} timingHoleCorrections  fra buildTimingHoleCorrections, filtreret til needsUpdate
 * @param {Map<string,object>} teamById
 */
export function buildClawbacks(timingHoleCorrections, teamById = new Map()) {
  const out = [];
  for (const c of timingHoleCorrections) {
    const diff = c.guaranteed_base_before - c.guaranteed_base_after;
    if (!(diff > 0)) continue; // 0 eller negativ (basen gik ikke ned) → ingen clawback
    const team = teamById.get(c.team_id);
    out.push({
      contract_id: c.contract_id,
      team_id: c.team_id,
      team_name: c.team_name,
      division_now: c.division_now,
      base_before: c.guaranteed_base_before,
      base_after: c.guaranteed_base_after,
      already_paid: c.guaranteed_base_before,
      clawback_cz: diff,
      balance_now: team?.balance ?? null,
    });
  }
  return out;
}

/**
 * Idempotency-nøgle for tilbageførslen — pr. kontrakt (kontrakten flyttes aldrig,
 * så nøglen er stabil på tværs af gentagne kørsler; samme mønster som
 * divisionAdjustmentIdempotencyKey i divisionAdjustment.js).
 */
export function sponsorDivisionClawbackIdempotencyKey(teamId, contractId) {
  return `sponsor_division_correction_clawback:${teamId}:${contractId}`;
}

/**
 * Nettoeffekt pr. hold af (b) divisions-tillæg OG (c) clawback — til rapportering
 * (`netByTeam`) og til den kombinerede negativ-saldo-guard. (b) og (c) forbliver
 * to separate bogførte transaktioner; dette er kun en beregnet oversigt.
 */
export function buildNetByTeam({ divisionAdjustments = [], clawbacks = [], teamById = new Map() }) {
  const byTeam = new Map();
  const ensure = (teamId) => {
    if (!byTeam.has(teamId)) {
      const team = teamById.get(teamId);
      byTeam.set(teamId, {
        team_id: teamId,
        team_name: team?.name ?? null,
        division_adjustment_cz: 0,
        clawback_cz: 0,
      });
    }
    return byTeam.get(teamId);
  };
  for (const adj of divisionAdjustments) {
    ensure(adj.team_id).division_adjustment_cz += adj.correction_cz;
  }
  for (const c of clawbacks) {
    ensure(c.team_id).clawback_cz += c.clawback_cz;
  }
  return [...byTeam.values()].map((r) => ({ ...r, net_cz: r.division_adjustment_cz - r.clawback_cz }));
}

/**
 * Negativ-saldo-guard for den KOMBINEREDE effekt af (b)+(c) — erstatter den rene
 * (b)-only findNegativeBalanceRisk ovenfor i selve rapporten/apply-guarden, fordi
 * (c) (nyt 4/9) kan trække et hold under 0 selvom (b) alene aldrig kan (S3 er
 * kun-opad for divisions-tillægget).
 */
export function findCombinedNegativeBalanceRisk({ divisionAdjustments = [], clawbacks = [], teamById = new Map() }) {
  const net = buildNetByTeam({ divisionAdjustments, clawbacks, teamById });
  const risks = [];
  for (const r of net) {
    if (r.net_cz >= 0) continue;
    const team = teamById.get(r.team_id);
    const balance = team?.balance || 0;
    const projected = balance + r.net_cz;
    if (projected < 0) {
      risks.push({ team_id: r.team_id, team_name: r.team_name, balance, net_cz: r.net_cz, projectedBalance: projected });
    }
  }
  return risks;
}

// ─── Orkestrering (DB injiceres — testbar uden createClient) ───────────────────

// #2642: signed_division findes først efter database/2026-08-29-division-adjustment.sql
// er applied. Uden den kan hverken timing-hul-detektion eller divisions-tillægget
// regnes korrekt — scriptet skal sige det klart, ikke gætte eller fejle kryptisk.
async function hasSignedDivisionColumn(supabase) {
  // schema-columns-ok: signed_division tilfoejes af database/2026-08-29-division-adjustment.sql,
  // som per #2642 applies EFTER merge. Denne funktion detekterer NETOP fravaeret af kolonnen
  // (42703) foer migrationen er koert — det er hele formaalet med kaldet, ikke en fejl.
  const { error } = await supabase.from("sponsor_contracts").select("signed_division").limit(1);
  if (!error) return true;
  if (error.code === "42703" || /signed_division/i.test(error.message || "")) return false;
  throw error;
}

/**
 * Bygger den fulde reparationsplan (NED-rettelser + OP-tillæg) uden at skrive
 * noget. Bruges af BÅDE dry-run og apply.
 */
export async function buildRepairPlan({ supabase, seasonNumber = SEASON_NUMBER, log = () => {} }) {
  const migrationApplied = await hasSignedDivisionColumn(supabase);
  if (!migrationApplied) {
    log("[4376] signed_division-kolonnen findes ikke endnu — migrationen (database/2026-08-29-division-adjustment.sql) er ikke applied. Kan ikke bygge en plan.");
    return { migrationApplied: false, seasonNumber };
  }

  const { data: seasonRows, error: seasonsErr } = await supabase
    .from("seasons").select("id, number").in("number", [seasonNumber - 1, seasonNumber]);
  if (seasonsErr) throw new Error(`seasons: ${seasonsErr.message}`);
  const seasonByNumber = new Map((seasonRows || []).map((s) => [s.number, s]));
  const currentSeason = seasonByNumber.get(seasonNumber);
  if (!currentSeason) throw new Error(`Sæson ${seasonNumber} findes ikke`);
  const prevSeason = seasonByNumber.get(seasonNumber - 1) || null;

  // Samme menneske-hold-population som creditDivisionAdjustment-4376.mjs/
  // processSeasonStart (is_ai/is_bank/is_frozen/is_test_account = false).
  const teams = await fetchAllRows(() =>
    supabase
      .from("teams")
      .select("id, name, division, balance")
      .eq("is_ai", false).eq("is_bank", false).eq("is_frozen", false).eq("is_test_account", false)
      .order("id", { ascending: true })
  );
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // schema-columns-ok: signed_division tilfoejes af database/2026-08-29-division-adjustment.sql,
  // som per #2642 applies EFTER merge. Snapshot'et er et spejl af prod og kan derfor foerst
  // opdateres naar migrationen er koert — samme undtagelse som scripts/creditDivisionAdjustment-
  // 4376.mjs, fjernes sammen med snapshot-refresh i close-out-commit'en.
  const contracts = await fetchAllRows(() =>
    supabase
      .from("sponsor_contracts")
      .select("id, team_id, sponsor_name, variant, length_seasons, status, guaranteed_base, guaranteed_fraction, race_day_share, signed_division, created_at")
      .eq("status", "active")
      .order("id", { ascending: true })
  );
  const contractByTeamId = new Map(
    contracts.filter((c) => teamById.has(c.team_id)).map((c) => [c.team_id, c])
  );

  let standings = [];
  if (prevSeason?.id) {
    standings = await fetchAllRows(() =>
      supabase
        .from("season_standings")
        .select("season_id, team_id, division, rank_in_division, total_points")
        .eq("season_id", prevSeason.id)
        .order("team_id", { ascending: true })
    );
  }
  const standingByTeamId = new Map(standings.map((s) => [s.team_id, s]));
  const oldDivisionByTeamId = new Map(standings.map((s) => [s.team_id, s.division]));

  const hits = detectTimingHoleContracts({
    contracts: [...contractByTeamId.values()],
    teamById,
    oldDivisionByTeamId,
  });
  const allTimingHoleCorrections = buildTimingHoleCorrections(hits, standingByTeamId, standings, seasonNumber);
  const timingHoleCorrections = allTimingHoleCorrections.filter((c) => c.needsUpdate);
  const timingHoleAlreadyCorrect = allTimingHoleCorrections.filter((c) => !c.needsUpdate);

  // Effektiv signed_division pr. hold: de 30 (a)-rettede hold bruger deres NYE
  // (korrigerede gamle) division; alle andre bruger den allerede lagrede værdi.
  const effectiveSignedDivisionByTeamId = new Map(
    [...contractByTeamId.entries()].map(([teamId, c]) => [teamId, c.signed_division])
  );
  for (const c of allTimingHoleCorrections) {
    effectiveSignedDivisionByTeamId.set(c.team_id, c.signed_division_after);
  }

  // Bestyrelsens modifier + sponsor-pullout — samme beregning som
  // creditDivisionAdjustment-4376.mjs/processSeasonStart.
  const boards = await fetchAllRows(() =>
    supabase
      .from("board_profiles")
      .select("team_id, budget_modifier, negotiation_status")
      .eq("negotiation_status", "completed")
      .order("team_id", { ascending: true })
  );
  const modifierBuckets = new Map();
  for (const b of boards) {
    const bucket = modifierBuckets.get(b.team_id) || { sum: 0, n: 0 };
    bucket.sum += Number(b.budget_modifier ?? 1.0);
    bucket.n += 1;
    modifierBuckets.set(b.team_id, bucket);
  }
  const { data: pullouts, error: pulloutErr } = await supabase
    .from("board_consequences").select("team_id, severity").eq("layer", 5).eq("status", "active");
  if (pulloutErr) throw new Error(`board_consequences: ${pulloutErr.message}`);
  const pulloutByTeamId = new Map((pullouts || []).map((p) => [p.team_id, (p.severity || 1000) / 1000]));
  const modifierByTeamId = new Map();
  for (const teamId of teamById.keys()) {
    const bucket = modifierBuckets.get(teamId);
    const baseModifier = bucket && bucket.n > 0 ? bucket.sum / bucket.n : 1.0;
    modifierByTeamId.set(teamId, baseModifier * (pulloutByTeamId.get(teamId) ?? 1.0));
  }

  const divisionAdjustments = buildDivisionAdjustments({
    contractByTeamId, teamById, effectiveSignedDivisionByTeamId, modifierByTeamId, seasonNumber,
  });
  const teamsToPay = divisionAdjustments.filter((d) => d.correction_cz !== 0);

  // (c) tilbageførsel — kun de timing-hul-hold hvor guaranteed_base faktisk gik NED
  // (se buildClawbacks). Beregnes af NEEDS-UPDATE-listen (timingHoleCorrections),
  // ikke allTimingHoleCorrections — et hold der allerede er korrekt har intet at
  // tilbageføre.
  const clawbacks = buildClawbacks(timingHoleCorrections, teamById);
  const netByTeam = buildNetByTeam({ divisionAdjustments: teamsToPay, clawbacks, teamById });
  const negativeBalanceRisk = findCombinedNegativeBalanceRisk({ divisionAdjustments: teamsToPay, clawbacks, teamById });

  return {
    migrationApplied: true,
    seasonNumber,
    seasonId: currentSeason.id,
    teamById,
    contractByTeamId,
    timingHoleCorrections,
    timingHoleAlreadyCorrect,
    divisionAdjustments,
    teamsToPay,
    clawbacks,
    netByTeam,
    negativeBalanceRisk,
  };
}

function timingHoleTotalsByDivision(corrections) {
  const totals = {};
  for (const c of corrections) {
    const key = `D${c.division_now}`;
    totals[key] = (totals[key] || 0) + 1;
  }
  return totals;
}

/**
 * Kører reparationen. dryRun (default true): kun rapport, intet skrevet.
 * apply=true: backup → (a) UPDATE guaranteed_base+signed_division på de 30
 * timing-hul-kontrakter → (b) divisions-tillæg via incrementBalanceWithAudit →
 * post-verify. Stopper FØR enhver skrivning hvis en korrektion ville sende et
 * hold under 0 CZ$ (strukturelt umuligt i S3, men tjekket alligevel).
 */
export async function runRepair({ supabase, seasonNumber = SEASON_NUMBER, dryRun = true, log = console.log }) {
  const plan = await buildRepairPlan({ supabase, seasonNumber, log });

  if (!plan.migrationApplied) {
    return {
      dryRun,
      seasonNumber,
      migrationApplied: false,
      message: "Migrationen database/2026-08-29-division-adjustment.sql er ikke applied endnu (sponsor_contracts.signed_division findes ikke). Kør igen efter merge + CI-apply.",
    };
  }

  // netByTeam bærer balance_after (net af BEGGE bevægelser) — merges ind i hver
  // clawback-række, så dry-run-rapporten kan vise det uden en ekstra opslags-tabel.
  const netByTeamId = new Map(plan.netByTeam.map((r) => [r.team_id, r]));
  const clawbacksWithBalanceAfter = plan.clawbacks.map((c) => {
    const net = netByTeamId.get(c.team_id);
    const balanceAfter = c.balance_now == null || !net ? null : c.balance_now + net.net_cz;
    return { ...c, balance_after: balanceAfter };
  });

  const report = {
    dryRun,
    seasonNumber,
    migrationApplied: true,
    timingHoleCorrections: plan.timingHoleCorrections,
    timingHoleAlreadyCorrect: plan.timingHoleAlreadyCorrect.length,
    timingHoleTotalsByDivision: timingHoleTotalsByDivision(plan.timingHoleCorrections),
    divisionAdjustments: plan.divisionAdjustments,
    clawbacks: clawbacksWithBalanceAfter,
    netByTeam: plan.netByTeam,
    negativeBalanceRisk: plan.negativeBalanceRisk,
    totals: {
      timingHoleTeams: plan.timingHoleCorrections.length,
      adjustmentTeams: plan.teamsToPay.length,
      adjustmentTotalCz: plan.teamsToPay.reduce((s, d) => s + d.correction_cz, 0),
      adjustmentUpwardCz: plan.teamsToPay.filter((d) => d.correction_cz > 0).reduce((s, d) => s + d.correction_cz, 0),
      adjustmentDownwardCz: plan.teamsToPay.filter((d) => d.correction_cz < 0).reduce((s, d) => s + d.correction_cz, 0),
      clawbackTeams: plan.clawbacks.length,
      clawbackTotalCz: plan.clawbacks.reduce((s, c) => s + c.clawback_cz, 0),
    },
  };

  if (dryRun) {
    log(`[4376] DRY-RUN — ${report.totals.timingHoleTeams} hold timing-hul-rettet, ${report.totals.adjustmentTeams} hold divisions-tillæg (${report.totals.adjustmentTotalCz} CZ$), ${report.totals.clawbackTeams} hold tilbageførsel (${report.totals.clawbackTotalCz} CZ$ i alt), intet skrevet.`);
    return report;
  }

  if (plan.negativeBalanceRisk.length) {
    log(`[4376] APPLY STOPPET — ${plan.negativeBalanceRisk.length} hold ville gå under 0 CZ$. Ingen skrivning foretaget.`);
    report.aborted = true;
    report.abortReason = "negative_balance_risk";
    return report;
  }

  // ── Trin 0: BACKUP FØR SKRIVNING ──────────────────────────────────────────
  if (plan.timingHoleCorrections.length) {
    const contractRows = plan.timingHoleCorrections.map((c) => ({
      ...plan.contractByTeamId.get(c.team_id),
      captured_at: new Date().toISOString(),
    }));
    const { error: backupContractsErr } = await supabase.from(BACKUP_CONTRACTS_TABLE).upsert(contractRows, { onConflict: "id" });
    if (backupContractsErr) throw new Error(`backup sponsor_contracts: ${backupContractsErr.message}`);
  }
  // Backup-tabellen for saldi skal dække ALLE hold der rammes af (b) ELLER (c) —
  // union af de to lister, ét backup-forsøg pr. hold (upsert on team_id).
  const teamsTouchedByMoney = new Map();
  for (const d of plan.teamsToPay) teamsTouchedByMoney.set(d.team_id, true);
  for (const c of plan.clawbacks) teamsTouchedByMoney.set(c.team_id, true);
  if (teamsTouchedByMoney.size) {
    const teamsBackup = [...teamsTouchedByMoney.keys()].map((teamId) => ({
      team_id: teamId,
      balance_before: plan.teamById.get(teamId)?.balance ?? null,
      captured_at: new Date().toISOString(),
    }));
    const { error: backupTeamsErr } = await supabase.from(BACKUP_TEAMS_TABLE).upsert(teamsBackup, { onConflict: "team_id" });
    if (backupTeamsErr) throw new Error(`backup teams: ${backupTeamsErr.message}`);
  }

  // ── Trin (a): NED — ren datarettelse, INGEN balance-bevægelse i sig selv ────
  for (const c of plan.timingHoleCorrections) {
    const { error } = await supabase
      .from("sponsor_contracts")
      .update({ guaranteed_base: c.guaranteed_base_after, signed_division: c.signed_division_after })
      .eq("id", c.contract_id);
    if (error) throw new Error(`update sponsor_contracts ${c.contract_id}: ${error.message}`);
  }

  // ── Trin (c): NED — tilbageførsel af det for meget udbetalte (ejer 4/9 ~17:10) ──
  let clawedBack = 0, clawbackSkipped = 0, totalClawedBack = 0;
  for (const c of plan.clawbacks) {
    const { skipped: wasSkipped } = await incrementBalanceWithAudit(
      supabase,
      {
        teamId: c.team_id,
        delta: -c.clawback_cz,
        payload: {
          type: "sponsor_division_correction_clawback",
          amount: -c.clawback_cz,
          description: "Reparation #4376 — tilbageførsel af for meget udbetalt garanteret base (timing-hul), sæson 3",
          season_id: plan.seasonId,
          metadata: { code: "tx.sponsorDivisionCorrectionClawback", params: { contractId: c.contract_id, baseBefore: c.base_before, baseAfter: c.base_after } },
          actor_type: FINANCE_ACTOR_TYPE.MIGRATION,
          related_entity_type: FINANCE_RELATED_ENTITY.SEASON,
          related_entity_id: plan.seasonId,
          source_path: "repair-4376-sponsor-division-correction.runRepair",
          reason_code: FINANCE_REASON.SPONSOR_DIVISION_CORRECTION_CLAWBACK,
          // #4376: egen nøgle pr. kontrakt (ikke sæson) — forhindrer dobbelt-træk
          // ved gentagen kørsel, uafhængigt af (b)'s divisionAdjustmentIdempotencyKey.
          idempotency_key: sponsorDivisionClawbackIdempotencyKey(c.team_id, c.contract_id),
        },
      },
      { allowDuplicate: true }
    );
    if (wasSkipped) { clawbackSkipped += 1; continue; }
    clawedBack += 1;
    totalClawedBack += c.clawback_cz;
  }

  // ── Trin (b): OP — divisions-tillæg via den eksisterende atomiske balance-sti ──
  let paid = 0, skipped = 0, totalPaid = 0;
  for (const d of plan.teamsToPay) {
    if (d.correction_cz === 0) continue;
    const { skipped: wasSkipped } = await incrementBalanceWithAudit(
      supabase,
      {
        teamId: d.team_id,
        delta: d.correction_cz,
        payload: {
          type: "division_adjustment",
          amount: d.correction_cz,
          description: "Reparation #4376 — divisions-tillæg (gulv+50%), sæson 3",
          season_id: plan.seasonId,
          metadata: { code: "tx.divisionAdjustment", params: { signedDivision: d.signed_division, currentDivision: d.division_now } },
          actor_type: FINANCE_ACTOR_TYPE.MIGRATION,
          related_entity_type: FINANCE_RELATED_ENTITY.SEASON,
          related_entity_id: plan.seasonId,
          source_path: "repair-4376-sponsor-division-correction.runRepair",
          reason_code: FINANCE_REASON.SPONSOR_DIVISION_CORRECTION,
          // #4376: SAMME nøgle som motoren/creditDivisionAdjustment-4376.mjs bruger
          // for S3s divisions-tillæg — forhindrer dobbeltbetaling uanset hvilken
          // sti der rammer sæson 3 først.
          idempotency_key: divisionAdjustmentIdempotencyKey(d.team_id, plan.seasonId),
        },
      },
      { allowDuplicate: true }
    );
    if (wasSkipped) { skipped += 1; continue; }
    paid += 1;
    totalPaid += d.correction_cz;
  }

  const postVerify = await buildRepairPlan({ supabase, seasonNumber, log });
  report.applied = true;
  report.paidCount = paid;
  report.skippedCount = skipped;
  report.totalPaid = totalPaid;
  report.clawedBackCount = clawedBack;
  report.clawbackSkippedCount = clawbackSkipped;
  report.totalClawedBack = totalClawedBack;
  report.postVerifyRemainingTimingHole = postVerify.timingHoleCorrections?.length ?? null;
  report.postVerifyRemainingAdjustments = postVerify.teamsToPay?.length ?? null;
  report.postVerifyRemainingClawbacks = postVerify.clawbacks?.length ?? null;

  if (report.postVerifyRemainingTimingHole > 0) {
    log(`[4376] ADVARSEL: post-verify finder stadig ${report.postVerifyRemainingTimingHole} timing-hul-kontrakter der afviger.`);
  } else {
    log(`[4376] APPLY færdig — 0 timing-hul-kontrakter tilbage, ${paid} divisions-tillæg betalt (${skipped} sprunget over), ${clawedBack} tilbageførsler trukket (${clawbackSkipped} sprunget over som allerede trukket).`);
  }
  return report;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith("repair-4376-sponsor-division-correction.js")) {
  const __envdir = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(__envdir, "../.env"), quiet: true });
  dotenv.config({ path: join(__envdir, "../../.env"), quiet: true });

  const argValue = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : null;
  };
  const APPLY = process.argv.includes("--apply");
  const CONFIRM = argValue("--confirm");
  const REQUIRED_CONFIRM = "REPAIR 4376 SPONSOR DIVISION CORRECTION";
  const OWNER_ACK = process.env.REPAIR_4376_OWNER_ACK === "true";

  if (APPLY && (CONFIRM !== REQUIRED_CONFIRM || !OWNER_ACK)) {
    console.error(`FEJL: --apply kraever BAADE --confirm "${REQUIRED_CONFIRM}" OG REPAIR_4376_OWNER_ACK=true i miljoeet. Ingen writes udfoert.`);
    process.exit(1);
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("FEJL: Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY (infisical run --env=prod -- node backend/scripts/repair-4376-sponsor-division-correction.js ...)");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const dryRun = !APPLY;
  console.log(`=== #4376 sponsor-divisions-reparation (timing-hul + tillæg) — ${dryRun ? "DRY-RUN" : "APPLY"} ===`);
  runRepair({ supabase, dryRun })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.migrationApplied) process.exitCode = 1;
      if (!report.dryRun && (report.aborted || report.postVerifyRemainingTimingHole > 0)) process.exitCode = 1;
    })
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
