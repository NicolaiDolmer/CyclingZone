// Per-løbsdag-sponsor-indkomst + resultat-bonusser (#1663, economy Fase 2 ·
// udvidet i #2948 "Sponsorvalg 2.0").
//
// Løbsdage: hvert hold med en aktiv sponsor-kontrakt (per_race_day_rate > 0)
// tjener per_race_day_rate × race.stages for HVERT completet løb det deltog i.
// #2913: raten er ved aktivering sat mod divisionens etapetal, så den variable
// del summer til race_day_share × target ved fuld deltagelse.
//
// Resultat-bonusser (#2948, 'results'-arketypen): stage_win-klausul betaler pr.
// etapesejr (result_type='stage', rank=1), podium-klausul pr. 2.-3.-plads —
// begge under et fælles loft (results_cap-klausul) håndhævet via
// sponsor_contracts.results_bonus_paid.
//
// Alt er RÅ indkomst (IKKE board-modificeret — modsat den garanterede sæson-
// start-sponsor) og krediteres når løb finaliseres, ved siden af præmierne.
//
// Idempotent per (race, team) via idempotency_keys "sponsor_race_day:<raceId>:<teamId>"
// og "sponsor_results:<raceId>:<teamId>".
//
// #3123: idempotensen håndhæves i TO lag. Primært et pre-filter — sweep'en henter
// sæsonens allerede-bogførte nøgler op front og springer dem over. Sekundært
// uniq_finance_idempotency_key i DB, som backstop mod to samtidige ticks.
// Uden pre-filteret genforsøgte hver tick ALLE betalte krediteringer og fik dem
// afvist med 23505 — funktionelt harmløst, men O(alle completede løb) sekventielle
// round-trips pr. tick (~40 ms stykket). Ved sæsonslut ville ét tick tage længere
// end sit eget 5-minutters-interval og begynde at overlappe.

import { FINANCE_ACTOR_TYPE, FINANCE_REASON, FINANCE_RELATED_ENTITY } from "./economyConstants.js";
import { incrementBalanceWithAudit } from "./balanceRpc.js";
import { fetchAllRows } from "./supabasePagination.js";
import { getRaceResultsSnapshot, setRaceResultsSnapshot } from "./raceResultsSnapshotCache.js";
import { notifyTeamOwner } from "./notificationService.js";
import { captureException } from "./sentry.js";

// PostgREST returnerer maks 1000 rækker pr. request uanset filter. Sæsonens
// sponsor-nøgler overstiger det længe før sæsonslut, så vi SKAL paginere —
// en tavs afkortning ville lade de afkortede nøgler falde tilbage på 23505-stien
// og genindføre præcis den fejl vi fjerner her.
const KEY_PAGE_SIZE = 1000;

// Hent alle allerede-bogførte sponsor-idempotency-nøgler for sæsonen.
//
// `.order()` er IKKE valgfri: offset-pagination over et uordnet resultatsæt er
// udefineret i Postgres — to queries kan give hver sin rækkefølge, og så kan en
// nøgle hoppe mellem sider og blive sprunget helt over. Den oversprungne nøgle
// falder tilbage på 23505-stien vi fjerner her. idempotency_key er unik, så den
// er en totalordning og dermed et stabilt paginerings-anker.
export async function fetchPaidSponsorKeys(seasonId, supabase) {
  const paid = new Set();
  for (let from = 0; ; from += KEY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("finance_transactions")
      .select("idempotency_key")
      .eq("season_id", seasonId)
      .in("type", ["sponsor_race_day", "sponsor_result_bonus"])
      .order("idempotency_key", { ascending: true })
      .range(from, from + KEY_PAGE_SIZE - 1);
    if (error) throw new Error(`finance_transactions: ${error.message}`);
    for (const row of data || []) {
      if (row?.idempotency_key) paid.add(row.idempotency_key);
    }
    if ((data?.length || 0) < KEY_PAGE_SIZE) break;
  }
  return paid;
}

