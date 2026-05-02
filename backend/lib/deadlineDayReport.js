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
  };
}

export function computeFinalWhistleReport({
  auctionDeals = [],
  transferDeals = [],
  bids = [],
  panicTeamIds = new Set(),
}) {
  const allDeals = [
    ...auctionDeals.map(a => ({
      kind: "auction",
      amount: a.amount,
      riderName: a.riderName,
      sellerName: a.sellerName,
      buyerName: a.buyerName,
      sellerTeamId: a.sellerTeamId,
    })),
    ...transferDeals.map(t => ({
      kind: "transfer",
      amount: t.amount,
      riderName: t.riderName,
      sellerName: t.sellerName,
      buyerName: t.buyerName,
      sellerTeamId: t.sellerTeamId,
    })),
  ];

  const biggestDeal = allDeals.length
    ? [...allDeals].sort((a, b) => b.amount - a.amount)[0]
    : null;

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

  const panicDeals = allDeals.filter(d => d.sellerTeamId && panicTeamIds.has(d.sellerTeamId));

  const totalSpent = allDeals.reduce((sum, d) => sum + (d.amount || 0), 0);

  return {
    totalDeals: allDeals.length,
    totalSpent,
    biggestDeal,
    mostActiveManager,
    panicCount: panicDeals.length,
    panicSamples: panicDeals.slice(0, 3),
  };
}

export function formatFinalWhistleEmbed({ report, seasonNumber, closedAt }) {
  const fmtCz = n => `${Math.round((n || 0) / 1000).toLocaleString("da-DK")}K CZ$`;
  const fields = [
    { name: "Handler i alt", value: String(report.totalDeals), inline: true },
    { name: "Volumen", value: fmtCz(report.totalSpent), inline: true },
    { name: "Panikhandler", value: String(report.panicCount), inline: true },
  ];

  if (report.biggestDeal) {
    const d = report.biggestDeal;
    const route = d.kind === "auction" ? "auktion" : "transfer";
    fields.push({
      name: "🏆 Største handel",
      value: `${d.riderName} → ${d.buyerName ?? "–"} (${fmtCz(d.amount)} via ${route})`,
      inline: false,
    });
  }
  if (report.mostActiveManager) {
    fields.push({
      name: "🔥 Mest aktive manager",
      value: `${report.mostActiveManager.teamName} med ${report.mostActiveManager.bidCount} bud`,
      inline: false,
    });
  }
  if (report.panicSamples.length) {
    fields.push({
      name: "🚨 Panikhandler",
      value: report.panicSamples
        .map(d => `${d.riderName} (${d.sellerName} → ${d.buyerName ?? "–"}, ${fmtCz(d.amount)})`)
        .join("\n"),
      inline: false,
    });
  }

  const seasonLabel = seasonNumber ? `Sæson ${seasonNumber}` : "Sæson";
  return {
    embeds: [{
      title: `🏁 Final Whistle — ${seasonLabel}`,
      description: report.totalDeals
        ? "Transfervinduet er lukket. Her er opsummeringen af Deadline Day:"
        : "Transfervinduet er lukket. Ingen handler blev gennemført.",
      color: 0xff6b35,
      fields,
      footer: { text: "Cycling Zone — Deadline Day" },
      timestamp: closedAt || new Date().toISOString(),
    }],
  };
}

// ── Effectful entry-point ────────────────────────────────────────────────────

async function loadFinalWhistleData({ supabase, window }) {
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

  const auctionDeals = (auctions || [])
    .filter(a => a.winner && a.rider && a.seller_team_id)
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

  const sellerIds = [
    ...new Set([
      ...auctionDeals.map(d => d.sellerTeamId),
      ...transferDeals.map(d => d.sellerTeamId),
    ]),
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

async function fireDeadlineWarnings({ supabase, window, notifyTeamOwnerFn, now }) {
  const dueSteps = getDueWarningSteps(window.closes_at, now);
  if (!dueSteps.length) return { warnings: 0 };

  const { data: teams } = await supabase
    .from("teams")
    .select("id")
    .eq("is_bank", false)
    .eq("is_ai", false)
    .not("user_id", "is", null);

  if (!teams?.length) return { warnings: 0 };

  let sent = 0;
  for (const step of dueSteps) {
    const payload = buildWarningPayload(step, window.closes_at);
    for (const team of teams) {
      const result = await notifyTeamOwnerFn({
        teamId: team.id,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        relatedId: window.id,
        now,
      });
      if (result?.delivered) sent += 1;
    }
  }
  return { warnings: sent };
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
    const { data: season } = await supabase.from("seasons").select("season_number").eq("id", window.season_id).single();
    seasonNumber = season?.season_number ?? null;
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
  now = new Date(),
}) {
  const { data: window } = await supabase
    .from("transfer_windows")
    .select("id, season_id, status, closes_at, created_at, final_whistle_sent_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!window) return { warnings: 0, whistleSent: false };

  let warnings = 0;
  let whistleSent = false;

  if (window.status === "open" && window.closes_at) {
    const result = await fireDeadlineWarnings({ supabase, window, notifyTeamOwnerFn, now });
    warnings = result.warnings;
  }

  if (window.status === "closed" && !window.final_whistle_sent_at) {
    const result = await fireFinalWhistle({ supabase, window, sendDiscordWebhookFn, getDefaultWebhookFn, now });
    whistleSent = result.whistleSent;
  }

  return { warnings, whistleSent };
}
