// #3730 · Forholdsmæssig sponsor ved tilmelding midt i en sæson.
//
// PROBLEMET (målt mod prod 14/8): sponsoren udbetales ved sæsonstart til de hold der
// findes på det tidspunkt, og selve kontrakten seedes samme sted (expireAndRenewContracts).
// Et hold der oprettes i uge tre findes ikke når pengene deles ud, og får dermed HVERKEN
// kontrakt eller udbetaling før næste sæsonskifte. Det efterlader det med 500.000 i
// startkapital og derefter kun præmiepenge.
//
// Målt i sæson 2, division 4: de 12 hold der var med fra sæsonstart havde en median-indtægt
// på 326.596. De 43 der blev oprettet undervejs havde 31.125. Ti gange forskel inden for
// samme division, samme kalender, samme regler. Ingen af de 43 fik `season_start_sponsor`,
// og 29 af dem havde slet ingen sponsorkontrakt.
//
// Det er IKKE et divisions-problem, selvom det ligner et: det rammer enhver der starter
// midt i en sæson, og ses kun i division 4 fordi det er dér nye managere lander nu hvor
// division 3 er fyldt (#1688).
//
// RETTELSEN: et hold får sin kontrakt når det oprettes, og den garanterede base udbetales
// forholdsmæssigt for den resterende del af sæsonen. Efterfølgende sæsoner er uændrede —
// expireAndRenewContracts ser en aktiv kontrakt og fornyer/udløber den som hidtil.
//
// BLOKERENDE FOR #3393: lønreformen sætter lønnen efter rytterens produktion med ét
// globalt anker. Lagt oven på et hold der tjener 31.125 i sin første sæson æder lønnen
// hele indtægten. Doktrinen siger at styrke aldrig straffes; det her straffede for at
// være ny.

import {
  DEFAULT_RENEW_VARIANT,
  getActiveContract,
  getOffers,
  loadSeasonStageCounts,
  resolveStageDivisor,
} from "./sponsorContractsService.js";
import { incrementBalanceWithAudit } from "./balanceRpc.js";
import { FINANCE_ACTOR_TYPE, FINANCE_REASON, FINANCE_RELATED_ENTITY } from "./economyConstants.js";

// Andel af sæsonen der er TILBAGE, målt i løbsdage. Ren funktion, ingen I/O.
//
// Løbsdage frem for kalenderdage er med vilje: sponsoren betaler for at holdet kører løb,
// og det er også den enhed løbsdags-sponsoren allerede bruger (#2913). En sæson kan sagtens
// have flere kalenderdage end løbsdage.
//
// Defensiv over for skæve data: ukendt/0 total → 0 (ingen udbetaling, hellere end en
// division-by-zero eller en fuld base til et hold der kom ind på sidste dag). Flere
// afviklede dage end totalen → 0. Negativ completed → behandles som 0 afviklede.
export function proRataShare({ raceDaysTotal, raceDaysCompleted } = {}) {
  const total = Number(raceDaysTotal);
  if (!Number.isFinite(total) || total <= 0) return 0;
  const doneRaw = Number(raceDaysCompleted);
  const done = Number.isFinite(doneRaw) ? Math.max(0, doneRaw) : 0;
  const remaining = total - done;
  if (remaining <= 0) return 0;
  return Math.min(1, remaining / total);
}

// Beløbet et hold skal have udbetalt ved tilmelding. Ren funktion.
export function proRataAmount({ guaranteedBase, share } = {}) {
  const base = Number(guaranteedBase);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const s = Number(share);
  if (!Number.isFinite(s) || s <= 0) return 0;
  return Math.round(base * Math.min(1, s));
}