// #3316: er dette holds resultat i DETTE løb tidsmæssigt kvalificeret til at
// blive krediteret, givet kontraktens activated_at? NULL activated_at (season-
// start-aktiveret, langt de fleste kontrakter) → altid kvalificeret, ingen
// filtrering (uændret adfærd). En sat activated_at (mid-season-aktivering,
// #3316) kræver at holdets resultat er registreret PÅ ELLER EFTER
// aktiveringstidspunktet — mangler resultTime helt (bør ikke ske, imported_at
// har DB-default), afvises konservativt frem for at gætte og risikere
// bagudbetaling.
function isEligibleForCredit(contract, resultTime) {
  const activatedAt = contract?.activated_at;
  if (!activatedAt) return true;
  if (!resultTime) return false;
  return new Date(resultTime) >= new Date(activatedAt);
}

// Pure: beregn race-day-kreditter for ét løb. stages defaulter til 1 (endagsløb);
// hold uden aktiv kontrakt eller med rate <= 0 springes over. resultTimeByTeam
// (#3316) = { teamId → tidligste imported_at blandt holdets rækker i DETTE løb }
// — bruges til at udelukke bagudbetaling for en kontrakt aktiveret midt i
// sæsonen (se isEligibleForCredit).
export function computeRaceDayCredits({ race, participatingTeamIds, contractsByTeam, resultTimeByTeam = {} }) {
  const stages = Number(race?.stages) || 1;
  const credits = [];
  for (const teamId of participatingTeamIds || []) {
    const contract = contractsByTeam?.[teamId];
    const rate = Number(contract?.per_race_day_rate) || 0;
    if (rate <= 0) continue;
    if (!isEligibleForCredit(contract, resultTimeByTeam?.[teamId])) continue;
    credits.push({
      teamId,
      amount: rate * stages,
      idempotencyKey: `sponsor_race_day:${race.id}:${teamId}`,
    });
  }
  return credits;
}

// Pure: beregn resultat-bonus for ét løb ud fra etape-resultater. stageResults =
// rækker med result_type='stage' (rank 1-3 er nok). remainingCapByTeam muterer
// IKKE — capped beløb returneres så caller kan bogføre og decremente selv.
// resultTimeByTeam (#3316): se computeRaceDayCredits — bonusklausuler gælder
// fra activated_at ligesom race-day-raten (ejer-mandat, ingen bagudbetaling).
export function computeResultBonusCredits({ race, stageResults, contractsByTeam, remainingCapByTeam, resultTimeByTeam = {} }) {
  const winsByTeam = {};
  const podiumsByTeam = {};
  for (const r of stageResults || []) {
    if (!r.team_id) continue;
    const rank = Number(r.rank);
    if (rank === 1) winsByTeam[r.team_id] = (winsByTeam[r.team_id] || 0) + 1;
    else if (rank === 2 || rank === 3) podiumsByTeam[r.team_id] = (podiumsByTeam[r.team_id] || 0) + 1;
  }

  const credits = [];
  const teamIds = new Set([...Object.keys(winsByTeam), ...Object.keys(podiumsByTeam)]);
  for (const teamId of teamIds) {
    const contract = contractsByTeam?.[teamId];
    if (!contract) continue;
    if (!isEligibleForCredit(contract, resultTimeByTeam?.[teamId])) continue;
    const clauses = contract.bonus_clauses || [];
    const winAmount = Number(clauses.find((c) => c.type === "stage_win")?.amount) || 0;
    const podiumAmount = Number(clauses.find((c) => c.type === "podium")?.amount) || 0;
    if (winAmount <= 0 && podiumAmount <= 0) continue;

    const raw =
      (winsByTeam[teamId] || 0) * winAmount +
      (podiumsByTeam[teamId] || 0) * podiumAmount;
    if (raw <= 0) continue;

    const remaining = remainingCapByTeam?.[teamId];
    const amount = Number.isFinite(remaining) ? Math.min(raw, Math.max(remaining, 0)) : raw;
    if (amount <= 0) continue;

    credits.push({
      teamId,
      amount,
      wins: winsByTeam[teamId] || 0,
      podiums: podiumsByTeam[teamId] || 0,
      idempotencyKey: `sponsor_results:${race.id}:${teamId}`,
    });
  }
  return credits;
}

