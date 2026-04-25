import {
  calculateMarketSalary,
  ensureNoError,
  expectMaybeSingle,
  expectMutation,
  expectSingle,
  getIncomingSquadViolation,
  getTeamMarketState,
  getTransferWindowOpen,
  MARKET_SQUAD_LIMITS,
} from "./marketUtils.js";

export const AUCTION_SQUAD_LIMITS = MARKET_SQUAD_LIMITS;

const FINALIZABLE_STATUSES = ["active", "extended"];
const NOOP = async () => {};

export function sellerOwnsAuctionRider(auction) {
  return Boolean(auction?.rider && auction.rider.team_id === auction.seller_team_id);
}

export function calculateAuctionSalary(price, prizeBonus = 0) {
  return calculateMarketSalary(price, prizeBonus);
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
}) {
  await expectMutation(
    supabase
      .from("auctions")
      .update({
        status,
        actual_end: actualEnd,
        seller_team_id: getHistorySellerTeamId(auction, sellerOwned),
      })
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
  const {
    sellerOwned,
    actualSellerTeamId,
    actualSeller,
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

  if (auction.current_bidder_id) {
    const price = auction.current_price;
    const baseBuyerState = await getTeamMarketState(supabase, auction.current_bidder_id);
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
        auction.current_bidder_id,
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

    const squadViolation = getIncomingSquadViolation(buyer);
    if (squadViolation) {
      await closeAuction({
        supabase,
        auction,
        status: "completed",
        actualEnd,
        sellerOwned,
      });

      await notifyTeamOwner(
        auction.current_bidder_id,
        "auction_lost",
        "Auktion annulleret — hold fuldt",
        `Dit hold (Div ${buyer.division || 3}) kan max have ${squadViolation.maxRiders} ryttere. ${auction.rider.firstname} ${auction.rider.lastname} kunne ikke overdrages.`,
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

    const windowOpen = await getTransferWindowOpen(supabase);

    await expectMutation(
      supabase
        .from("riders")
        .update(
          windowOpen
            ? {
                team_id: auction.current_bidder_id,
                pending_team_id: null,
                salary: calculateAuctionSalary(price, auction.rider.prize_earnings_bonus || 0),
              }
            : {
                pending_team_id: auction.current_bidder_id,
                salary: calculateAuctionSalary(price, auction.rider.prize_earnings_bonus || 0),
              }
        )
        .eq("id", auction.rider.id)
    );

    await expectMutation(
      supabase
        .from("teams")
        .update({ balance: buyer.balance - price })
        .eq("id", auction.current_bidder_id)
    );

    const financeRows = [
      {
        team_id: auction.current_bidder_id,
        type: "transfer_out",
        amount: -price,
        description: `Købt ${auction.rider.firstname} ${auction.rider.lastname} på auktion`,
      },
    ];

    if (actualSellerTeamId) {
      const seller = actualSellerTeamId === auction.seller_team_id && sellerOwned
        ? await expectSingle(
            supabase
              .from("teams")
              .select("balance")
              .eq("id", auction.seller_team_id)
          )
        : actualSeller;

      await expectMutation(
        supabase
          .from("teams")
          .update({ balance: seller.balance + price })
          .eq("id", actualSellerTeamId)
      );

      financeRows.push({
        team_id: actualSellerTeamId,
        type: "transfer_in",
        amount: price,
        description: `Solgt ${auction.rider.firstname} ${auction.rider.lastname} på auktion`,
      });
    }

    await expectMutation(
      supabase.from("finance_transactions").insert(financeRows)
    );

    await awardXP(auction.current_bidder_id, "auction_won");
    if (sellerOwned) {
      await awardXP(auction.seller_team_id, "auction_sold");
    }

    await notifyTeamOwner(
      auction.current_bidder_id,
      "auction_won",
      "Du vandt auktionen! 🎉",
      `${auction.rider.firstname} ${auction.rider.lastname} er nu på dit hold for ${price} pts`,
      auction.id
    );

    discordNotify({
      riderName: `${auction.rider.firstname} ${auction.rider.lastname}`,
      finalPrice: price,
      teamId: auction.current_bidder_id,
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
      team_id: auction.current_bidder_id,
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

    await expectMutation(
      supabase
        .from("riders")
        .update({
          team_id: bankTeam.id,
          pending_team_id: null,
          salary: 0,
        })
        .eq("id", auction.rider.id)
    );

    const seller = await expectSingle(
      supabase
        .from("teams")
        .select("balance")
        .eq("id", auction.seller_team_id)
    );

    await expectMutation(
      supabase
        .from("teams")
        .update({ balance: seller.balance + salePrice })
        .eq("id", auction.seller_team_id)
    );

    await expectMutation(
      supabase.from("finance_transactions").insert({
        team_id: auction.seller_team_id,
        type: "transfer_in",
        amount: salePrice,
        description: `Garanteret banksalg: ${auction.rider.firstname} ${auction.rider.lastname}`,
      })
    );

    await notifyTeamOwner(
      auction.seller_team_id,
      "auction_won",
      "Rytter solgt til banken",
      `${auction.rider.firstname} ${auction.rider.lastname} er solgt til Banken for ${salePrice} CZ$ (garanteret pris)`,
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
