/**
 * Deadline Day — planlagte advarsler + Final Whistle-rapport.
 *
 * Pure functions er testbare uden Supabase. `processDeadlineDayCron` er
 * cron-entrypoint og kalder Supabase + notifikations- og Discord-helpers
 * via injected functions for at gøre den enheds-testbar.
 */

export const SQUAD_MINS = { 1: 20, 2: 14, 3: 8 };

export const WARNING_STEPS = [
  { key: "24h", title: "Deadline Day om 24 timer", secondsBefore: 24 * 3600 },
  { key: "2h", title: "Deadline Day om 2 timer", secondsBefore: 2 * 3600 },
  { key: "30min", title: "Deadline Day om 30 minutter", secondsBefore: 30 * 60 },
];

export function getDueWarningSteps(closesAt, now = new Date()) {
  if (!closesAt) return [];
  const closesMs = new Date(closesAt).getTime();
  const nowMs = now.getTime();
  if (nowMs >= closesMs) return [];
  return WARNING_STEPS.filter(step => nowMs >= closesMs - step.secondsBefore * 1000);
}

export function buildWarningPayload(step, closesAt) {
  const closeLabel = new Date(closesAt).toLocaleString("da-DK");
  const messages = {
    "24h": `Transfervinduet lukker om 24 timer (${closeLabel}). Sidste chance for at sætte ryttere på auktion eller acceptere tilbud.`,
    "2h": `Transfervinduet lukker om 2 timer (${closeLabel}). Flash-auktioner og hastebud er aktive.`,
    "30min": `Sidste chance — transfervinduet lukker om 30 minutter (${closeLabel}).`,
  };
  return {
    type: "deadline_day_warning",
    title: step.title,
    message: messages[step.key],
    metadata: {
      titleCode: `notif.deadlineDay.${step.key}.title`,
      titleParams: {},
      messageCode: `notif.deadlineDay.${step.key}.message`,
      messageParams: { closesAt },
    },
  };
}

export function computeFinalWhistleReport({
  auctionDeals = [],
  transferDeals = [],
  bids = [],
  panicTeamIds = new Set(),
}) {
  const auctionRows = auctionDeals.map(a => ({
    kind: "auction",
    amount: a.amount,
    riderName: a.riderName,
    sellerName: a.sellerName,
    buyerName: a.buyerName,
    sellerTeamId: a.sellerTeamId,
  }));
  const transferRows = transferDeals.map(t => ({
    kind: "transfer",
    amount: t.amount,
    riderName: t.riderName,
    sellerName: t.sellerName,
    buyerName: t.buyerName,
    sellerTeamId: t.sellerTeamId,
  }));
  const allDeals = [...auctionRows, ...transferRows];

  const pickBiggest = rows => (rows.length
    ? [...rows].sort((a, b) => b.amount - a.amount)[0]
    : null);

  const biggestAuction = pickBiggest(auctionRows);
  const biggestTransfer = pickBiggest(transferRows);

  const bidCounts = new Map();
  for (const bid of bids) {
    if (!bid.teamName) continue;
    bidCounts.set(bid.teamName, (bidCounts.get(bid.teamName) || 0) + 1);
  }
  let mostActiveManager = null;
  for (const [teamName, count] of bidCounts) {
    if (!mostActiveManager || count > mostActiveManager.bidCount) {
      mostActiveManager = { teamName, bidCount: count };
    }
  }

  // Panik kræver seller-hold. Ai-pool auctions (sellerTeamId=null) er pr.
  // definition ikke panik (ingen manager har solgt sig under min).
  const panicDeals = allDeals.filter(d => d.sellerTeamId && panicTeamIds.has(d.sellerTeamId));

  const totalSpent = allDeals.reduce((sum, d) => sum + (d.amount || 0), 0);

  return {
    totalDeals: allDeals.length,
    totalAuctions: auctionRows.length,
    totalTransfers: transferRows.length,
    totalSpent,
    biggestAuction,
    biggestTransfer,
    mostActiveManager,
    panicCount: panicDeals.length,
    panicSamples: panicDeals.slice(0, 3),
  };
}

