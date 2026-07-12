import { incrementBalanceWithAudit } from "./balanceRpc.js";
import { captureException } from "./sentry.js";
import { fetchAllRows } from "./supabasePagination.js";
import { updateRiderValues } from "./economyEngine.js";
import {
  FINANCE_ACTOR_TYPE,
  FINANCE_REASON,
  FINANCE_RELATED_ENTITY,
} from "./economyConstants.js";

export async function getSeasonPrizePreview(seasonId, supabase) {
  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("id, name, prize_paid_at, status")
    .eq("season_id", seasonId)
    .eq("status", "completed");
  if (racesError) throw new Error(racesError.message);
  if (!races?.length) {
    return {
      already_paid: [],
      pending_payment: [],
      total_pending: 0,
      totals: { earned: 0, payable: 0, free_ai: 0 },
      team_totals: [],
      reconciliation: [],
      warnings: [],
    };
  }

  const raceIds = races.map(r => r.id);

  // Batch-fetch all relevant race_results. Paginér (PostgREST capper ved 1000) —
  // ellers underberegnes præmie-previewet stille for sæsoner med >1000 præmie-
  // rækker, og udbetalingen ville mangle nogle hold. .order("id") for stabile sider.
  const allResults = await fetchAllRows(() => supabase
    .from("race_results")
    .select("race_id, team_id, prize_money")
    .in("race_id", raceIds)
    .gt("prize_money", 0)
    .order("id", { ascending: true }));

  // Batch-fetch existing prize transactions for paid races (også pagineret).
  const paidRaceIds = races.filter(r => r.prize_paid_at).map(r => r.id);
  let paidTransactions = [];
  if (paidRaceIds.length) {
    paidTransactions = await fetchAllRows(() => supabase
      .from("finance_transactions")
      .select("race_id, team_id, amount")
      .in("race_id", paidRaceIds)
      .eq("type", "prize")
      .order("id", { ascending: true }));
  }

  // Batch-fetch team names
  const teamIds = [...new Set([
    ...(allResults || []).map(r => r.team_id),
    ...paidTransactions.map(t => t.team_id),
  ].filter(Boolean))];
  const teamNameById = new Map();
  if (teamIds.length) {
    const { data: teams } = await supabase
      .from("teams")
      .select("id, name")
      .in("id", teamIds);
    for (const t of teams || []) teamNameById.set(t.id, t.name);
  }

  const resultsByRace = groupBy(allResults || [], r => r.race_id);
  const txByRace = groupBy(paidTransactions, t => t.race_id);

  // Season-wide split (#896): "optjent" = alle præmie-rækker over completed-løb;
  // "udbetalbar" = kun rækker med et hold (team_id). Differencen er fri/AI-præmie
  // (holdsløse ryttere + forældreløse holdklassement-rækker) der tæller for
  // rytter-værdi men ALDRIG udbetales. Skjult i dag → previewets total var
  // misvisende (optjent vist som om det kunne udbetales).
  const earned = (allResults || []).reduce((s, r) => s + r.prize_money, 0);
  const payable = (allResults || []).reduce((s, r) => s + (r.team_id ? r.prize_money : 0), 0);

  const already_paid = [];
  const pending_payment = [];
  const reconciliation = [];
  const warnings = [];

  for (const race of races) {
    if (race.prize_paid_at) {
      const txs = txByRace.get(race.id) || [];
      const finance_total = txs.reduce((s, t) => s + t.amount, 0);
      already_paid.push({
        race_id: race.id,
        race_name: race.name,
        paid_at: race.prize_paid_at,
        total_paid: finance_total,
        by_team: txs.map(t => ({
          team_id: t.team_id,
          team_name: teamNameById.get(t.team_id) ?? null,
          amount: t.amount,
        })),
      });

      // Reconciliation (#896): de udbetalte finance_transactions skal matche
      // summen af de UDBETALBARE race_results (team_id != null) for løbet —
      // ellers er der drift mellem de to kilder (dobbeltbetaling, delvis
      // udbetaling, eller import-ændring efter udbetaling).
      const results = resultsByRace.get(race.id) || [];
      const results_total = results.reduce((s, r) => s + (r.team_id ? r.prize_money : 0), 0);
      const diff = finance_total - results_total;
      reconciliation.push({
        race_id: race.id,
        race_name: race.name,
        results_total,
        finance_total,
        diff,
        ok: diff === 0,
      });
    } else {
      const results = resultsByRace.get(race.id) || [];
      if (!results.length) {
        // Completed-løb uden nogen præmie-rækker overhovedet → intet at udbetale.
        warnings.push({
          race_id: race.id,
          race_name: race.name,
          type: "no_prize_results",
          message: "Ingen præmie-rækker — løbet udbetaler intet.",
        });
        continue;
      }

      const byTeam = new Map();
      for (const r of results) {
        if (!r.team_id) continue;
        byTeam.set(r.team_id, (byTeam.get(r.team_id) || 0) + r.prize_money);
      }
      if (!byTeam.size) {
        // Hele puljen er fri/AI (ingen hold). Før droppet stille fra previewet —
        // nu en eksplicit warning, så ejeren ved hvorfor løbet ikke udbetaler.
        const free_ai = results.reduce((s, r) => s + r.prize_money, 0);
        warnings.push({
          race_id: race.id,
          race_name: race.name,
          type: "all_free_ai",
          message: `Hele puljen (${free_ai.toLocaleString("da-DK")} CZ$) er fri/AI — intet udbetales til hold.`,
        });
        continue;
      }

      const teamBreakdown = [...byTeam.entries()].map(([team_id, prize]) => ({
        team_id,
        team_name: teamNameById.get(team_id) ?? null,
        prize,
      }));
      pending_payment.push({
        race_id: race.id,
        race_name: race.name,
        total_prize: teamBreakdown.reduce((s, t) => s + t.prize, 0),
        by_team: teamBreakdown,
      });
    }
  }

  // Per-team season overview: "hvad står hvert hold til at tjene". Aggregér på
  // tværs af løb fra de breakdowns vi allerede har bygget — pending (udestående)
  // + paid (allerede udbetalt) pr. hold. Ren additiv beregning, ingen nye queries.
  const teamAgg = new Map();
  const bumpTeam = (team_id, team_name, field, amount) => {
    if (!team_id) return;
    let row = teamAgg.get(team_id);
    if (!row) {
      row = { team_id, team_name: team_name ?? null, pending: 0, paid: 0 };
      teamAgg.set(team_id, row);
    }
    if (team_name && !row.team_name) row.team_name = team_name;
    row[field] += amount;
  };
  for (const race of pending_payment) {
    for (const t of race.by_team) bumpTeam(t.team_id, t.team_name, "pending", t.prize);
  }
  for (const race of already_paid) {
    for (const t of race.by_team) bumpTeam(t.team_id, t.team_name, "paid", t.amount);
  }
  const team_totals = [...teamAgg.values()]
    .map(r => ({ ...r, total: r.pending + r.paid }))
    .sort((a, b) => b.total - a.total);

  return {
    already_paid,
    pending_payment,
    total_pending: pending_payment.reduce((s, r) => s + r.total_prize, 0),
    totals: { earned, payable, free_ai: earned - payable },
    team_totals,
    reconciliation,
    warnings,
  };
}

