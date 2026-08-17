// Reparation #3655 — fire hold accepterede bestyrelsens bonus-tilbud (layer 6,
// board_consequences), men blev ALDRIG krediteret de 200.000 CZ$ hver (i alt 800.000).
// Tilbuddet forsvandt fra deres skærm; de kan ikke genforsøge (endpointet svarer 404,
// fordi status allerede er 'accepted').
//
// ROD-ÅRSAG (fuldt udredt i #3578, IKKE fixet af denne migration — se afgrænsning
// nedenfor): POST /board/bonus-offer/accept (backend/routes/api.js, se
// acceptBonusOffer i backend/lib/boardConsequences.js) gør 3 ting i rækkefølge,
// UDEN fælles transaktion:
//   1. board_consequences.status → 'accepted' (boardConsequences.js:703-707)
//   2. incrementBalanceWithAudit(..., { type: "bonus", ... })  (api.js:13298-13313)
//   3. append ekstra-mål til board_profiles.current_goals      (api.js:13317-13341)
// Fejler trin 2, er trin 1 allerede committet og der er INGEN vej tilbage for
// spilleren (acceptBonusOffer kræver status='active'). Alle fire ramte hold havde
// allerede ÉN succesfuld bestyrelses-bonus i samme sæson (season_id 0002, type='bonus'),
// og det partielle unikke indeks `uniq_bonus_per_team_season` — UNIQUE(team_id,
// season_id) WHERE type='bonus' AND season_id IS NOT NULL — afviste derfor den ANDEN
// insert med 23505 (unique_violation), som ikke var wrappet i allowDuplicate og derfor
// propagerede som en ufanget exception → 500 → status='accepted' blev stående uden penge.
//
// VERIFICERET READ-ONLY MOD PROD (2026-08-18, Supabase MCP SELECT, se #3655-kommentar
// for fuld SQL + output):
//   37 accepterede layer-6 bonus-tilbud i alt · 33 krediteret (33 × 200.000, reason_code
//   'board_bonus_accepted') · 4 IKKE krediteret = 800.000 manglende:
//     Team WolkerWessels            team_id 563b28b9-b481-4482-baa7-62a1a1b3ce90
//       board_consequences.id bccc90ba-9986-420f-bb64-5155cc8a02b0  accepteret 2026-08-09T14:01:53Z
//     Aquila–L3gatus Racing Team    team_id 992f67c2-abd7-428e-a952-2111ddef759b
//       board_consequences.id 7f88749e-9ff9-4a66-8d6b-fab9fed8056a  accepteret 2026-08-09T14:41:06Z
//     Team Hansen Pro Cycling       team_id 3a6a93a4-6b21-40c4-a257-84771a67a4ae
//       board_consequences.id 301e97c7-3ce4-4939-8141-b5003e9a58ac  accepteret 2026-08-09T14:42:10Z
//     Pro Cycling Team              team_id 048b6115-86a7-4583-b863-cde1a6344bf6
//       board_consequences.id 5e1f310d-5cd0-4442-8062-3d7172c55d5f  accepteret 2026-08-11T18:36:22Z
//   Alle fire er rigtige spillere (is_ai=false). Ingen af de fire har fået den
//   TILHØRENDE ekstra-mål (alle payload.extra_goal_type='signature_rider') tilføjet —
//   verificeret mod board_profiles.current_goals (ingen goal med
//   type='signature_rider' AND source='bonus_offer' for nogen af de fire).
//   NB-nuance (ikke i den oprindelige issue-tekst): to af de fire (Hansen, Aquila) HAR
//   én ældre goal med source='bonus_offer' i deres current_goals — men den er
//   type='monument_podium' og stammer fra deres TIDLIGERE, succesfulde bonus-tilbud i
//   samme sæson (det er præcis DÉT tilbud der optager season-pladsen i det unikke
//   indeks). Ændrer intet ved konklusionen: den fejlede tildeling gav aldrig noget mål.
//   Pro Cycling Team (048b6115) har INGEN board_profiles-række for sæson 2 overhovedet
//   (kun sæson 1) — hold dette for øje hvis en fremtidig beslutning vil tilføje
//   ekstra-målet for dette hold; der er intet 1yr-board at skrive det til endnu.
//
// EJERENS BESLUTNINGER (se #3655, endnu IKKE truffet ved denne scripts oprettelse):
//   1. Kreditér 200.000 UDEN ekstra-mål (ejerens egen anbefaling i issuet) — dette
//      script implementerer KUN denne variant. Håndterer IKKE "genåbn tilbuddet"
//      (mulighed 2) eller spiller-besked (mulighed 3, ejeren skriver/poster selv).
//   2. Beløb: 200.000 pr. hold (matcher board_consequences.severity for hver af de 4
//      rækker — scriptet læser severity dynamisk, ikke en hardkodet konstant).
//
// DESIGN-VALG for at UNDGÅ #3578's blokerende indeks (uden at vente på at #3578
// lander): denne reparation skriver IKKE type='bonus' (det er netop feltet det
// partielle indeks scoper på). Den bruger i stedet:
//   type            = 'admin_adjustment'  (allerede tilladt af finance_transactions'
//                      CHECK-constraint — INGEN migration nødvendig, verificeret mod
//                      prods pg_constraint 2026-08-18)
//   reason_code     = 'board_bonus_accepted_repair_3655'  (fri tekst, ingen CHECK —
//                      adskiller reparationen tydeligt fra normale bonus-accepts i audit-logget)
//   related_entity_type = 'manual'
//   idempotency_key = 'repair-3655-bonus-credit-<board_consequence_id>'  (gør scriptet
//                      sikkert at køre flere gange — increment_balance_with_audit
//                      afviser en gentaget insert med samme nøgle og scriptet
//                      rapporterer det som "allerede krediteret", ingen dobbelt-kreditering)
// Denne vej kræver IKKE at #3578 er løst først — den fejler ikke på det unikke
// bonus-indeks, fordi den aldrig rammer det. #3578's egentlige fix (gør accept-flowet
// atomart) er stadig nødvendigt for at forhindre FREMTIDIGE forekomster af denne bug;
// det er ude af scope for dette script.
//
// SNAPSHOT FØR EN EVENTUEL --apply-KØRSEL (skrives automatisk af scriptet, altid,
// også i dry-run — se backupPath i output): følgende tabeller/rækker snapshottes
// FØR skrivning, som JSON i backend/scripts/backups/:
//   - board_consequences  (de 4 berørte rækker, fuld række)
//   - finance_transactions (ALLE rækker for de 4 team_id'er — fuld transaktionshistorik,
//     ikke kun bonus-rækkerne, så en eventuel rollback kan verificere før/efter-saldo)
//   - teams                (id, name, balance — før-saldo for de 4 hold)
//   - board_profiles       (ALLE rækker for de 4 team_id'er, alle sæsoner — også selvom
//     scriptet ikke selv skriver til denne tabel, til fremtidig reference hvis ejeren
//     senere vælger at tilføje ekstra-målet manuelt)
//
// KØR ALDRIG mod prod uden ejer-godkendelse — dette er en penge-mutation på fire
// rigtige spilleres saldi (økonomi-gaten, se AGENTS.md hard rule 9 + CyclingZone-memory
// "Ejer ser live-tilstand FØR store destruktive prod-indgreb"):
//   node scripts/repair3655BoardBonusCredit.js
//       → DRY-RUN (default): viser live-rekonciliering (37 accepteret / 33 krediteret /
//         4 manglende), beløb pr. hold, og hvad en --apply-kørsel VILLE skrive. Ingen writes.
//         Skriver altid en snapshot-JSON af de 4 rækker (backupPath i output) selv i dry-run.
//   node scripts/repair3655BoardBonusCredit.js --apply --confirm "REPAIR 3655 BONUS CREDIT"
//       → RIGTIG kørsel. Kræver DESUDEN REPAIR_3655_OWNER_ACK=true i miljøet.
//         Backup skrives FØR writes (samme fil som dry-run-dumpet). Idempotent via
//         idempotency_key — sikkert at køre flere gange.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { incrementBalanceWithAudit } from "../lib/balanceRpc.js";
import { FINANCE_ACTOR_TYPE, FINANCE_RELATED_ENTITY } from "../lib/economyConstants.js";