// #2520: spillervendt Discord-embed på engelsk (server er EN-first).
export function formatFinalWhistleEmbed({ report, seasonNumber, closedAt }) {
  const fmtCz = n => `${Math.round((n || 0) / 1000).toLocaleString("en-US")}K CZ$`;
  const dealsLabel = report.totalAuctions != null && report.totalTransfers != null
    ? `${report.totalDeals} (${report.totalAuctions} auctions · ${report.totalTransfers} transfers)`
    : String(report.totalDeals);
  const fields = [
    { name: "Total deals", value: dealsLabel, inline: true },
    { name: "Volume", value: fmtCz(report.totalSpent), inline: true },
    { name: "Panic deals", value: String(report.panicCount), inline: true },
  ];

  if (report.biggestAuction) {
    const a = report.biggestAuction;
    const sellerLabel = a.sellerName && a.sellerName !== "–" ? a.sellerName : "free pool";
    fields.push({
      name: "🏆 Biggest auction",
      value: `${a.riderName} (${sellerLabel} → ${a.buyerName ?? "–"}, ${fmtCz(a.amount)})`,
      inline: false,
    });
  }
  if (report.biggestTransfer) {
    const t = report.biggestTransfer;
    fields.push({
      name: "💸 Biggest transfer",
      value: `${t.riderName} (${t.sellerName ?? "–"} → ${t.buyerName ?? "–"}, ${fmtCz(t.amount)})`,
      inline: false,
    });
  }
  if (report.mostActiveManager) {
    fields.push({
      name: "🔥 Most active manager",
      value: `${report.mostActiveManager.teamName} with ${report.mostActiveManager.bidCount} bids`,
      inline: false,
    });
  }
  if (report.panicSamples.length) {
    fields.push({
      name: "🚨 Panic deals",
      value: report.panicSamples
        .map(d => `${d.riderName} (${d.sellerName} → ${d.buyerName ?? "–"}, ${fmtCz(d.amount)})`)
        .join("\n"),
      inline: false,
    });
  }

  const seasonLabel = seasonNumber ? `Season ${seasonNumber}` : "Season";
  return {
    embeds: [{
      title: `🏁 Final Whistle · ${seasonLabel}`,
      description: report.totalDeals
        ? "The transfer window has closed. Here's the Deadline Day summary:"
        : "The transfer window has closed. No deals were completed.",
      color: 0xff6b35,
      fields,
      footer: { text: "Cycling Zone — Deadline Day" },
      timestamp: closedAt || new Date().toISOString(),
    }],
  };
}

// ── Effectful entry-point ────────────────────────────────────────────────────

