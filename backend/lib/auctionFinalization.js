import {
  calculateRiderMarketValue,
  closeTransferListingsForRiders,
  ensureNoError,
  expectMaybeSingle,
  expectMutation,
  getIncomingSquadViolation,
  getTeamMarketState,
  withdrawOpenTransferDealsForRiders,
  MARKET_SQUAD_LIMITS,
} from "./marketUtils.js";
import { incrementBalanceWithAudit, DUPLICATE_VIOLATION_CODE } from "./balanceRpc.js";
import { clearFutureRaceEntriesSafe } from "./raceEntryCleanup.js";
import { getRidersInActiveStageRace } from "./stageRaceTransferDefer.js";
import { contractOnAcquirePatch } from "./contractSeed.js";
import { buildContractExpiringNotification, notifyAndClearWatchlistForRiders } from "./notificationService.js";
import { ACADEMY } from "./academyFlag.js";
import {
  FINANCE_ACTOR_TYPE,
  FINANCE_REASON,
  FINANCE_RELATED_ENTITY,
} from "./economyConstants.js";

export const AUCTION_SQUAD_LIMITS = MARKET_SQUAD_LIMITS;

const FINALIZABLE_STATUSES = ["active", "extended"];
const NOOP = async () => {};

export function sellerOwnsAuctionRider(auction) {
  return Boolean(auction?.rider && auction.rider.team_id === auction.seller_team_id);
}

function isHumanManagedTeam(team) {
  return Boolean(team?.user_id) && !team?.is_ai;
}

function getHistorySellerTeamId(auction, sellerOwned) {
  return sellerOwned ? auction.seller_team_id : null;
}

async function closeAuction({
  supabase,
  auction,
  status,
  actualEnd,
  sellerOwned,
  currentBidderId,
}) {
  const payload = {
    status,
    actual_end: actualEnd,
    seller_team_id: getHistorySellerTeamId(auction, sellerOwned),
  };

  if (currentBidderId) {
    payload.current_bidder_id = currentBidderId;
  }

  await expectMutation(
    supabase
      .from("auctions")
      .update(payload)
      .eq("id", auction.id)
  );
}

async function resolveAuctionSellerContext({ supabase, auction }) {
  const sellerOwned = sellerOwnsAuctionRider(auction);
  if (sellerOwned) {
    return {
      sellerOwned,
      actualSellerTeamId: auction.seller_team_id,
      actualSeller: null,
      staleHumanOwner: false,
    };
  }

  const riderOwnerTeamId = auction?.rider?.team_id ?? null;
  if (!riderOwnerTeamId) {
    return {
      sellerOwned: false,
      actualSellerTeamId: null,
      actualSeller: null,
      staleHumanOwner: false,
    };
  }

  const actualSeller = await expectMaybeSingle(
    supabase
      .from("teams")
      .select("id, name, balance, user_id, is_ai")
      .eq("id", riderOwnerTeamId)
  );

  if (!actualSeller) {
    return {
      sellerOwned: false,
      actualSellerTeamId: null,
      actualSeller: null,
      staleHumanOwner: true,
    };
  }

  if (isHumanManagedTeam(actualSeller)) {
    return {
      sellerOwned: false,
      actualSellerTeamId: null,
      actualSeller,
      staleHumanOwner: true,
    };
  }

  return {
    sellerOwned: false,
    actualSellerTeamId: actualSeller.id,
    actualSeller,
    staleHumanOwner: false,
  };
}

function getEffectiveAuctionBidderId(auction, sellerOwned) {
  if (auction.current_bidder_id) {
    return auction.current_bidder_id;
  }

  if (!auction.is_guaranteed_sale && !sellerOwned && auction.seller_team_id) {
    return auction.seller_team_id;
  }

  return null;
}