export const BONUS_OFFER_LAYER = 6;
export const REPAIR_REASON_CODE = "board_bonus_accepted_repair_3655";
// NB navngivning: bevidst IKKE "REPAIR_TYPE" (eller andet der ender på `_TYPE`) —
// backend/lib/notificationTypes.test.js's #3032-forward-guard scanner ALLE
// `export const X_TYPE = "..."` i backend og kræver at værdien findes i
// NOTIFICATION_TYPES. Dette er en finance_transactions.type-værdi, ikke en
// notifikationstype — et navn der matcher konventionen ville fejle guarden falsk.
export const REPAIR_TX_KIND = "admin_adjustment";
// Match-vindue mellem board_consequences.resolved_at og en evt. eksisterende
// finance_transactions-row (samme team_id, reason_code='board_bonus_accepted') —
// målt gennemsnit i prod er <1s (RPC kaldes lige efter status-flip), 120s er rigelig margin.
const CREDIT_MATCH_WINDOW_MS = 120_000;

async function fetchAll(supabase, table, apply) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const q = apply(supabase.from(table).select("*")).range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function parseGoals(currentGoals) {
  if (!currentGoals) return [];
  if (typeof currentGoals === "string") {
    try { return JSON.parse(currentGoals); } catch { return []; }
  }
  return Array.isArray(currentGoals) ? currentGoals : [];
}

