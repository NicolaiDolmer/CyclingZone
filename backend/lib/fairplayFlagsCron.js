// #3138 (fair-play epic #3131) — dagligt scoring-sweep: henter detektorernes
// datagrundlag (READ-ONLY), kombinerer signalerne via fairplayScoring.js og
// skriver mistænkte hændelser til fairplay_flags (upsert på dedup-nøglen, så
// samme hændelse aldrig dublerer). RENT analyse-lag: ingen håndhævelse, ingen
// spilbare ændringer — ejeren reviewer flagene i /admin/fairplay.
//
// Aktiverings-gate: fairplay_flags-tabellens eksistens. Mangler migrationen
// (database/2026-08-06-3138-fairplay-flags.sql) prober sweepet sig frem og
// skipper roligt med log — intet crash, ingen Sentry-støj. Whitelist-tabellen
// (#3135) tolereres ligeledes som fraværende (tom liste + note i rapporten).
//
// Datalogikken spejler de shippede detektor-queries 1:1 hvor muligt:
//   scripts/fairplay/3135-identity-pair-correlation.sql  (identitet + værdistrøm)
//   scripts/fairplay/3136-*.sql / #3231                  (kalibreret prisbånd)
//   scripts/fairplay/3137-signal{1,3,5,6}-*.sql          (livscyklus)
// Kendte, arvede begrænsninger (dokumenteret i audits): base_value/market_value
// er NUTIDIGE værdier (ingen historisk snapshot), og level/xp/login_streak er
// nutidige proxies for aktivitet på handelstidspunktet.

import {
  FAIRPLAY_DEFAULTS,
  computeAccountAgeStrength,
  computeActivityStrength,
  computeLoanFunnelStrength,
  computePriceOutlierStrength,
  scoreFunnelIncident,
  scorePairIncident,
} from "./fairplayScoring.js";

// ── Engangs-maildomæner (signal 5) ──────────────────────────────────────────
// Kerneliste-uddrag fra scripts/fairplay/3137-signal5-disposable-email-domains.sql
// (de 3 domæner bekræftet i brugerbasen + de mest udbredte udbydere) plus
// samme regex-heuristik som SQL-filen. Bevidst lavt cappet styrke (0.55/0.30)
// — temp-mail alene er lovligt; signalet bærer kun i kombination.
export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "gwshare.com", "yopmail.com", "atomicmail.io",
  "mailinator.com", "mailinator.net", "guerrillamail.com", "guerrillamail.net",
  "sharklasers.com", "10minutemail.com", "20minutemail.com", "trashmail.com",
  "dispostable.com", "maildrop.cc", "getnada.com", "moakt.com", "temp-mail.org",
  "tempmail.com", "throwawaymail.com", "fakeinbox.com", "mytemp.email",
]);
const DISPOSABLE_PATTERN = /(temp|trash|fake|disposable|burner|guerrilla|throwaway|mailinator|minute|discard|dropmail|maildrop|getnada|moakt|yopmail|nospam|10min|20min)/i;

export function disposableEmailStrength(email) {
  const domain = String(email ?? "").split("@")[1]?.toLowerCase();
  if (!domain) return 0;
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return 0.55;
  if (DISPOSABLE_PATTERN.test(domain)) return 0.3;
  return 0;
}

// ── Små hjælpere ────────────────────────────────────────────────────────────

