import {
  closeTransferListingsForRiders,
  ensureNoError,
  expectMaybeSingle,
  expectMutation,
  getIncomingSquadViolation,
  getTeamMarketState,
  getTransferWindowOpen,
  MARKET_SQUAD_LIMITS,
  TRANSFER_WINDOW_SOFT_CAP_BUFFER,
} from "./marketUtils.js";
import { incrementBalanceWithAudit } from "./balanceRpc.js";
import { contractOnAcquirePatch } from "./contractSeed.js";
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
        auction.id
      );
    }

    if (auction.seller_team_id) {
      await notifyTeamOwner(
        auction.seller_team_id,
        "auction_lost",
        "Auktion annulleret",
        `${auction.rider.firstname} ${auction.rider.lastname} står ikke længere på dit hold. Auktionen blev derfor annulleret.`,
        auction.id
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
        `Du havde ikke råd til ${auction.rider.firstname} ${auction.rider.lastname}. Saldo: ${buyer?.balance || 0} pts`,
        auction.id
      );

      if (auction.seller_team_id) {
        await notifyTeamOwner(
          auction.seller_team_id,
          "auction_lost",
          "Auktion annulleret",
          `Køber manglede balance. ${auction.rider.firstname} ${auction.rider.lastname} blev ikke overdraget.`,
          auction.id
        );
      }

      return {
        ok: true,
        code: "cancelled_insufficient_balance",
        auction_id: auction.id,
      };
    }

    // #267: under åbent transfervindue må køber gå +2 over division-cap (D3
    // → 12, D2 → 22, D1 → 32). squadEnforcement-cron auto-sælger ned til
    // hard-cap når vinduet lukker og fakturerer fine + penalty per afvigende
    // rytter. Når vinduet allerede er lukket (post-cutoff) er hard-cap igen
    // gældende og finalize sender rytteren til pending_team_id.
    const windowOpen = await getTransferWindowOpen(supabase);
    const squadViolation = getIncomingSquadViolation(buyer, {
      softCapBuffer: windowOpen ? TRANSFER_WINDOW_SOFT_CAP_BUFFER : 0,
    });
    if (squadViolation) {
      await closeAuction({
        supabase,
        auction,
        status: "completed",
        actualEnd,
        sellerOwned,
      });

      const buyerMessage = windowOpen
        ? `Dit hold er fyldt (${squadViolation.effectiveCap} ryttere — Div ${buyer.division || 3} cap ${squadViolation.maxRiders} + ${squadViolation.softCapBuffer} buffer i transfervinduet). ${auction.rider.firstname} ${auction.rider.lastname} kunne ikke overdrages.`
        : `Dit hold (Div ${buyer.division || 3}) kan max have ${squadViolation.maxRiders} ryttere uden for transfervinduet. ${auction.rider.firstname} ${auction.rider.lastname} kunne ikke overdrages.`;

      await notifyTeamOwner(
        effectiveBidderId,
        "auction_lost",
        "Auktion annulleret — hold fuldt",
        buyerMessage,
        auction.id
      );

      if (auction.seller_team_id) {
        await notifyTeamOwner(
          auction.seller_team_id,
          "auction_lost",
          "Auktion annulleret",
          `${auction.rider.firstname} ${auction.rider.lastname} kunne ikke overdrages, fordi vinderens hold var fuldt.`,
          auction.id
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
    await expectMutation(
      supabase
        .from("riders")
        .update(
          windowOpen
            ? {
                team_id: effectiveBidderId,
                pending_team_id: null,
                acquired_at: actualEnd,
                ...winnerContractPatch,
              }
            : {
                pending_team_id: effectiveBidderId,
                ...winnerContractPatch,
              }
        )
        .eq("id", auction.rider.id)
    );

    // #822: rytteren er solgt — luk alle åbne transfer_listings så han ikke
    // står som zombie-"til salg" på transfermarkedet. Gælder også ved lukket
    // vindue (pending_team_id): salget er bindende og betalt, så et åbent
    // listing ville kunne dobbelt-sælge rytteren.
    await closeTransferListingsForRiders(supabase, [auction.rider.id], "sold");

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
      `${auction.rider.firstname} ${auction.rider.lastname} er nu på dit hold for ${price} pts`,
      auction.id
    );

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
          ? `${auction.rider.firstname} ${auction.rider.lastname} solgt for ${price} pts`
          : `${auction.rider.firstname} ${auction.rider.lastname} blev købt for ${price} pts`,
        auction.id
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

    // #776: guaranteed-sale til banken er også et salg — luk åbne
    // transfer_listings så rytteren ikke står som zombie-"til salg".
    await closeTransferListingsForRiders(supabase, [auction.rider.id], "sold");

    // Slice 07c: balance + finance_transactions atomic via RPC.
    // 07d Fase B / #240: season_id eksplicit + idempotency_key per auction.
    await incrementBalanceWithAudit(supabase, {
      teamId: auction.seller_team_id,
      delta: salePrice,
      payload: {
        type: "transfer_in",
        amount: salePrice,
        description: `Garanteret AI-salg: ${auction.rider.firstname} ${auction.rider.lastname}`,
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
      auction.id
    );
  } else if (auction.seller_team_id) {
    await notifyTeamOwner(
      auction.seller_team_id,
      "auction_lost",
      "Auktion udløb uden bud",
      `Ingen bød på ${auction.rider.firstname} ${auction.rider.lastname}`,
      auction.id
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