/**
 * Live-rekonciliering: finder accepterede layer-6 bonus-tilbud uden matchende
 * finance_transactions-kreditering. Rent læs — ingen writes.
 */
export async function findMissingBonusCredits({ supabase, log = console.log }) {
  const accepted = await fetchAll(supabase, "board_consequences", (q) =>
    q.eq("layer", BONUS_OFFER_LAYER).eq("status", "accepted"));
  log(`Accepterede layer-6 bonus-tilbud (alle hold, al tid): ${accepted.length}`);
  if (!accepted.length) return { accepted: [], missing: [], creditedCount: 0 };

  const teamIds = [...new Set(accepted.map((a) => a.team_id))];
  const teams = await fetchAll(supabase, "teams", (q) => q.in("id", teamIds));
  const teamsById = new Map(teams.map((t) => [t.id, t]));

  const credits = await fetchAll(supabase, "finance_transactions", (q) =>
    q.eq("reason_code", "board_bonus_accepted").in("team_id", teamIds));
  const creditsByTeam = new Map();
  for (const c of credits) {
    if (!creditsByTeam.has(c.team_id)) creditsByTeam.set(c.team_id, []);
    creditsByTeam.get(c.team_id).push(c);
  }

  const missing = [];
  let creditedCount = 0;
  for (const offer of accepted) {
    const resolvedAt = Date.parse(offer.resolved_at);
    const candidates = creditsByTeam.get(offer.team_id) || [];
    const match = candidates.find((c) => Math.abs(Date.parse(c.created_at) - resolvedAt) <= CREDIT_MATCH_WINDOW_MS);
    if (match) { creditedCount++; continue; }

    const team = teamsById.get(offer.team_id);
    missing.push({
      boardConsequenceId: offer.id,
      teamId: offer.team_id,
      teamName: team?.name ?? "(ukendt)",
      isAi: team?.is_ai ?? null,
      resolvedAt: offer.resolved_at,
      amount: offer.severity,
      extraGoalType: offer.payload?.extra_goal_type ?? null,
      extraGoalLabel: offer.payload?.extra_goal_label ?? null,
    });
  }

  log(`Krediteret (finance_transactions reason_code='board_bonus_accepted' inden for ±${CREDIT_MATCH_WINDOW_MS / 1000}s af resolved_at): ${creditedCount}`);
  log(`IKKE krediteret: ${missing.length}`);
  for (const m of missing) {
    log(`  ${m.teamName} (${m.teamId})  board_consequence ${m.boardConsequenceId}  accepteret ${m.resolvedAt}  mangler ${m.amount}  is_ai=${m.isAi}`);
  }
  const total = missing.reduce((sum, m) => sum + (m.amount || 0), 0);
  log(`Total manglende: ${total}`);

  return { accepted, missing, creditedCount, total };
}

/**
 * Finder den season_id de(t) berørte hold allerede har en 'bonus'-type
 * finance_transactions-row for (deres TIDLIGERE, succesfulde bestyrelses-bonus i
 * samme sæson — det er netop den række der optager det unikke indeks-slot). Bruges
 * kun til at udfylde season_id-feltet på korrektions-transaktionen (rent metadata,
 * påvirker ikke det unikke indeks — reparationen skriver type='admin_adjustment').
 */
async function resolveSeasonIdForRepair({ supabase, teamId, beforeIso }) {
  const { data, error } = await supabase
    .from("finance_transactions")
    .select("season_id, created_at")
    .eq("team_id", teamId)
    .eq("type", "bonus")
    .eq("reason_code", "board_bonus_accepted")
    .lte("created_at", beforeIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`finance_transactions (season-opslag for ${teamId}): ${error.message}`);
  return data?.season_id ?? null;
}

/**
 * @returns {Promise<{missing: object[], applied: boolean, backupPath?: string, results?: object[]}>}
 */