// Supabase returnerer max 1000 rækker pr. kald — side igennem til bunden, så
// en voksende identity_events/auktions-historik aldrig trunkeres tavst.
export async function fetchAllRows(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

// Samme normalisering som 3135-SQL'en: lower-case, tal-suffiks strippet,
// min. 4 tegn (jcarey071/jcarey983 → "jcarey").
export function normalizeHandle(value) {
  const norm = String(value ?? "").toLowerCase().replace(/[0-9]+$/, "");
  return norm.length >= 4 ? norm : null;
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const hoursBetween = (a, b) => Math.abs(new Date(a) - new Date(b)) / 3_600_000;
const daysBetween = (a, b) => (new Date(a) - new Date(b)) / 86_400_000;

function isMissingTableError(error) {
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /does not exist|schema cache/i.test(error?.message ?? "")
  );
}

// ── Identitetsprofiler (spejler 3135-SQL'ens CTE'er) ────────────────────────

export function buildIdentityProfiles({ users, identityEvents, signupAttribution }) {
  // Fan-out pr. ip/prefix på tværs af HELE historikken — en IP tæller kun som
  // signal når højst 2 forskellige brugere nogensinde har brugt den ("privat"
  // for netop dette par; CGNAT-lektien fra 3135-auditten).
  const ipUsers = new Map();
  const prefixUsers = new Map();
  for (const ev of identityEvents) {
    if (ev.ip) {
      if (!ipUsers.has(ev.ip)) ipUsers.set(ev.ip, new Set());
      ipUsers.get(ev.ip).add(ev.user_id);
    }
    if (ev.ip_prefix) {
      if (!prefixUsers.has(ev.ip_prefix)) prefixUsers.set(ev.ip_prefix, new Set());
      prefixUsers.get(ev.ip_prefix).add(ev.user_id);
    }
  }

  const attributionByUser = new Map(signupAttribution.map((r) => [r.user_id, r.first_seen_at]));
  // identity_events.first_seen_at er kun fallback (tabellen er ung, #3132) —
  // signup_attribution rækker tilbage til april og er PRIMÆR kilde.
  const fallbackFirstSeen = new Map();
  for (const ev of identityEvents) {
    if (ev.event_type === "signup" && ev.first_seen_at && !fallbackFirstSeen.has(ev.user_id)) {
      fallbackFirstSeen.set(ev.user_id, ev.first_seen_at);
    }
  }

  const profiles = new Map();
  for (const u of users) {
    profiles.set(u.id, {
      userId: u.id,
      createdAt: u.created_at,
      emailNorm: normalizeHandle(String(u.email ?? "").split("@")[0]),
      usernameNorm: normalizeHandle(u.username),
      firstSeenAt: String(attributionByUser.get(u.id) ?? fallbackFirstSeen.get(u.id) ?? "") || null,
      disposableEmail: disposableEmailStrength(u.email),
      activity: { level: u.level, xp: u.xp, loginStreak: u.login_streak },
      lowFanoutIps: new Set(),
      lowFanoutPrefixes: new Set(),
    });
  }
  for (const ev of identityEvents) {
    const p = profiles.get(ev.user_id);
    if (!p) continue;
    if (ev.ip && ipUsers.get(ev.ip).size <= 2) p.lowFanoutIps.add(ev.ip);
    if (ev.ip_prefix && prefixUsers.get(ev.ip_prefix).size <= 2) p.lowFanoutPrefixes.add(ev.ip_prefix);
  }
  return profiles;
}

const setsIntersect = (a, b) => {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of small) if (large.has(v)) return true;
  return false;
};

export function computePairIdentitySignals(pa, pb) {
  if (!pa || !pb) return {};
  return {
    ip_exact_low_fanout: setsIntersect(pa.lowFanoutIps, pb.lowFanoutIps),
    ip_prefix_low_fanout: setsIntersect(pa.lowFanoutPrefixes, pb.lowFanoutPrefixes),
    first_seen_at_match: Boolean(pa.firstSeenAt && pa.firstSeenAt === pb.firstSeenAt),
    signup_proximity: hoursBetween(pa.createdAt, pb.createdAt) <= 0.25, // ≤15 min
    email_username_similarity: Boolean(
      (pa.emailNorm && pa.emailNorm === pb.emailNorm) ||
        (pa.usernameNorm && pa.usernameNorm === pb.usernameNorm)
    ),
  };
}

// ── Transaktions-normalisering (spejler 3135-SQL'ens tx-CTE) ────────────────
// flowToRecipient = værdi der flyttede til modtageren UDOVER prisen betalt.
// cashPaid = kontantbeløbet der skiftede hænder (tragt-gatens mål).