// #3315 (ejer-godkendt 4/8): notificér holdejeren om en sponsor-udbetaling for
// et løb (race-day-indkomst og/eller resultat-bonus, allerede summeret af
// kalderen). Aldrig-kastende — en notifikationsfejl må ikke vælte payout-
// sweepen, samme forsvar som economyEngine.notifyManagerSafe.
async function notifySponsorPaidSafe(supabase, { teamId, sponsorName, amount, raceName, raceId }) {
  const sponsor = sponsorName || "Your sponsor";
  try {
    await notifyTeamOwner({
      supabase,
      teamId,
      type: "sponsor_paid",
      title: "Sponsor payout",
      message: `${sponsor} paid out ${amount} CZ$ for ${raceName}.`,
      relatedId: raceId,
      metadata: {
        titleCode: "notif.sponsorPaid.raceDay.title",
        titleParams: {},
        messageCode: "notif.sponsorPaid.raceDay.message",
        messageParams: { sponsor, amount, race: raceName },
      },
    });
  } catch (error) {
    console.error(
      `  ❌ [sponsorRaceDayIncome] sponsor_paid notification failed for team ${teamId} (race ${raceId}): ${error?.message || error}`
    );
    captureException(error, { tags: { flow: "sponsor-race-day", stage: "notify" }, teamId, raceId });
  }
}