export async function repair3655BoardBonusCredit({ supabase, dryRun = true, now = new Date(), log = console.log }) {
  const { missing } = await findMissingBonusCredits({ supabase, log });

  // Snapshot FØR en eventuel writes — altid, også i dry-run (jf. script-header).
  const outDir = join(dirname(fileURLToPath(import.meta.url)), "backups");
  mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backupPath = join(outDir, `repair-3655-board-bonus-credit-${stamp}.json`);

  if (missing.length) {
    const teamIds = missing.map((m) => m.teamId);
    const [bcRows, ftRows, teamRows, bpRows] = await Promise.all([
      fetchAll(supabase, "board_consequences", (q) => q.in("id", missing.map((m) => m.boardConsequenceId))),
      fetchAll(supabase, "finance_transactions", (q) => q.in("team_id", teamIds)),
      fetchAll(supabase, "teams", (q) => q.in("id", teamIds)),
      fetchAll(supabase, "board_profiles", (q) => q.in("team_id", teamIds)),
    ]);
    writeFileSync(backupPath, JSON.stringify({
      generatedAt: now.toISOString(),
      missing,
      snapshot: { board_consequences: bcRows, finance_transactions: ftRows, teams: teamRows, board_profiles: bpRows },
    }, null, 2));
    log(`\nsnapshot skrevet: ${backupPath}`);
  } else {
    log("\nIntet manglende — intet at snapshotte eller reparere.");
    return { missing: [], applied: false };
  }

  if (dryRun) {
    log("\nDRY-RUN — ingen writes. Kør med --apply (+ --confirm) EFTER ejer-godkendelse.");
    for (const m of missing) {
      log(`  VILLE kreditere ${m.amount} til ${m.teamName} (${m.teamId})  type='${REPAIR_TX_KIND}'  reason_code='${REPAIR_REASON_CODE}'  idempotency_key='repair-3655-bonus-credit-${m.boardConsequenceId}'  (ekstra-mål '${m.extraGoalType}' tilføjes IKKE — jf. ejerens anbefaling i #3655)`);
    }
    return { missing, applied: false, backupPath };
  }

  // ── APPLY ──────────────────────────────────────────────────────────────────
  const results = [];
  for (const m of missing) {
    const seasonId = await resolveSeasonIdForRepair({ supabase, teamId: m.teamId, beforeIso: m.resolvedAt });
    const { skipped, balance } = await incrementBalanceWithAudit(
      supabase,
      {
        teamId: m.teamId,
        delta: m.amount,
        payload: {
          type: REPAIR_TX_KIND,
          amount: m.amount,
          description: `Reparation #3655: manglende bestyrelses-bonus krediteret (board_consequences ${m.boardConsequenceId}, oprindeligt accepteret ${m.resolvedAt}, aldrig krediteret pga. #3578). Ejer-besluttet: uden ekstra-mål.`,
          season_id: seasonId,
          actor_type: FINANCE_ACTOR_TYPE.MIGRATION,
          actor_id: null,
          source_path: "scripts.repair3655BoardBonusCredit",
          reason_code: REPAIR_REASON_CODE,
          related_entity_type: FINANCE_RELATED_ENTITY.MANUAL,
          related_entity_id: null,
          idempotency_key: `repair-3655-bonus-credit-${m.boardConsequenceId}`,
        },
      },
      { allowDuplicate: true }
    );
    log(skipped
      ? `  SKIPPET (idempotency_key allerede brugt — allerede krediteret): ${m.teamName} (${m.teamId})`
      : `  krediteret ${m.amount} til ${m.teamName} (${m.teamId}) — ny saldo ${balance}`);
    results.push({ ...m, skipped, balanceAfter: balance });
  }

  // Post-verify: genkør rekonciliering — forventet 0 manglende blandt de reparerede.
  const postCheck = await findMissingBonusCredits({ supabase, log: () => {} });
  const stillMissing = postCheck.missing.filter((pm) => missing.some((m) => m.boardConsequenceId === pm.boardConsequenceId));
  log(`\nPost-verify: ${stillMissing.length} af de ${missing.length} reparerede stadig uden kreditering (forventet: 0).`);

  return { missing, applied: true, backupPath, results, postCheckRemaining: stillMissing.length };
}

if (process.argv[1] && process.argv[1].endsWith("repair3655BoardBonusCredit.js")) {
  const __envdir = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(__envdir, "../.env"), quiet: true });
  dotenv.config({ path: join(__envdir, "../../.env"), quiet: true });

  const argValue = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : null;
  };
  const APPLY = process.argv.includes("--apply");
  const CONFIRM = argValue("--confirm");
  const REQUIRED_CONFIRM = "REPAIR 3655 BONUS CREDIT";
  const OWNER_ACK = process.env.REPAIR_3655_OWNER_ACK === "true";

  if (APPLY && (CONFIRM !== REQUIRED_CONFIRM || !OWNER_ACK)) {
    console.error(`❌ --apply kræver BÅDE --confirm "${REQUIRED_CONFIRM}" OG REPAIR_3655_OWNER_ACK=true i miljøet. Ingen writes udført.`);
    process.exit(1);
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const dryRun = !APPLY;
  console.log(`=== #3655 bestyrelses-bonus-kreditering — ${dryRun ? "DRY-RUN" : "APPLY"} ===`);
  repair3655BoardBonusCredit({ supabase, dryRun })
    .then((res) => {
      console.log(`\nfærdig: manglende=${res.missing.length} applied=${res.applied}${res.applied ? ` postCheckRemaining=${res.postCheckRemaining}` : ""}`);
    })
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