export async function paySeasonPrizesToDate(seasonId, adminUserId, supabase, opts = {}) {
  // #WS1: valgfri actorType så en cron-sweep kan logge udbetalingen som SYSTEM i
  // stedet for ADMIN (ærlig audit-trail). Default = ADMIN → manuelle endpoint
  // (api.js) er fuldstændig uændret.
  const actorType = opts.actorType ?? FINANCE_ACTOR_TYPE.ADMIN;

  const preview = await getSeasonPrizePreview(seasonId, supabase);
  if (!preview.pending_payment.length) return { races_paid: 0, total_paid: 0, by_race: [] };

  const now = new Date().toISOString();

  // #1573: saml de løb DETTE tick faktisk vandt prize_paid_at-kapløbet om. Et
  // rivaliserende cron-tick kan have læst det samme pending-preview (begge så
  // prize_paid_at IS NULL) — balancen er beskyttet af uniq_finance_idempotency_key,
  // men import_log-indsættelsen var ikke gatet og kunne dublere audit-rækken.
  const claimedRaces = [];

  // #2389 (Sentry CYCLINGZONE-2E/26): hold slettet (AI-trim heal-sweep) mellem
  // preview-læsningen og krediteringen. Deres præmie er void (kun AI-hold kan
  // slettes den vej) — de skippes, resten af udbetalingen fortsætter.
  const skippedMissingTeams = [];

  for (const race of preview.pending_payment) {
    for (const team of race.by_team) {
      // Slice 07c: balance + finance_transactions atomic via RPC.
      // 07d Fase B: admin-trigger → actor_type=admin, actor_id=adminUserId.
      // idempotency_key (race_prize:race:team) supplerer prize_paid_at-gaten.
      try {
        await incrementBalanceWithAudit(supabase, {
          teamId: team.team_id,
          delta: team.prize,
          payload: {
            type: "prize",
            amount: team.prize,
            description: `Præmiepenge — ${race.race_name}`,
            season_id: seasonId,
            race_id: race.race_id,
            actor_type: actorType,
            actor_id: adminUserId || null,
            source_path: "prizePayoutEngine.paySeasonPrizesToDate",
            reason_code: FINANCE_REASON.RACE_PRIZE_PAYOUT,
            related_entity_type: FINANCE_RELATED_ENTITY.RACE,
            related_entity_id: race.race_id,
            idempotency_key: `race_prize:${race.race_id}:${team.team_id}`,
          },
        }, { allowDuplicate: true });
      } catch (err) {
        // P0002 (no_data_found) = RPC'ens "Team % not found". Én slettet AI-holds
        // kreditering må ikke abortere HELE payout-ticket (det efterlod alle løb
        // uudbetalte + rød cron-monitor, CYCLINGZONE-26). Alt andet kastes videre.
        if (err?.code !== "P0002") throw err;
        skippedMissingTeams.push({ race_id: race.race_id, team_id: team.team_id, prize: team.prize });
        console.warn(`  ⚠️  Præmie skippet — hold ${team.team_id} findes ikke længere (${race.race_name}, ${team.prize} CZ$) (#2389)`);
      }
    }

    // #1573: gat opdateringen på prize_paid_at IS NULL og læs de faktisk ramte
    // rækker tilbage. Vinder dette tick kapløbet, rammer UPDATE'et 1 række; har
    // et samtidigt tick allerede sat prize_paid_at, rammer den 0. Det atomare
    // compare-and-set i Postgres afgør hvem der "ejer" import_log-indsættelsen.
    const { data: claimedRows, error: raceError } = await supabase
      .from("races")
      .update({ prize_paid_at: now })
      .eq("id", race.race_id)
      .is("prize_paid_at", null)
      .select("id");
    if (raceError) throw new Error(raceError.message);
    if (claimedRows?.length) claimedRaces.push(race);
  }

  // #1573: indsæt KUN audit-rækken hvis dette tick rent faktisk satte mindst ét
  // løbs prize_paid_at. Et tabende tick (betalte intet nyt — alt allerede claimet
  // af et rivaliserende tick) springer indsættelsen over, så audit-trailen får
  // præcis én import_log-række pr. reel udbetalingsbølge.
  if (claimedRaces.length) {
    await supabase.from("import_log").insert({
      import_type: "prize_payout",
      rows_processed: claimedRaces.length,
      rows_updated: claimedRaces.length,
      rows_inserted: 0,
      errors: [],
      imported_by: adminUserId,
    });
  }

  // R3 (#895): recalculate rider values now that this season's prizes are paid,
  // so the active season's prize earnings feed the progress-weighted value
  // average live — not only at season end. See economyEngine.updateRiderValues.
  let riders_updated = 0;
  try {
    ({ ridersUpdated: riders_updated } = await updateRiderValues(supabase));
  } catch (err) {
    // A value-recalc failure must not roll back a successful payout; surface it
    // in the response so the admin can re-run the recalc (idempotent) manually.
    console.error("⚠️  Rider-value recalc efter præmie-udbetaling fejlede:", err.message);
    // #2392: fejlede tavst (kun console) i ugevis — prize_earnings_bonus drev
    // aldrig live. Capture så gentagne recalc-fejl er synlige i Sentry-triage.
    captureException(err, { tags: { cron: "auto-prize", stage: "rider-value-recalc" } });
    riders_updated = null;
  }

  // #1573: rapportér KUN de løb dette tick faktisk claimede — ikke hele det læste
  // pending-preview. Et tabende tick returnerer races_paid: 0 (det satte ingenting
  // og indsatte ingen import_log-række), så svaret matcher audit-trailen.
  return {
    races_paid: claimedRaces.length,
    total_paid: claimedRaces.reduce((s, r) => s + r.total_prize, 0),
    riders_updated,
    // #2389: slettede hold hvis kreditering blev skippet (void præmie) — surfaces
    // i cron-svaret så et mønster kan opdages i loggen.
    teams_skipped: skippedMissingTeams,
    by_race: claimedRaces.map(r => ({
      race_name: r.race_name,
      total_prize: r.total_prize,
    })),
  };
}

function groupBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}