// #2456 "usolgt = væk": en ungdomsauktion der ender UDEN at rytteren bliver
// optaget (ingen bud, eller vinderen kunne ikke optage: akademi fuldt / ingen
// råd) sletter rytteren — han forlader sporten. Fri-agent-listen i akademiet er
// fjernet, så der er ingen tilstand at falde tilbage på; en holdløs ungdomsrytter
// ville være en usynlig spøgelsesrytter (#2257).
//
// Guards (TOCTOU + #1847):
//   1. Kaldes KUN efter at auktionen er lukket (atomisk claim i no-bid-stien /
//      closeAuction i cancel-stierne) — et nyt bud kan ikke lande på en lukket
//      auktion (bid-ruten kræver status active/extended).
//   2. #1847: har rytteren race_results, beholdes han — sletning ville sætte
//      race_results.rider_id = NULL (ON DELETE SET NULL) og skabe nye orphans.
//      En usolgt ungdomsrytter har normalt 0 resultater, men vi verificerer i
//      stedet for at antage.
//   3. Selve DELETE er conditional, scoped til rider-id (ejer-låst guard i
//      #2456): slet KUN hvis rytteren stadig er holdløs (team_id IS NULL,
//      pending_team_id IS NULL) og uden for et akademi. Er han imens optaget ad
//      en parallel sti, rammer den 0 rækker og rytteren bevares.
//
// Bemærk: riders-FK'en fra auctions er ON DELETE CASCADE, så den lukkede
// auktionsrække (og dens bud) følger med rytteren ud.
async function deleteUnsoldYouthRider({ supabase, rider }) {
  const { data: resultRows, error: resErr } = await supabase
    .from("race_results")
    .select("id")
    .eq("rider_id", rider.id)
    .limit(1);
  ensureNoError(resErr);
  if ((resultRows ?? []).length > 0) {
    console.warn(
      `  ⚠️  Usolgt ungdomsrytter ${rider.id} har race_results — beholdes (#1847-guard, ingen nye orphans)`
    );
    return false;
  }

  const { data: deleted, error: delErr } = await supabase
    .from("riders")
    .delete()
    .eq("id", rider.id)
    .is("team_id", null)
    .is("pending_team_id", null)
    .eq("is_academy", false)
    .select("id");
  ensureNoError(delErr);
  const wasDeleted = (deleted ?? []).length > 0;
  // #2524: rider_watchlist har ingen FK-cascade — uden dette hook forsvinder
  // rytteren tavst fra enhver managers ønskeliste (frontend-orphan-filter,
  // WatchlistPage.jsx #1918). Notificér + ryd KUN når sletningen faktisk landede.
  if (wasDeleted) {
    await notifyAndClearWatchlistForRiders({ supabase, riders: [rider] });
  }
  return wasDeleted;
}