export function normalizeTransactions({ transfers, auctions, swaps }) {
  const txs = [];
  for (const t of transfers) {
    const seller = t.listing?.seller_team_id;
    const rider = t.listing?.rider;
    if (!seller || !t.buyer_team_id || seller === t.buyer_team_id) continue;
    const price = t.counter_amount ?? t.offer_amount;
    txs.push({
      type: "transfer",
      at: t.updated_at ?? t.created_at,
      fromTeam: seller,
      toTeam: t.buyer_team_id,
      price,
      riderValue: rider?.base_value ?? 1000,
      marketValue: rider?.market_value,
      riderName: rider ? `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim() : null,
      flowToRecipient: (rider?.base_value ?? 1000) - price,
      cashPaid: price,
    });
  }
  for (const a of auctions) {
    if (!a.seller_team_id || !a.current_bidder_id || a.seller_team_id === a.current_bidder_id) continue;
    txs.push({
      type: "auction",
      at: a.actual_end,
      fromTeam: a.seller_team_id,
      toTeam: a.current_bidder_id,
      price: a.current_price,
      riderValue: a.rider?.base_value ?? 1000,
      marketValue: a.rider?.market_value,
      riderName: a.rider ? `${a.rider.firstname ?? ""} ${a.rider.lastname ?? ""}`.trim() : null,
      flowToRecipient: (a.rider?.base_value ?? 1000) - a.current_price,
      cashPaid: a.current_price,
    });
  }
  for (const s of swaps) {
    if (!s.proposing_team_id || !s.receiving_team_id || s.proposing_team_id === s.receiving_team_id) continue;
    const cash = s.counter_cash ?? s.cash_adjustment ?? 0;
    const offered = s.offered?.base_value ?? 1000;
    const requested = s.requested?.base_value ?? 1000;
    txs.push({
      type: "swap",
      at: s.updated_at ?? s.created_at,
      fromTeam: s.receiving_team_id, // afgiver den efterspurgte rytter
      toTeam: s.proposing_team_id,
      price: cash,
      riderValue: requested,
      marketValue: s.requested?.market_value,
      riderName: s.requested ? `${s.requested.firstname ?? ""} ${s.requested.lastname ?? ""}`.trim() : null,
      flowToRecipient: requested - offered - cash,
      cashPaid: Math.abs(cash),
      // begge swap-ben pris-tjekkes, samme model som transferPriceBand:
      swapLegRatios:
        s.offered?.market_value > 0 && s.requested?.market_value > 0
          ? [
              ((s.offered?.market_value ?? 0) + cash) / s.requested.market_value,
              ((s.requested?.market_value ?? 0) - cash) / s.offered.market_value,
            ]
          : [],
    });
  }
  return txs;
}

// ── Rapport-bygning (ren funktion — unit-testes uden supabase) ──────────────

export function buildFairplayReport({
  teams,
  users,
  identityEvents = [],
  signupAttribution = [],
  transfers = [],
  auctions = [],
  swaps = [],
  loans = [],
  whitelistPairs = [],
  config = FAIRPLAY_DEFAULTS,
  now = new Date(),
}) {
  // Population: kun rigtige spillerhold — samme filter som UI'et og
  // detektorerne (is_ai/is_bank/is_test_account + ejerens @cyclingzone.dev).
  const userById = new Map(users.map((u) => [u.id, u]));
  const humanTeams = new Map();
  for (const t of teams) {
    if (t.is_ai || t.is_bank || t.is_test_account) continue;
    const u = userById.get(t.user_id);
    if (!u || /@cyclingzone\.dev$/i.test(u.email ?? "")) continue;
    humanTeams.set(t.id, { ...t, user: u });
  }

  const profiles = buildIdentityProfiles({
    users: [...humanTeams.values()].map((t) => t.user),
    identityEvents,
    signupAttribution,
  });

  const whitelisted = new Set(whitelistPairs.map((w) => pairKey(w.team_id_lo, w.team_id_hi)));

  const txs = normalizeTransactions({ transfers, auctions, swaps }).filter(
    (tx) => humanTeams.has(tx.fromTeam) && humanTeams.has(tx.toTeam)
  );

  // Lån pr. hold (til signal 3) — sorteret er unødvendigt ved disse volumener.
  const loansByTeam = new Map();
  for (const l of loans) {
    if (!loansByTeam.has(l.team_id)) loansByTeam.set(l.team_id, []);
    loansByTeam.get(l.team_id).push(l);
  }

  // Gruppér pr. par
  const pairs = new Map();
  for (const tx of txs) {
    const key = pairKey(tx.fromTeam, tx.toTeam);
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(tx);
  }

  const teamName = (id) => humanTeams.get(id)?.name ?? id;
  const flags = [];
  let candidatesEvaluated = 0;

  for (const [key, pairTxs] of pairs) {
    const [lo, hi] = key.split("|");
    if (whitelisted.has(key)) continue;
    candidatesEvaluated += 1;

    const userLo = humanTeams.get(lo).user;
    const userHi = humanTeams.get(hi).user;
    const identitySignals = computePairIdentitySignals(profiles.get(userLo.id), profiles.get(userHi.id));

    // Netto-værdistrøm mod hi (3135-konventionen), + prisafvigelser pr. handel
    let netFlowTowardHi = 0;
    const priceOutlierStrengths = [];
    for (const tx of pairTxs) {
      netFlowTowardHi += tx.toTeam === hi ? tx.flowToRecipient : -tx.flowToRecipient;
      if (tx.type === "swap") {
        for (const r of tx.swapLegRatios ?? []) priceOutlierStrengths.push(computePriceOutlierStrength(r, config));
      } else if (tx.marketValue > 0) {
        priceOutlierStrengths.push(computePriceOutlierStrength(tx.price / tx.marketValue, config));
      }
    }

    // Livscyklus pr. side, målt ved parrets FØRSTE handel; pr. signal tages MAX
    // over de to sider (en tragt har typisk én anomal side).
    const firstTxAt = pairTxs.reduce((min, tx) => (new Date(tx.at) < new Date(min) ? tx.at : min), pairTxs[0].at);
    const lifecycleByName = new Map();
    const addLifecycle = (name, strength, teamId) => {
      if (!(strength > 0)) return;
      const prev = lifecycleByName.get(name);
      if (!prev || strength > prev.strength) lifecycleByName.set(name, { name, strength, team_id: teamId });
    };
    for (const teamId of [lo, hi]) {
      const u = humanTeams.get(teamId).user;
      addLifecycle("account_age_at_tx", computeAccountAgeStrength(hoursBetween(firstTxAt, u.created_at)), teamId);
      addLifecycle("disposable_email", disposableEmailStrength(u.email), teamId);
      addLifecycle("low_activity_profile", computeActivityStrength(profiles.get(u.id)?.activity ?? {}), teamId);
      // Signal 3: hold der SÆLGER under 25% af market_value ≤7 dage efter et lån
      for (const tx of pairTxs) {
        if (tx.fromTeam !== teamId || !(tx.marketValue > 0)) continue;
        const ratio = tx.price / tx.marketValue;
        if (ratio >= 0.25) continue;
        for (const loan of loansByTeam.get(teamId) ?? []) {
          const gapDays = daysBetween(tx.at, loan.created_at);
          addLifecycle("loan_then_value_loss", computeLoanFunnelStrength({ ratio, gapDays }), teamId);
        }
      }
    }
    const lifecycleSignals = [...lifecycleByName.values()];

    const pairResult = scorePairIncident(
      { netFlowAbs: Math.abs(netFlowTowardHi), identitySignals, priceOutlierStrengths, lifecycleSignals },
      config
    );

    const txEvidence = pairTxs.slice(0, 15).map((tx) => ({
      type: tx.type,
      at: tx.at,
      from: teamName(tx.fromTeam),
      to: teamName(tx.toTeam),
      price: tx.price,
      rider: tx.riderName,
      rider_value: tx.riderValue,
      ratio: tx.marketValue > 0 ? Math.round((tx.price / tx.marketValue) * 1000) / 1000 : null,
    }));

    if (pairResult.score >= config.flagThreshold) {
      flags.push({
        flag_type: "pair_value_flow",
        team_id_lo: lo,
        team_id_hi: hi,
        score: pairResult.score,
        signals: pairResult.signals,
        evidence: {
          team_lo: teamName(lo),
          team_hi: teamName(hi),
          net_value_flow: Math.round(netFlowTowardHi),
          net_flow_direction: netFlowTowardHi >= 0 ? teamName(hi) : teamName(lo),
          n_transactions: pairTxs.length,
          window_days: 90,
          components: pairResult.components,
          transactions: txEvidence,
          market_value_is_current_proxy: true,
        },
      });
    }

    // Livscyklus-tragten: hver ENKELT stor kontant-handel vurderes for sig —
    // prisen kan være helt fair (#3137's pointe), gaten er beløbet.
    let bestFunnel = null;
    for (const tx of pairTxs) {
      if (!(tx.cashPaid >= config.funnelMinAmount)) continue;
      const funnelLifecycle = [];
      for (const teamId of [lo, hi]) {
        const u = humanTeams.get(teamId).user;
        const age = computeAccountAgeStrength(hoursBetween(tx.at, u.created_at));
        if (age > 0) funnelLifecycle.push({ name: "account_age_at_tx", strength: age, team_id: teamId });
        const disp = disposableEmailStrength(u.email);
        if (disp > 0) funnelLifecycle.push({ name: "disposable_email", strength: disp, team_id: teamId });
        const act = computeActivityStrength(profiles.get(u.id)?.activity ?? {});
        if (act > 0.7) funnelLifecycle.push({ name: "low_activity_profile", strength: act, team_id: teamId });
        for (const loan of loansByTeam.get(teamId) ?? []) {
          if (tx.fromTeam !== teamId || !(tx.marketValue > 0)) continue;
          const strength = computeLoanFunnelStrength({
            ratio: tx.price / tx.marketValue,
            gapDays: daysBetween(tx.at, loan.created_at),
          });
          if (strength > 0) funnelLifecycle.push({ name: "loan_then_value_loss", strength, team_id: teamId });
        }
      }
      const funnelResult = scoreFunnelIncident(
        { amount: tx.cashPaid, identitySignals, lifecycleSignals: funnelLifecycle },
        config
      );
      if (funnelResult.score >= config.flagThreshold && (!bestFunnel || funnelResult.score > bestFunnel.score)) {
        bestFunnel = {
          flag_type: "lifecycle_funnel",
          team_id_lo: lo,
          team_id_hi: hi,
          score: funnelResult.score,
          signals: funnelResult.signals,
          evidence: {
            team_lo: teamName(lo),
            team_hi: teamName(hi),
            trigger_transaction: {
              type: tx.type,
              at: tx.at,
              from: teamName(tx.fromTeam),
              to: teamName(tx.toTeam),
              amount: tx.cashPaid,
              rider: tx.riderName,
            },
            n_large_transactions: pairTxs.filter((t) => t.cashPaid >= config.funnelMinAmount).length,
            components: funnelResult.components,
            activity_is_current_proxy: true,
          },
        };
      }
    }
    if (bestFunnel) flags.push(bestFunnel);
  }

  flags.sort((a, b) => b.score - a.score);
  return {
    now: now.toISOString(),
    population: humanTeams.size,
    tradingPairs: pairs.size,
    candidatesEvaluated,
    whitelistedPairsSkipped: [...pairs.keys()].filter((k) => whitelisted.has(k)).length,
    flags,
  };
}

// ── Tærskel fra app_config (ejerstyret følsomhed, #3133-mønstret) ───────────

export async function getFairplayThreshold(supabase) {
  const { data, error } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "fairplay_flag_threshold")
    .maybeSingle();
  if (error) throw error;
  const parsed = Number(data?.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FAIRPLAY_DEFAULTS.flagThreshold;
}

// ── Sweep-orkestrering ──────────────────────────────────────────────────────

export async function runFairplayScoringSweep({ supabase, now = new Date(), dryRun = false }) {
  // Aktiverings-gate: tabellens eksistens (migration applied = tændt).
  if (!dryRun) {
    const probe = await supabase.from("fairplay_flags").select("id").limit(1);
    if (probe.error) {
      if (isMissingTableError(probe.error)) {
        return { skipped: true, reason: "fairplay_flags findes ikke endnu (migration ikke applied) — sweep springes over" };
      }
      throw probe.error;
    }
  }

  const sinceIso = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const loansSinceIso = new Date(now.getTime() - 97 * 86_400_000).toISOString();

  // .order(PK) på ALLE paginerede queries — uden deterministisk rækkefølge kan
  // .range()-siderne skippe/duplikere rækker (#3391-guarden håndhæver dette).
  const [teams, users, identityEvents, signupAttribution, transfers, auctions, swaps, loans] = await Promise.all([
    fetchAllRows(() => supabase.from("teams").select("id, name, user_id, is_ai, is_bank, is_test_account").order("id")),
    fetchAllRows(() =>
      supabase.from("users").select("id, email, username, created_at, level, xp, login_streak").order("id")
    ),
    fetchAllRows(() =>
      supabase.from("identity_events").select("user_id, ip, ip_prefix, first_seen_at, event_type").order("id")
    ),
    fetchAllRows(() => supabase.from("signup_attribution").select("user_id, first_seen_at").order("user_id")),
    fetchAllRows(() =>
      supabase
        .from("transfer_offers")
        .select(
          "id, buyer_team_id, offer_amount, counter_amount, created_at, updated_at, listing:listing_id(seller_team_id, rider:rider_id(base_value, market_value, firstname, lastname))"
        )
        .eq("status", "accepted")
        .gte("updated_at", sinceIso)
        .order("id")
    ),
    fetchAllRows(() =>
      supabase
        .from("auctions")
        .select(
          "id, seller_team_id, current_bidder_id, current_price, actual_end, rider:rider_id(base_value, market_value, firstname, lastname)"
        )
        .eq("status", "completed")
        .gte("actual_end", sinceIso)
        .not("seller_team_id", "is", null)
        .not("current_bidder_id", "is", null)
        .order("id")
    ),
    fetchAllRows(() =>
      supabase
        .from("swap_offers")
        .select(
          "id, proposing_team_id, receiving_team_id, cash_adjustment, counter_cash, created_at, updated_at, offered:offered_rider_id(base_value, market_value, firstname, lastname), requested:requested_rider_id(base_value, market_value, firstname, lastname)"
        )
        .eq("status", "accepted")
        .gte("updated_at", sinceIso)
        .order("id")
    ),
    fetchAllRows(() =>
      // KUN team_id+created_at forbruges (signal 3 er timing-baseret); loans har
      // i oevrigt `principal`, IKKE `amount` — verificeret mod information_schema 6/8.
      supabase.from("loans").select("team_id, created_at").gte("created_at", loansSinceIso).order("id")
    ),
  ]);

  // Whitelist (#3135): tolerér manglende tabel — tom liste + note.
  let whitelistPairs = [];
  let whitelistMissing = false;
  const wl = await supabase.from("fairplay_whitelisted_pairs").select("team_id_lo, team_id_hi");
  if (wl.error) {
    if (!isMissingTableError(wl.error)) throw wl.error;
    whitelistMissing = true;
  } else {
    whitelistPairs = wl.data ?? [];
  }

  const flagThreshold = dryRun ? FAIRPLAY_DEFAULTS.flagThreshold : await getFairplayThreshold(supabase);
  const config = { ...FAIRPLAY_DEFAULTS, flagThreshold };

  const report = buildFairplayReport({
    teams,
    users,
    identityEvents,
    signupAttribution,
    transfers,
    auctions,
    swaps,
    loans,
    whitelistPairs,
    config,
    now,
  });
  report.whitelistMissing = whitelistMissing;
  report.threshold = flagThreshold;

  if (dryRun) return { ...report, dryRun: true, upserted: 0, skippedDismissed: 0 };

  // Ejerens dom står ved magt: dismissed/actioned-rækker gen-scores ALDRIG.
  const existing = await fetchAllRows(() =>
    supabase.from("fairplay_flags").select("flag_type, team_id_lo, team_id_hi, status").order("id")
  );
  const closedKeys = new Set(
    existing
      .filter((f) => f.status === "dismissed" || f.status === "actioned")
      .map((f) => `${f.flag_type}|${f.team_id_lo}|${f.team_id_hi}`)
  );

  const nowIso = now.toISOString();
  let upserted = 0;
  let skippedDismissed = 0;
  for (const flag of report.flags) {
    if (closedKeys.has(`${flag.flag_type}|${flag.team_id_lo}|${flag.team_id_hi}`)) {
      skippedDismissed += 1;
      continue;
    }
    // Upsert på dedup-nøglen: status/owner_note/first_detected_at er IKKE med i
    // payloaden og bevares derfor uændret ved konflikt.
    const { error } = await supabase.from("fairplay_flags").upsert(
      {
        flag_type: flag.flag_type,
        team_id_lo: flag.team_id_lo,
        team_id_hi: flag.team_id_hi,
        score: flag.score,
        signals: flag.signals,
        evidence: flag.evidence,
        last_scored_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "flag_type,team_id_lo,team_id_hi" }
    );
    if (error) throw error;
    upserted += 1;
  }

  return { ...report, dryRun: false, upserted, skippedDismissed };
}