export async function loadFinalWhistleData({ supabase, window }) {
  const since = window.created_at;
  const until = window.closes_at || new Date().toISOString();

  const [{ data: auctions }, { data: transfers }, { data: bids }] = await Promise.all([
    supabase
      .from("auctions")
      .select("id, current_price, actual_end, seller_team_id, winner:current_bidder_id(id, name), seller:seller_team_id(id, name), rider:rider_id(firstname, lastname)")
      .eq("status", "completed")
      .gte("actual_end", since)
      .lte("actual_end", until),
    supabase
      .from("transfer_offers")
      .select("id, offer_amount, updated_at, seller_team_id, buyer:buyer_team_id(id, name), seller:seller_team_id(id, name), rider:rider_id(firstname, lastname)")
      .eq("status", "accepted")
      .gte("updated_at", since)
      .lte("updated_at", until),
    supabase
      .from("auction_bids")
      .select("team_id, bid_time, team:team_id(name)")
      .gte("bid_time", since)
      .lte("bid_time", until),
  ]);

  // Auctions inkluderer både manager-til-manager OG ai-pool/fri-agent køb.
  // Ai-pool deals har seller_team_id=null → sellerName falder tilbage til "fri pulje"
  // i embed-formatter. Panik-flag kræver stadig seller_team_id (en manager der har solgt
  // sig under min), så ai-pool auctions kan aldrig være panik.
  const auctionDeals = (auctions || [])
    .filter(a => a.winner && a.rider)
    .map(a => ({
      amount: a.current_price,
      riderName: `${a.rider.firstname} ${a.rider.lastname}`,
      sellerName: a.seller?.name || "–",
      buyerName: a.winner?.name || "–",
      sellerTeamId: a.seller_team_id,
    }));
  const transferDeals = (transfers || [])
    .filter(t => t.rider && t.seller_team_id && t.buyer)
    .map(t => ({
      amount: t.offer_amount,
      riderName: `${t.rider.firstname} ${t.rider.lastname}`,
      sellerName: t.seller?.name || "–",
      buyerName: t.buyer?.name || "–",
      sellerTeamId: t.seller_team_id,
    }));
  const bidsForReport = (bids || []).map(b => ({ teamName: b.team?.name }));

  // Filter null sellers (ai-pool auctions). Panic-lookup kræver et faktisk sælger-hold.
  const sellerIds = [
    ...new Set([
      ...auctionDeals.map(d => d.sellerTeamId),
      ...transferDeals.map(d => d.sellerTeamId),
    ].filter(id => id != null)),
  ];
  const panicTeamIds = new Set();
  if (sellerIds.length) {
    const [{ data: sellerTeams }, { data: sellerRiders }] = await Promise.all([
      supabase.from("teams").select("id, division").in("id", sellerIds),
      supabase.from("riders").select("team_id").in("team_id", sellerIds),
    ]);
    const teamDiv = Object.fromEntries((sellerTeams || []).map(t => [t.id, t.division]));
    const riderCounts = {};
    for (const r of (sellerRiders || [])) {
      riderCounts[r.team_id] = (riderCounts[r.team_id] || 0) + 1;
    }
    for (const teamId of sellerIds) {
      const min = SQUAD_MINS[teamDiv[teamId]];
      if (min != null && (riderCounts[teamId] || 0) <= min) {
        panicTeamIds.add(teamId);
      }
    }
  }

  return { auctionDeals, transferDeals, bids: bidsForReport, panicTeamIds };
}

// ── Auto-close: flip status open → closed når closes_at er passeret ─────────
// Sikkerhedsnet så vinduet rammer deadline præcist selv hvis admin sover.
// Atomic claim: kun UPDATE hvis row stadig er open (race-safe mod manuel close).
export async function fireAutoCloseIfDue({ supabase, window, now }) {
  if (!window) return { autoClosed: false };
  if (window.status !== "open") return { autoClosed: false };
  if (!window.closes_at) return { autoClosed: false };

  const closesMs = new Date(window.closes_at).getTime();
  if (closesMs > now.getTime()) return { autoClosed: false };

  const nowIso = now.toISOString();
  const { data: claimed, error } = await supabase
    .from("transfer_windows")
    .update({ status: "closed", closed_at: nowIso })
    .eq("id", window.id)
    .eq("status", "open")
    .select("id");
  if (error) throw error;
  if (!claimed?.length) return { autoClosed: false };

  return { autoClosed: true, windowId: window.id, closedAt: nowIso };
}

async function fireDeadlineWarnings({ supabase, window, notifyTeamOwnerFn, captureExceptionFn, now }) {
  const dueSteps = getDueWarningSteps(window.closes_at, now);
  if (!dueSteps.length) return { warnings: 0, errors: 0 };

  const { data: teams } = await supabase
    .from("teams")
    .select("id")
    .eq("is_bank", false)
    .eq("is_ai", false)
    .eq("is_frozen", false)
    .not("user_id", "is", null);

  if (!teams?.length) return { warnings: 0, errors: 0 };

  let sent = 0;
  let errors = 0;
  for (const step of dueSteps) {
    const payload = buildWarningPayload(step, window.closes_at);
    for (const team of teams) {
      try {
        const result = await notifyTeamOwnerFn({
          teamId: team.id,
          type: payload.type,
          title: payload.title,
          message: payload.message,
          metadata: payload.metadata,
          relatedId: window.id,
          now,
        });
        if (result?.delivered) sent += 1;
      } catch (err) {
        errors += 1;
        console.error(`  ❌ deadline warning failed for team ${team.id}:`, err.message);
        if (captureExceptionFn) {
          captureExceptionFn(err, {
            tags: { cron: "deadline-day-warning" },
            extra: { teamId: team.id, windowId: window.id, step: step.key },
          });
        }
      }
    }
  }
  return { warnings: sent, errors };
}