// #1308 Fase B: finalisér en ungdomsauktion. Ingen sælger (seller_team_id=NULL),
// rytteren er fri (team_id=NULL). Vinder → placeres i akademiet (is_academy=true)
// med 8-plads-cap og ungdomskontrakt; betaler sit bud som academy_signing (sink —
// der er ingen sælger at betale ud til). Ingen bud → rytteren slettes (#2456,
// "usolgt = væk" — se deleteUnsoldYouthRider ovenfor).
// Akademiryttere bypasser senior-30-cap'en og transfervindue-pending (de tæller
// ikke mod senior-truppen), så ingen squad-violation-/pending-logik her.
async function finalizeYouthAuctionRecord({
  supabase,
  auction,
  notifyTeamOwner,
  logActivity = NOOP,
  awardXP = NOOP,
  actualEnd,
  activeSeasonId,
  activeSeasonNumber,
}) {
  const rider = auction.rider;
  const bidderId = auction.current_bidder_id || null;

  // Ingen bud → rytteren slettes (#2456 "usolgt = væk").
  //
  // TOCTOU-guard: claim auktionen ATOMISK med en conditional UPDATE der kun
  // rammer hvis status stadig er finalizable OG der stadig ikke er nogen byder.
  // Et bud der racer med finaliseringen (dets insert passerede
  // reject_late_auction_bid-triggeren lige før udløb, men current_bidder_id-
  // skrivningen lander efter vores read) gør claimen til 0 rækker → rytteren
  // røres IKKE, og næste finalize-pass gennemfører auktionen med vinderen.
  // Buddet vinder altid over sletningen.
  if (!bidderId) {
    const { data: claimed, error: claimErr } = await supabase
      .from("auctions")
      .update({ status: "completed", actual_end: actualEnd, seller_team_id: null })
      .eq("id", auction.id)
      .in("status", FINALIZABLE_STATUSES)
      .is("current_bidder_id", null)
      .select("id");
    ensureNoError(claimErr);
    if ((claimed ?? []).length === 0) {
      return { ok: true, code: "youth_bid_raced", auction_id: auction.id };
    }
    const riderDeleted = await deleteUnsoldYouthRider({ supabase, rider });
    return { ok: true, code: "youth_no_bids", auction_id: auction.id, rider_deleted: riderDeleted };
  }

  const price = auction.current_price;

  // Placér i akademiet med ungdomskontrakt (samme løn-/kontrakt-model som
  // signAcademyCandidate; akademiryttere bypasser senior-cap + transfervindue).
  const value = Math.max(1, calculateRiderMarketValue(rider));
  const salary = Math.max(1, Math.round(value * ACADEMY.SALARY_RATE));
  const contractEndSeason = activeSeasonNumber + ACADEMY.CONTRACT_LENGTH - 1;

  // #1558: cap-check (8-plads, hård) + balance-check + rider-update + debit sker
  // nu ATOMISK i én RPC under pg_advisory_xact_lock(team_id) — samme lock-nøgle
  // som increment_balance_with_audit, så de serialiserer på samme team. Det
  // lukker BÅDE finalize-vs-finalize OG finalize-vs-signAcademyCandidate-racen,
  // som tidligere kunne give to debiteringer (forskellige idempotency-keys). RPC'en
  // er nu den autoritative gate; idempotency_key gør cron-retries sikre.
  const { data: acq, error: acqErr } = await supabase.rpc("finalize_academy_acquisition", {
    p_team_id: bidderId,
    p_rider_id: rider.id,
    p_price: price,
    p_salary: salary,
    p_contract_length: ACADEMY.CONTRACT_LENGTH,
    p_contract_end_season: contractEndSeason,
    p_acquired_at: actualEnd,
    p_finance_payload: {
      type: "academy_signing",
      amount: -price,
      description: `Vandt ungdomsrytter ${rider.firstname} ${rider.lastname} på auktion`,
      metadata: {
        code: "tx.youthAuctionWin",
        params: { riderName: `${rider.firstname} ${rider.lastname}` },
      },
      season_id: activeSeasonId,
      actor_type: FINANCE_ACTOR_TYPE.CRON,
      actor_id: null,
      source_path: "auctionFinalization.finalizeYouthAuctionRecord.winner",
      reason_code: FINANCE_REASON.AUCTION_WINNER_PAYMENT,
      related_entity_type: FINANCE_RELATED_ENTITY.AUCTION,
      related_entity_id: auction.id,
      // Cron-retry-sikring: en gen-finalize af samme auktion må ikke double-pay.
      idempotency_key: `youth_auction_winner:${auction.id}`,
    },
  });

  // 23505 (idempotency_key-dublet) = cron-retry af en allerede-betalt auktion.
  // Behandl som "allerede gennemført" — luk auktionen completed uden notifikation.
  if (acqErr) {
    if (acqErr.code === DUPLICATE_VIOLATION_CODE) {
      await closeAuction({ supabase, auction, status: "completed", actualEnd, sellerOwned: false });
      return { ok: true, code: "youth_completed", auction_id: auction.id, academy: true, duplicate: true };
    }
    throw acqErr;
  }

  // Akademi fuldt (cap nået inde i låsen) → annullér. Rytteren blev ikke optaget
  // → han slettes (#2456; fri-agent-listen findes ikke længere, og en holdløs
  // ungdomsrytter ville være en usynlig spøgelsesrytter).
  if (acq?.code === "academy_full") {
    await closeAuction({ supabase, auction, status: "cancelled", actualEnd, sellerOwned: false });
    await notifyTeamOwner(
      bidderId,
      "auction_lost",
      "Auktion annulleret — akademi fuldt",
      `Dit akademi er fuldt (${ACADEMY.SLOTS} pladser). ${rider.firstname} ${rider.lastname} kunne ikke optages.`,
      auction.id,
      { riderId: rider.id }
    );
    const riderDeleted = await deleteUnsoldYouthRider({ supabase, rider });
    return { ok: true, code: "academy_full", auction_id: auction.id, rider_deleted: riderDeleted };
  }

  // Utilstrækkelig balance (verificeret inde i låsen) → annullér; rytteren blev
  // ikke optaget → han slettes (#2456, samme begrundelse som academy_full).
  if (acq?.code === "insufficient_balance") {
    await closeAuction({ supabase, auction, status: "cancelled", actualEnd, sellerOwned: false });
    await notifyTeamOwner(
      bidderId,
      "auction_lost",
      "Auktion annulleret",
      `Du havde ikke råd til ${rider.firstname} ${rider.lastname}.`,
      auction.id,
      { riderId: rider.id }
    );
    const riderDeleted = await deleteUnsoldYouthRider({ supabase, rider });
    return { ok: true, code: "cancelled_insufficient_balance", auction_id: auction.id, rider_deleted: riderDeleted };
  }

  // Rytteren var allerede optaget (vundet af en parallel sti) → annullér uden
  // debit (lukker det omvendte tab: køber debiteret uden at få rytteren).
  if (acq?.code === "already_assigned") {
    await closeAuction({ supabase, auction, status: "cancelled", actualEnd, sellerOwned: false });
    await notifyTeamOwner(
      bidderId,
      "auction_lost",
      "Auktion annulleret",
      `${rider.firstname} ${rider.lastname} blev optaget af et andet hold.`,
      auction.id,
      { riderId: rider.id }
    );
    return { ok: true, code: "cancelled_already_assigned", auction_id: auction.id };
  }

  if (!acq?.ok) {
    throw new Error(`finalize_academy_acquisition uventet svar: ${JSON.stringify(acq)}`);
  }

  // Defensivt: luk evt. åbne transfer_listings (en fri ungdom bør ikke have nogen).
  await closeTransferListingsForRiders(supabase, [rider.id], "sold");

  await awardXP(bidderId, "auction_won");
  await notifyTeamOwner(
    bidderId,
    "auction_won",
    "Du vandt ungdomsauktionen! 🎉",
    `${rider.firstname} ${rider.lastname} er nu i dit akademi for ${price} CZ$`,
    auction.id,
    { riderId: rider.id }
  );
  await logActivity("auction_won", {
    team_id: bidderId,
    rider_id: rider.id,
    rider_name: `${rider.firstname} ${rider.lastname}`,
    amount: price,
  });

  await closeAuction({
    supabase,
    auction,
    status: "completed",
    actualEnd,
    sellerOwned: false,
    currentBidderId: auction.current_bidder_id ? null : bidderId,
  });

  return { ok: true, code: "youth_completed", auction_id: auction.id, academy: true };
}