// Opret kontrakt + udbetal forholdsmæssig base for et NYT hold i en KØRENDE sæson.
//
// Idempotent i to lag: (1) et hold der allerede har en aktiv kontrakt springes over, så
// et gentaget bootstrap-kald ikke opretter to; (2) udbetalingen bærer en idempotency_key
// pr. (sæson, hold), så en retry efter en halvvejs-fejl ikke kan betale to gange.
//
// Kaster ALDRIG for "der er ikke noget at gøre" (ingen aktiv sæson, sæsonen er slut,
// kontrakt findes allerede) — de returnerer et `skipped` så kaldstedet kan logge uden at
// behandle det som en fejl. Ægte fejl (DB nede, ukendt variant) bobler op, så en stille
// halv-oprettelse ikke er mulig.
// Samarbejdspartnerne er injicerbare (samme mønster som raceResultsEngine's
// applyRaceResultsBatchAtomic): getOffers/loadSeasonStageCounts rammer DB'en ad flere
// veje, og et komplet fetch-mock ville teste mock'et frem for logikken.
export async function ensureMidSeasonSponsor({
  supabase,
  team,
  getActiveContractFn = getActiveContract,
  getOffersFn = getOffers,
  loadSeasonStageCountsFn = loadSeasonStageCounts,
  creditFn = incrementBalanceWithAudit,
} = {}) {
  if (!supabase?.from) throw new Error("ensureMidSeasonSponsor: a Supabase client is required");
  if (!team?.id) throw new Error("ensureMidSeasonSponsor: a team with an id is required");

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, number, race_days_total, race_days_completed")
    .eq("status", "active")
    .maybeSingle();
  if (seasonError) throw seasonError;
  if (!season) return { skipped: "no_active_season" };

  // Sæson-1-opstarten har sin egen gren (SEASON1_SKIP_SPONSOR_IF_STARTING_CAPITAL): et hold
  // med urørt startkapital skal IKKE have sponsor oveni. Den regel gælder kun sæson 1, og
  // her ville den ellers ramme hvert eneste nye hold i sæson 1 to gange.
  const existing = await getActiveContractFn({ supabase, teamId: team.id });
  if (existing) return { skipped: "already_has_contract", contractId: existing.id };

  const share = proRataShare({
    raceDaysTotal: season.race_days_total,
    raceDaysCompleted: season.race_days_completed,
  });
  if (share <= 0) return { skipped: "season_over", seasonNumber: season.number };

  const offers = await getOffersFn({ supabase, teamId: team.id, seasonNumber: season.number });
  const chosen = (offers || []).find((o) => o.variant === DEFAULT_RENEW_VARIANT);
  if (!chosen) throw new Error(`ensureMidSeasonSponsor: unknown variant ${DEFAULT_RENEW_VARIANT}`);

  // Per-løbsdags-raten sættes mod holdets EGEN divisions etapetal, præcis som ved
  // sæsonstart (#2913) — ellers ville et D4-hold få en rate kalibreret mod D1's kalender.
  const stageCounts = await loadSeasonStageCountsFn({ supabase, seasonNumber: season.number });
  const divisor = resolveStageDivisor(stageCounts, team);
  const target = Math.round(chosen.guaranteedBase / chosen.guaranteedFraction);

  const { data: contract, error: insertError } = await supabase
    .from("sponsor_contracts")
    .insert({
      team_id: team.id,
      sponsor_name: chosen.sponsorName,
      guaranteed_base: chosen.guaranteedBase,
      per_race_day_rate: Math.round((target * chosen.raceDayShare) / divisor),
      length_seasons: chosen.lengthSeasons,
      start_season: season.number,
      expires_after_season: season.number + chosen.lengthSeasons - 1,
      status: "active",
      variant: chosen.variant,
      guaranteed_fraction: chosen.guaranteedFraction,
      race_day_share: chosen.raceDayShare,
      bonus_clauses: chosen.clauses,
    })
    .select()
    .single();
  if (insertError) throw insertError;

  const amount = proRataAmount({ guaranteedBase: chosen.guaranteedBase, share });
  if (amount <= 0) return { contractId: contract.id, amount: 0, share, paid: false };

  const pct = Math.round(share * 100);
  const { skipped } = await creditFn(
    supabase,
    {
      teamId: team.id,
      delta: amount,
      payload: {
        type: "sponsor",
        amount,
        description: `Sponsor — pro-rata for the rest of the season (${chosen.sponsorName}, ${pct} %)`,
        metadata: {
          code: "tx.sponsor.midSeasonProRata",
          params: { sponsorName: chosen.sponsorName, percent: pct },
        },
        actor_type: FINANCE_ACTOR_TYPE.SYSTEM,
        actor_id: null,
        source_path: "midSeasonSponsor.ensureMidSeasonSponsor",
        reason_code: FINANCE_REASON.MIDSEASON_SPONSOR_PRORATA,
        related_entity_type: FINANCE_RELATED_ENTITY.SEASON,
        related_entity_id: season.id,
        idempotency_key: `midseason_sponsor:${season.id}:${team.id}`,
      },
    },
    { allowDuplicate: true }
  );

  return {
    contractId: contract.id,
    amount,
    share,
    seasonNumber: season.number,
    paid: !skipped,
  };
}