async function fireFinalWhistle({ supabase, window, sendDiscordWebhookFn, getDefaultWebhookFn, now }) {
  const nowIso = now.toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("transfer_windows")
    .update({ final_whistle_sent_at: nowIso })
    .eq("id", window.id)
    .is("final_whistle_sent_at", null)
    .select("id, season_id");
  if (claimError) throw claimError;
  if (!claimed?.length) return { whistleSent: false };

  const { auctionDeals, transferDeals, bids, panicTeamIds } = await loadFinalWhistleData({ supabase, window });
  const report = computeFinalWhistleReport({ auctionDeals, transferDeals, bids, panicTeamIds });

  let seasonNumber = null;
  if (window.season_id) {
    const { data: season } = await supabase.from("seasons").select("number").eq("id", window.season_id).single();
    seasonNumber = season?.number ?? null;
  }

  const webhookUrl = await getDefaultWebhookFn();
  if (webhookUrl) {
    const payload = formatFinalWhistleEmbed({
      report,
      seasonNumber,
      closedAt: window.closes_at || nowIso,
    });
    await sendDiscordWebhookFn(webhookUrl, payload);
  }

  return { whistleSent: true, report };
}

export async function processDeadlineDayCron({
  supabase,
  notifyTeamOwnerFn,
  sendDiscordWebhookFn,
  getDefaultWebhookFn,
  captureExceptionFn,
  now = new Date(),
}) {
  const { data: window } = await supabase
    .from("transfer_windows")
    .select("id, season_id, status, closes_at, closed_at, created_at, final_whistle_sent_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!window) return { warnings: 0, errors: 0, whistleSent: false, autoClosed: false };

  // Racing-windows (oprettet via transitionToNextSeason med status='closed' men
  // closes_at=null + closed_at=null) er aldrig en "deadline day" — markedet var
  // aldrig åbent på dem. Spring helt over så fireFinalWhistle ikke claimer dem og
  // dermed bidrager til sæson-loop-bug'en (rettet 2026-05-21).
  //
  // Lag 1 (kode-filter) i 3-lags forsvar-i-dybden mod racing-windows: denne guard +
  // DB CHECK (2026-05-22-transfer-window-racing-guard.sql, strukturelt — final_whistle
  // kræver closed_at) + kilde-guard i admin-close-endpoint'et (#544: sætter altid
  // closed_at). Se seasonAutoTransition.js for fuld kæde-beskrivelse.
  if (!window.closes_at && !window.closed_at) {
    return { warnings: 0, errors: 0, whistleSent: false, autoClosed: false };
  }

  let warnings = 0;
  let errors = 0;
  let whistleSent = false;

  // 1. Auto-close hvis closes_at er passeret — sikrer Final Whistle kan fyre samme tick.
  const autoCloseResult = await fireAutoCloseIfDue({ supabase, window, now });
  if (autoCloseResult.autoClosed) {
    window.status = "closed";
    window.closed_at = autoCloseResult.closedAt;
  }

  if (window.status === "open" && window.closes_at) {
    const result = await fireDeadlineWarnings({ supabase, window, notifyTeamOwnerFn, captureExceptionFn, now });
    warnings = result.warnings;
    errors = result.errors;
  }

  if (window.status === "closed" && !window.final_whistle_sent_at) {
    const result = await fireFinalWhistle({ supabase, window, sendDiscordWebhookFn, getDefaultWebhookFn, now });
    whistleSent = result.whistleSent;
  }

  return { warnings, errors, whistleSent, autoClosed: autoCloseResult.autoClosed };
}