async function finalizeAuctionRecord({
  supabase,
  auction,
  notifyTeamOwner,
  discordNotify = NOOP,
  logActivity = NOOP,
  awardXP = NOOP,
  squadLimits = AUCTION_SQUAD_LIMITS,
  now = new Date(),
}) {
  if (!FINALIZABLE_STATUSES.includes(auction.status)) {
    return {
      ok: false,
      code: auction.status === "completed" ? "already_completed" : "not_finalizable",
      auction,
    };
  }

  const actualEnd = now.toISOString();

  // 07d Fase B / #240: Slå aktiv sæson op én gang så audit-payloads kan stamp'e
  // season_id eksplicit. DB-trigger fill_finance_tx_season() er en safety-net,
  // men callsites skal være selv-dokumenterende. activeSeasonId kan være null
  // i edge-cases (ingen aktiv sæson registreret) — lad triggeren tage over.
  const { data: activeSeason } = await supabase
    .from("seasons")
    .select("id, number")
    .eq("status", "active")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const activeSeasonId = activeSeason?.id ?? null;
  // #1309 kontrakt-on-acquire: aktiv sæson-number til contract_end_season-beregning.
  // Default 1 hvis ingen aktiv sæson er registreret (edge-case).
  const activeSeasonNumber = activeSeason?.number ?? 1;

  // #1308 Fase B: ungdomsauktioner (is_youth) har ingen sælger og placerer
  // vinderen i akademiet (8-plads-cap) frem for senior-truppen. Håndteres i en
  // dedikeret gren, så seller-resolution / squad-cap / transfervindue-pending
  // (ren senior-semantik) ikke forvansker youth-flowet.
  if (auction.is_youth) {
    return finalizeYouthAuctionRecord({
      supabase,
      auction,
      notifyTeamOwner,
      logActivity,
      awardXP,
      actualEnd,
      activeSeasonId,
      activeSeasonNumber,
    });
  }

  const {
    sellerOwned,
    actualSellerTeamId,
    actualSeller: _actualSeller,
    staleHumanOwner,
  } = await resolveAuctionSellerContext({
    supabase,
    auction,
  });

  if (staleHumanOwner) {
    await closeAuction({
      supabase,
      auction,
      status: "cancelled",
      actualEnd,
      sellerOwned,
    });

    if (auction.current_bidder_id) {
      await notifyTeamOwner(
        auction.current_bidder_id,
        "auction_lost",
        "Auktion annulleret",
        `${auction.rider.firstname} ${auction.rider.lastname} kunne ikke overdrages, fordi rytteren nu tilhører en anden manager.`,
        auction.id,
        { riderId: auction.rider.id }
      );
    }

    if (auction.seller_team_id) {
      await notifyTeamOwner(
        auction.seller_team_id,
        "auction_lost",
        "Auktion annulleret",
        `${auction.rider.firstname} ${auction.rider.lastname} står ikke længere på dit hold. Auktionen blev derfor annulleret.`,
        auction.id,
        { riderId: auction.rider.id }
      );
    }

    return {
      ok: true,
      code: "cancelled_stale_owner",
      auction_id: auction.id,
    };
  }

  const effectiveBidderId = getEffectiveAuctionBidderId(auction, sellerOwned);

  if (effectiveBidderId) {
    const price = auction.current_price;
    const baseBuyerState = await getTeamMarketState(supabase, effectiveBidderId);
    const buyer = {
      ...baseBuyerState,
      squad_limits:
        squadLimits[baseBuyerState.division || 3] || baseBuyerState.squad_limits,
    };

    if (!buyer || buyer.balance < price) {
      await closeAuction({
        supabase,
        auction,
        status: "cancelled",
        actualEnd,
        sellerOwned,
      });

      await notifyTeamOwner(
        effectiveBidderId,
        "auction_lost",
        "Auktion annulleret",
        `Du havde ikke råd til ${auction.rider.firstname} ${auction.rider.lastname}. Saldo: ${buyer?.balance || 0} CZ$`,
        auction.id,
        { riderId: auction.rider.id }
      );

      if (auction.seller_team_id) {
        await notifyTeamOwner(
          auction.seller_team_id,
          "auction_lost",
          "Auktion annulleret",
          `Køber manglede balance. ${auction.rider.firstname} ${auction.rider.lastname} blev ikke overdraget.`,
          auction.id,
          { riderId: auction.rider.id }
        );
      }

      return {
        ok: true,
        code: "cancelled_insufficient_balance",
        auction_id: auction.id,
      };
    }

    // #1995: er rytteren i et AKTIVT fleretape-løb, parkeres holdskiftet på
    // pending_team_id (han kører løbet færdigt for sælgeren) og flushes når
    // løbet finaliseres. Betaling + auktions-lukning sker straks (Model B).
    const deferTeamChange =
      (await getRidersInActiveStageRace(supabase, [auction.rider.id])).length > 0;
    const squadViolation = getIncomingSquadViolation(buyer, {
      // #16 altid-åben handel: intet transfervindue → ingen vindue-grace → hard cap ved handlen.
      softCapBuffer: 0,
    });
    if (squadViolation) {
      await closeAuction({
        supabase,
        auction,
        status: "completed",
        actualEnd,
        sellerOwned,
      });

      const buyerMessage = `Dit hold (Div ${buyer.division || 3}) kan maks. have ${squadViolation.maxRiders} ryttere. ${auction.rider.firstname} ${auction.rider.lastname} kunne ikke overdrages — sælg en rytter først.`;

      await notifyTeamOwner(
        effectiveBidderId,
        "auction_lost",
        "Auktion annulleret — hold fuldt",
        buyerMessage,
        auction.id,
        { riderId: auction.rider.id }
      );

      if (auction.seller_team_id) {
        await notifyTeamOwner(
          auction.seller_team_id,
          "auction_lost",
          "Auktion annulleret",
          `${auction.rider.firstname} ${auction.rider.lastname} kunne ikke overdrages, fordi vinderens hold var fuldt.`,
          auction.id,
          { riderId: auction.rider.id }
        );
      }

      return {
        ok: true,
        code: "squad_full",
        auction_id: auction.id,
      };
    }

    // #1309 kontrakt-on-acquire: vinderen erhverver rytteren → opret standard-
    // kontrakt hvis kontraktløs (salary == null); ellers arves den uændret.
    // Skrives både ved åbent vindue (team_id nu) og lukket vindue (pending_team_id),
    // fordi den generiske pending-flush ved vindue-åbning kun flytter team_id og
    // IKKE rører kontraktfelterne.
    const winnerContractPatch = contractOnAcquirePatch(auction.rider, activeSeasonNumber);
    // #932: en graduate-salgs-auktion (akademirytter solgt af sit eget hold) skal
    // lande hos vinderen som SENIOR — ikke i vinderens akademi. Flip is_academy=false.
    const graduatePatch = auction.rider?.is_academy ? { is_academy: false } : {};
    await expectMutation(
      supabase
        .from("riders")
        .update(
          deferTeamChange
            ? {
                pending_team_id: effectiveBidderId,
                ...winnerContractPatch,
                ...graduatePatch,
              }
            : {
                team_id: effectiveBidderId,
                pending_team_id: null,
                acquired_at: actualEnd,
                ...winnerContractPatch,
                ...graduatePatch,
              }
        )
        .eq("id", auction.rider.id)
    );

    // #1906 defense-in-depth: rytteren forlod sælgeren — ryd hans fremtidige
    // race_entries så de ikke hænger ved som ghost og phantom-binder en ægte rytter.
    // #1995: i defer-stien bliver rytteren hos sælger til race-slut (flushen rydder).
    if (!deferTeamChange) {
      await clearFutureRaceEntriesSafe({ supabase, riderId: auction.rider.id, label: "auction_win" });
    }

    // #822: rytteren er solgt — luk alle åbne transfer_listings så han ikke
    // står som zombie-"til salg" på transfermarkedet. Gælder også ved lukket
    // vindue (pending_team_id): salget er bindende og betalt, så et åbent
    // listing ville kunne dobbelt-sælge rytteren.
    await closeTransferListingsForRiders(supabase, [auction.rider.id], "sold");
    // #1748 (a): træk OGSÅ åbne transfer-/swap-TILBUD på rytteren tilbage — ikke
    // kun listings — så en modpart ikke kan bekræfte et gammelt tilbud efter
    // auktionssalget og forsøge en dobbelt-overdragelse.
    await withdrawOpenTransferDealsForRiders(supabase, [auction.rider.id]);

    // Slice 07c: balance + finance_transactions atomic via RPC.
    // 07d Fase B / #240: cron-finalizer → actor_type=cron, actor_id=null,
    // season_id eksplicit + idempotency_key så cron-retries ikke double-pay.
    await incrementBalanceWithAudit(supabase, {
      teamId: effectiveBidderId,
      delta: -price,
      payload: {
        type: "transfer_out",
        amount: -price,
        description: `Købt ${auction.rider.firstname} ${auction.rider.lastname} på auktion`,
        metadata: {
          code: "tx.auctionBuy",
          params: { riderName: `${auction.rider.firstname} ${auction.rider.lastname}` },
        },
        season_id: activeSeasonId,
        actor_type: FINANCE_ACTOR_TYPE.CRON,
        actor_id: null,
        source_path: "auctionFinalization.finalizeAuctionRecord.buyer",
        reason_code: FINANCE_REASON.AUCTION_WINNER_PAYMENT,
        related_entity_type: FINANCE_RELATED_ENTITY.AUCTION,
        related_entity_id: auction.id,
        idempotency_key: `auction_winner:${auction.id}`,
      },
    }, { allowDuplicate: true });

    if (actualSellerTeamId) {
      await incrementBalanceWithAudit(supabase, {
        teamId: actualSellerTeamId,
        delta: price,
        payload: {
          type: "transfer_in",
          amount: price,
          description: `Solgt ${auction.rider.firstname} ${auction.rider.lastname} på auktion`,
          metadata: {
            code: "tx.auctionSell",
            params: { riderName: `${auction.rider.firstname} ${auction.rider.lastname}` },
          },
          season_id: activeSeasonId,
          actor_type: FINANCE_ACTOR_TYPE.CRON,
          actor_id: null,
          source_path: "auctionFinalization.finalizeAuctionRecord.seller",
          reason_code: FINANCE_REASON.AUCTION_SELLER_PAYOUT,
          related_entity_type: FINANCE_RELATED_ENTITY.AUCTION,
          related_entity_id: auction.id,
          idempotency_key: `auction_seller:${auction.id}`,
        },
      }, { allowDuplicate: true });
    }

    await awardXP(effectiveBidderId, "auction_won");
    if (sellerOwned) {
      await awardXP(auction.seller_team_id, "auction_sold");
    }

    await notifyTeamOwner(
      effectiveBidderId,
      "auction_won",
      "Du vandt auktionen! 🎉",
      deferTeamChange
        ? `${auction.rider.firstname} ${auction.rider.lastname} er købt for ${price} CZ$ — han skifter til dit hold, når hans igangværende etapeløb er kørt færdigt.`
        : `${auction.rider.firstname} ${auction.rider.lastname} er nu på dit hold for ${price} CZ$`,
      auction.id,
      { riderId: auction.rider.id }
    );

    // #1836 · køb-trigger: hvis den vundne rytters kontrakt udløber i NUVÆRENDE
    // sæson, advar køberen med det samme ("du købte en rytter hvis kontrakt
    // udløber i år"). contract_end_season kan netop være sat af winnerContractPatch
    // (kontraktløs free agent → standard-kontrakt), så vi læser den effektive værdi.
    const winnerContractEndSeason =
      winnerContractPatch.contract_end_season ?? auction.rider.contract_end_season;
    if (winnerContractEndSeason === activeSeasonNumber) {
      const expiring = buildContractExpiringNotification({
        riderName: `${auction.rider.firstname} ${auction.rider.lastname}`,
        riderId: auction.rider.id,
        seasonNumber: activeSeasonNumber,
      });
      // #1872: en kosmetisk kontrakt-notifikation må ALDRIG kunne rulle en
      // allerede-committet finalisering (køber debiteret, sælger krediteret,
      // rytter flyttet) tilbage. Finalize er ikke atomisk på tværs af RPC-kald,
      // så et throw her efterlod auktionen i en evig cron-retry-loop ("Udløbet"
      // men aldrig completed). Sluges + logges; closeAuction skal altid nås.
      try {
        await notifyTeamOwner(
          effectiveBidderId,
          expiring.type,
          expiring.title,
          expiring.message,
          expiring.relatedId,
          expiring.metadata
        );
      } catch (notifyErr) {
        console.error(
          `  ⚠️  Kontraktudløb-notifikation fejlede for auktion ${auction.id} (ikke-fatal):`,
          notifyErr.message
        );
      }
    }

    discordNotify({
      riderName: `${auction.rider.firstname} ${auction.rider.lastname}`,
      finalPrice: price,
      teamId: effectiveBidderId,
    }).catch(() => {});

    if (auction.seller_team_id) {
      await notifyTeamOwner(
        auction.seller_team_id,
        "auction_won",
        "Auktion afsluttet",
        sellerOwned
          ? `${auction.rider.firstname} ${auction.rider.lastname} solgt for ${price} CZ$`
          : `${auction.rider.firstname} ${auction.rider.lastname} blev købt for ${price} CZ$`,
        auction.id,
        { riderId: auction.rider.id }
      );
    }

    await logActivity("auction_won", {
      team_id: effectiveBidderId,
      team_name: buyer.name,
      rider_id: auction.rider.id,
      rider_name: `${auction.rider.firstname} ${auction.rider.lastname}`,
      amount: price,
    });

    await closeAuction({
      supabase,
      auction,
      status: "completed",
      actualEnd,
      sellerOwned,
      currentBidderId: auction.current_bidder_id ? null : effectiveBidderId,
    });

    return {
      ok: true,
      code: "completed",
      auction_id: auction.id,
      seller_owned: sellerOwned,
    };
  }

  const bankTeam = auction.is_guaranteed_sale
    ? await expectMaybeSingle(
        supabase
          .from("teams")
          .select("id, balance")
          .eq("is_bank", true)
      )
    : null;

  if (auction.is_guaranteed_sale && sellerOwned && bankTeam) {
    const salePrice = auction.guaranteed_price;

    // #1309 kontrakt-on-acquire: banken erhverver den usolgte rytter → giv også
    // bank-holdte ryttere en kontrakt hvis kontraktløs, så "ejede ryttere har
    // altid salary != null" holder for ALLE ejede (også bankens), og en senere
    // gen-auktion/handel arver kontrakten uændret.
    await expectMutation(
      supabase
        .from("riders")
        .update({
          team_id: bankTeam.id,
          pending_team_id: null,
          acquired_at: actualEnd,
          ...contractOnAcquirePatch(auction.rider, activeSeasonNumber),
        })
        .eq("id", auction.rider.id)
    );

    // #1906 defense-in-depth: rytteren forlod sælgeren (solgt til banken) — ryd hans
    // fremtidige race_entries så de ikke hænger ved som ghost og phantom-binder en ægte rytter.
    await clearFutureRaceEntriesSafe({ supabase, riderId: auction.rider.id, label: "auction_bank_sale" });

    // #776: guaranteed-sale til banken er også et salg — luk åbne
    // transfer_listings så rytteren ikke står som zombie-"til salg".
    await closeTransferListingsForRiders(supabase, [auction.rider.id], "sold");
    // #1748 (a): træk også åbne transfer-/swap-tilbud tilbage ved bank-salget.
    await withdrawOpenTransferDealsForRiders(supabase, [auction.rider.id]);

    // Slice 07c: balance + finance_transactions atomic via RPC.
    // 07d Fase B / #240: season_id eksplicit + idempotency_key per auction.
    await incrementBalanceWithAudit(supabase, {
      teamId: auction.seller_team_id,
      delta: salePrice,
      payload: {
        type: "transfer_in",
        amount: salePrice,
        description: `Garanteret AI-salg: ${auction.rider.firstname} ${auction.rider.lastname}`,
        metadata: {
          code: "tx.guaranteedAiSale",
          params: { riderName: `${auction.rider.firstname} ${auction.rider.lastname}` },
        },
        season_id: activeSeasonId,
        actor_type: FINANCE_ACTOR_TYPE.CRON,
        actor_id: null,
        source_path: "auctionFinalization.finalizeAuctionRecord.guaranteedBankSale",
        reason_code: FINANCE_REASON.AUCTION_GUARANTEED_BANK_SALE,
        related_entity_type: FINANCE_RELATED_ENTITY.AUCTION,
        related_entity_id: auction.id,
        idempotency_key: `auction_bank_sale:${auction.id}`,
      },
    }, { allowDuplicate: true });

    await notifyTeamOwner(
      auction.seller_team_id,
      "auction_won",
      "Rytter solgt til AI",
      `${auction.rider.firstname} ${auction.rider.lastname} er solgt til AI for ${salePrice} CZ$ (garanteret pris)`,
      auction.id,
      { riderId: auction.rider.id }
    );
  } else if (auction.seller_team_id) {
    await notifyTeamOwner(
      auction.seller_team_id,
      "auction_lost",
      "Auktion udløb uden bud",
      `Ingen bød på ${auction.rider.firstname} ${auction.rider.lastname}`,
      auction.id,
      { riderId: auction.rider.id }
    );
  }

  await closeAuction({
    supabase,
    auction,
    status: "completed",
    actualEnd,
    sellerOwned,
  });

  return {
    ok: true,
    code: auction.is_guaranteed_sale && sellerOwned && bankTeam ? "guaranteed_sale" : "no_bids",
    auction_id: auction.id,
    seller_owned: sellerOwned,
  };
}