// I/O: udbetal per-løbsdag-sponsor-indkomst + resultat-bonusser for alle
// completede løb i en sæson. Mirror'er prizePayoutEngine.paySeasonPrizesToDate's
// race-query + payload-shape. opts.actorType lader en cron-sweep logge som SYSTEM.
export async function payRaceDaySponsorsToDate(seasonId, supabase, opts = {}) {
  const actorType = opts.actorType ?? FINANCE_ACTOR_TYPE.SYSTEM;

  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("id, name, stages, status")
    .eq("season_id", seasonId)
    .eq("status", "completed");
  if (racesError) throw new Error(racesError.message);
  if (!races?.length) return { credited: 0, result_bonuses: 0 };

  // #3316: activated_at tilføjet — NULL for de ~200 season-start-aktiverede
  // kontrakter (uændret, ingen filtrering), sat for mid-season-aktiverede.
  const { data: contracts, error: contractsError } = await supabase
    .from("sponsor_contracts")
    .select("id, team_id, sponsor_name, per_race_day_rate, bonus_clauses, results_bonus_paid, activated_at")
    .eq("status", "active");
  if (contractsError) throw new Error(contractsError.message);

  const contractsByTeam = Object.fromEntries(
    (contracts || []).map((c) => [c.team_id, c])
  );

  // #3123: allerede-bogførte nøgler, så vi ikke genforsøger dem mod DB'en.
  const paidKeys = await fetchPaidSponsorKeys(seasonId, supabase);

  // Resterende resultat-loft pr. hold (results_cap-klausul − allerede udbetalt).
  // Holdes i memory gennem sweepen og persisteres pr. kreditering.
  const remainingCapByTeam = {};
  for (const c of contracts || []) {
    const cap = Number((c.bonus_clauses || []).find((cl) => cl.type === "results_cap")?.amount);
    if (Number.isFinite(cap) && cap > 0) {
      remainingCapByTeam[c.team_id] = Math.max(cap - (Number(c.results_bonus_paid) || 0), 0);
    }
  }

  let credited = 0;
  let resultBonuses = 0;
  for (const race of races) {
    // #3315: PostgREST capper stille ved 1000 rækker — etapeløb har 5000+
    // race_results-rækker, så et upagineret select droppede vinder-/podie-
    // rækker vilkårligt og undertalte stage_win/podium-bonusser massivt (94%
    // manko for ét ramt hold i prod, verificeret 4/8). .order("id") gør
    // paginering deterministisk (samme mønster som prizePayoutEngine.js).
    // #3316: imported_at tilføjet til select — bruges til at bygge
    // resultTimeByTeam (tidligste registrering pr. hold i DETTE løb), så en
    // mid-season-aktiveret kontrakt ikke kan bagudbetale for et løb der reelt
    // blev kørt/completet FØR aktiveringen.
    // #4010: de tre afledte værdier nedenfor er uforanderlige for et completet
    // løb, så de beregnes én gang og genbruges på tværs af ticks. Uden cachen
    // hentede hver tick alle race_results for alle completede løb — 203.849
    // kald, 1.038 s DB-tid og 1,9 TB buffer-trafik i døgnet, næsten udelukkende
    // for løb der for længst var betalt. Enhver skrivning til race_results
    // tømmer cachen (raceResultsSnapshotCache.js), så en korrektion eller
    // omkørsel slår igennem med det samme.
    let snapshot = race.status === "completed" ? getRaceResultsSnapshot(race.id) : null;

    if (!snapshot) {
      const results = await fetchAllRows(() => supabase
        .from("race_results")
        .select("team_id, result_type, rank, imported_at")
        .eq("race_id", race.id)
        .order("id", { ascending: true }));

      const participatingTeamIds = [
        ...new Set((results || []).map((r) => r.team_id).filter(Boolean)),
      ];

      // Konservativt MIN pr. hold: er blot ét af holdets resultater i løbet
      // ældre end aktiveringen, tæller hele løbet som "før" (ingen delvis
      // bagudbetaling af et løb der var i gang ved aktiveringstidspunktet).
      const resultTimeByTeam = {};
      for (const r of results || []) {
        if (!r.team_id || !r.imported_at) continue;
        const existing = resultTimeByTeam[r.team_id];
        if (!existing || new Date(r.imported_at) < new Date(existing)) {
          resultTimeByTeam[r.team_id] = r.imported_at;
        }
      }

      // Kun rank 1-3 gemmes: computeResultBonusCredits tæller sejre (rank 1) og
      // podier (rank 2-3) og ignorerer alt andet, så snapshottet er semantisk
      // identisk med det fulde stage-sæt — men fylder ~3 rækker pr. etape i
      // stedet for ét pr. rytter pr. etape.
      const podiumResults = (results || []).filter(
        (r) => r.result_type === "stage" && Number(r.rank) >= 1 && Number(r.rank) <= 3,
      ).map((r) => ({ team_id: r.team_id, rank: Number(r.rank) }));

      snapshot = { participatingTeamIds, resultTimeByTeam, podiumResults };
      if (race.status === "completed") setRaceResultsSnapshot(race.id, snapshot);
    }

    const { participatingTeamIds, resultTimeByTeam, podiumResults } = snapshot;

    const credits = computeRaceDayCredits({ race, participatingTeamIds, contractsByTeam, resultTimeByTeam });

    // #3315 (ejer-godkendt 4/8): akkumulér faktisk krediteret beløb pr. hold for
    // DENNE løbsdag, så vi bagefter kan sende ÉN sponsor_paid-notifikation der
    // dækker race-day + evt. resultat-bonus samlet — ikke én pr. klausul (spam).
    // Kun beløb der reelt blev krediteret (ikke skipped/idempotent-dublet) tæller.
    const notifyAmountByTeam = {};

    for (const c of credits) {
      if (paidKeys.has(c.idempotencyKey)) continue;
      const { skipped } = await incrementBalanceWithAudit(
        supabase,
        {
          teamId: c.teamId,
          delta: c.amount,
          payload: {
            type: "sponsor_race_day",
            amount: c.amount,
            description: "Sponsor — race-day income",
            season_id: seasonId,
            race_id: race.id,
            actor_type: actorType,
            actor_id: null,
            source_path: "sponsorRaceDayIncome.payRaceDaySponsorsToDate",
            reason_code: FINANCE_REASON.SPONSOR_RACE_DAY,
            related_entity_type: FINANCE_RELATED_ENTITY.RACE,
            related_entity_id: race.id,
            idempotency_key: c.idempotencyKey,
          },
        },
        { allowDuplicate: true }
      );
      if (!skipped) {
        credited += 1;
        notifyAmountByTeam[c.teamId] = (notifyAmountByTeam[c.teamId] || 0) + c.amount;
      }
    }

    // #2948: resultat-bonusser (kun etape-rækker, rank 1-3).
    // #4010: podiumResults ER dét filter, allerede anvendt da snapshottet blev
    // bygget — se kommentaren ved snapshot-opbygningen ovenfor.
    const bonusCredits = computeResultBonusCredits({
      race,
      stageResults: podiumResults,
      contractsByTeam,
      remainingCapByTeam,
      resultTimeByTeam,
    });

    for (const b of bonusCredits) {
      // #3123: allerede bogført → spring over UDEN at decrementere loftet igen
      // (forbruget ligger allerede i contract.results_bonus_paid). Samme semantik
      // som `skipped`-stien nedenfor.
      if (paidKeys.has(b.idempotencyKey)) continue;
      const { skipped } = await incrementBalanceWithAudit(
        supabase,
        {
          teamId: b.teamId,
          delta: b.amount,
          payload: {
            type: "sponsor_result_bonus",
            amount: b.amount,
            description: `Sponsor — result bonus (${b.wins} wins, ${b.podiums} podiums)`,
            // #3198-fund-7b: metadata.code lader FinancePage vise en oversat
            // tekst i stedet for den rå engelske description ovenfor (kun
            // brugt som fallback for legacy-rækker uden metadata).
            metadata: {
              code: "tx.sponsor.resultBonus",
              params: { wins: b.wins, podiums: b.podiums },
            },
            season_id: seasonId,
            race_id: race.id,
            actor_type: actorType,
            actor_id: null,
            source_path: "sponsorRaceDayIncome.payRaceDaySponsorsToDate",
            reason_code: FINANCE_REASON.SPONSOR_RESULT_BONUS,
            related_entity_type: FINANCE_RELATED_ENTITY.RACE,
            related_entity_id: race.id,
            idempotency_key: b.idempotencyKey,
          },
        },
        { allowDuplicate: true }
      );
      if (skipped) continue;
      resultBonuses += 1;
      notifyAmountByTeam[b.teamId] = (notifyAmountByTeam[b.teamId] || 0) + b.amount;

      // Persistér loft-forbruget. Kreditering skete (idempotent), så inkrement
      // her er sikkert; ved crash mellem de to writes over-krediteres højst én
      // race-bonus næste sweep — accepteret (samme klasse som prize-sweepens
      // race-granularitet).
      if (Number.isFinite(remainingCapByTeam[b.teamId])) {
        remainingCapByTeam[b.teamId] = Math.max(remainingCapByTeam[b.teamId] - b.amount, 0);
        const contract = contractsByTeam[b.teamId];
        const { error: capError } = await supabase
          .from("sponsor_contracts")
          .update({ results_bonus_paid: (Number(contract.results_bonus_paid) || 0) + b.amount })
          .eq("id", contract.id);
        if (capError) throw new Error(capError.message);
        contract.results_bonus_paid = (Number(contract.results_bonus_paid) || 0) + b.amount;
      }
    }

    // #3315: ÉN sponsor_paid-notifikation pr. hold der reelt fik penge for
    // dette løb (race-day og/eller resultat-bonus, summeret). Notifikationen
    // må ALDRIG vælte payout-sweepen — en fejlet besked er tabt, ikke en
    // gentaget kreditering (skipped-guarden ovenfor er allerede idempotent).
    for (const [teamId, amount] of Object.entries(notifyAmountByTeam)) {
      if (amount <= 0) continue;
      await notifySponsorPaidSafe(supabase, {
        teamId,
        sponsorName: contractsByTeam[teamId]?.sponsor_name,
        amount,
        raceName: race.name,
        raceId: race.id,
      });
    }
  }

  return { credited, result_bonuses: resultBonuses };
}