export async function finalizeAuctionById({
  supabase,
  auctionId,
  notifyTeamOwner,
  discordNotify = NOOP,
  logActivity = NOOP,
  awardXP = NOOP,
  squadLimits = AUCTION_SQUAD_LIMITS,
  now = new Date(),
}) {
  const auction = await expectMaybeSingle(
    supabase
      .from("auctions")
      .select("*, rider:rider_id(*)")
      .eq("id", auctionId)
  );

  if (!auction) {
    return {
      ok: false,
      code: "not_found",
      auction_id: auctionId,
    };
  }

  return finalizeAuctionRecord({
    supabase,
    auction,
    notifyTeamOwner,
    discordNotify,
    logActivity,
    awardXP,
    squadLimits,
    now,
  });
}

export async function finalizeExpiredAuctions({
  supabase,
  notifyTeamOwner,
  discordNotify = NOOP,
  logActivity = NOOP,
  awardXP = NOOP,
  squadLimits = AUCTION_SQUAD_LIMITS,
  now = new Date(),
  onError = () => {},
}) {
  const { data: expired, error } = await supabase
    .from("auctions")
    .select("id")
    .in("status", FINALIZABLE_STATUSES)
    .lte("calculated_end", now.toISOString());

  ensureNoError(error);

  const results = [];

  for (const auction of expired || []) {
    try {
      results.push(await finalizeAuctionById({
        supabase,
        auctionId: auction.id,
        notifyTeamOwner,
        discordNotify,
        logActivity,
        awardXP,
        squadLimits,
        now,
      }));
    } catch (error) {
      onError({ auctionId: auction.id, error });
      results.push({
        ok: false,
        code: "error",
        auction_id: auction.id,
        error: error.message,
      });
    }
  }

  return results;
}
