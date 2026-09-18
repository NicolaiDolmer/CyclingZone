// #5257 — ÉN samlet, offentlig liste over alle rytterskifter i spillet,
// nyeste øverst. Serverer GET /api/transfers/feed.
//
// Hvorfor en ny lib og ikke en udvidelse af teamTransferHistory.js: den bygger
// ét holds KOMPLETTE historik (ingen paginering, ingen cap — den er afgrænset
// af holdet selv). Den globale liste har ingen sådan afgrænsning: auktioner
// alene er 5.300 gennemførte rækker i prod 18/9 og vokser hver sæson, så denne
// vej SKAL paginere. De to deler til gengæld sæson-resolveren (importeret, ikke
// kopieret) og PUBLIC_OFFER_STATUSES, så en handel aldrig kan få ét sæson-tal
// på holdets historik og et andet i den samlede liste.
//
// Privatlivs-kontrakt: svaret indeholder KUN felter der allerede er offentlige
// i dag. Hold-id/navn, rytter, dato, type og beløb vises allerede for et
// vilkårligt hold via GET /api/teams/:id/transfer-history (service-role-læsning,
// enhver indlogget spiller kan slå ethvert hold op). Der returneres ALDRIG
// user_id, e-mail, beskeder, bud-historik eller proxy-max — de kolonner
// selectes ikke, så de kan ikke slippe ud ved et uheld.
//
// Paginerings-kontrakt (hvorfor den er korrekt): feedet er en fletning af tre
// kilder, hver sorteret faldende på sin egen dato-kolonne. De N nyeste events i
// fletningen ligger altid i foreningsmængden af de N nyeste fra HVER kilde, så
// vi henter et vindue på (offset + limit + 1) fra hver kilde, fletter, sorterer
// og skærer siden ud. Vinduet er hårdt loftet under PostgREST's 1.000-rækkers-
// cap (se TRADE_FEED_MAX_OFFSET nedenfor), så der aldrig kan opstå en stille
// trunkering — det er præcis den fejlklasse scripts/lint-pagination-guard.mjs
// findes for.

import { PUBLIC_OFFER_STATUSES, buildSeasonResolver } from "./teamTransferHistory.js";
import { assertNoSupabaseError } from "./supabaseResultGuard.js";

export { PUBLIC_OFFER_STATUSES };

// De tre kilder til et ejerskifte mellem to hold. Akademi-hentninger er
// bevidst IKKE med: en academy_intake har ingen modpart (rytteren kommer fra
// holdets eget akademi), så den er hverken et skifte MELLEM hold eller
// rapporterbar (samme udelukkelse som frontend'ens tradeReport.ts og
// backendens resolveTradeParties). loans-tabellen er ligeledes ude: udlåns-
// featuren er afviklet (#1994), tabellen er død.
export const TRADE_FEED_TYPES = ["auction", "transfer", "swap"];

export const TRADE_FEED_DEFAULT_LIMIT = 25;
export const TRADE_FEED_MAX_LIMIT = 50;
// Dybde-loft. window = offset + limit + 1 ≤ 951 < 1.000 = PostgREST's cap, så
// et vindue aldrig kan blive stille trunkeret. Dybere end ~900 events er ikke
// en liste man bladrer i, det er et datasæt — det hører til filtrene.
export const TRADE_FEED_MAX_OFFSET = 900;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Kilde-konfiguration. `sides` er de to hold-aliasser i embeddet — de bruges
// både til division-filtret (PostgREST kan kun filtrere på ét embed ad gangen,
// se buildSourceQueries) og til at mappe rækken til from/to-hold.
const SOURCES = {
  auction: {
    table: "auctions",
    dateColumn: "actual_end",
    sides: ["seller", "winner"],
    teamColumns: ["seller_team_id", "current_bidder_id"],
    select: (innerSide) =>
      "id, current_price, actual_end, created_at, is_guaranteed_sale, seller_team_id, current_bidder_id"
      + ", rider:rider_id(id, firstname, lastname)"
      + `, seller:seller_team_id${innerSide === "seller" ? "!inner" : ""}(id, name, is_ai, division)`
      + `, winner:current_bidder_id${innerSide === "winner" ? "!inner" : ""}(id, name, is_ai, division)`,
    applyStatus: (q) => q.eq("status", "completed"),
  },
  transfer: {
    table: "transfer_offers",
    dateColumn: "updated_at",
    sides: ["seller", "buyer"],
    teamColumns: ["seller_team_id", "buyer_team_id"],
    select: (innerSide) =>
      "id, offer_amount, counter_amount, status, updated_at, seller_team_id, buyer_team_id"
      + ", rider:rider_id(id, firstname, lastname)"
      + `, seller:seller_team_id${innerSide === "seller" ? "!inner" : ""}(id, name, is_ai, division)`
      + `, buyer:buyer_team_id${innerSide === "buyer" ? "!inner" : ""}(id, name, is_ai, division)`,
    applyStatus: (q) => q.in("status", PUBLIC_OFFER_STATUSES),
  },
  swap: {
    table: "swap_offers",
    dateColumn: "updated_at",
    sides: ["proposing", "receiving"],
    teamColumns: ["proposing_team_id", "receiving_team_id"],
    select: (innerSide) =>
      "id, cash_adjustment, counter_cash, status, updated_at, proposing_team_id, receiving_team_id"
      + ", offered_rider:offered_rider_id(id, firstname, lastname)"
      + ", requested_rider:requested_rider_id(id, firstname, lastname)"
      + `, proposing:proposing_team_id${innerSide === "proposing" ? "!inner" : ""}(id, name, is_ai, division)`
      + `, receiving:receiving_team_id${innerSide === "receiving" ? "!inner" : ""}(id, name, is_ai, division)`,
    applyStatus: (q) => q.in("status", PUBLIC_OFFER_STATUSES),
  },
};

/**
 * Validerer og klemmer query-parametrene. Alt der kommer fra URL'en passerer
 * her FØR det rører en PostgREST-filterstreng — `team` interpoleres i en
 * .or()-streng, og en ikke-UUID-valideret værdi dér er præcis det hul
 * orFilterParamGuard.test.js findes for (security-audit 2026-06-12).
 *
 * @returns {{ ok: true, params: object } | { ok: false, error: string, errorCode: string }}
 */
export function parseTradeFeedQuery(query = {}) {
  const rawLimit = query.limit;
  let limit = TRADE_FEED_DEFAULT_LIMIT;
  if (rawLimit != null && rawLimit !== "") {
    const n = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(n) || n < 1) {
      return { ok: false, error: "Invalid limit", errorCode: "trade_feed_invalid_limit" };
    }
    limit = Math.min(n, TRADE_FEED_MAX_LIMIT);
  }

  let offset = 0;
  if (query.offset != null && query.offset !== "") {
    const n = Number.parseInt(query.offset, 10);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: "Invalid offset", errorCode: "trade_feed_invalid_offset" };
    }
    if (n > TRADE_FEED_MAX_OFFSET) {
      return { ok: false, error: "Offset is too deep", errorCode: "trade_feed_offset_too_deep" };
    }
    offset = n;
  }

  let type = null;
  if (query.type != null && query.type !== "" && query.type !== "all") {
    if (!TRADE_FEED_TYPES.includes(query.type)) {
      return { ok: false, error: "Invalid type", errorCode: "trade_feed_invalid_type" };
    }
    type = query.type;
  }

  let division = null;
  if (query.division != null && query.division !== "" && query.division !== "all") {
    const n = Number.parseInt(query.division, 10);
    if (!Number.isFinite(n) || n < 1 || n > 20) {
      return { ok: false, error: "Invalid division", errorCode: "trade_feed_invalid_division" };
    }
    division = n;
  }

  let teamId = null;
  if (query.team != null && query.team !== "" && query.team !== "all") {
    if (!UUID_RE.test(query.team)) {
      return { ok: false, error: "Invalid team", errorCode: "trade_feed_invalid_team" };
    }
    teamId = query.team;
  }

  return { ok: true, params: { limit, offset, type, division, teamId } };
}

// PostgREST kan ikke udtrykke "division = N på ENTEN sælger ELLER køber" i ét
// kald: et embed-filter kræver !inner på præcis det embed. Derfor kører et
// division-filter to queries pr. kilde (én pr. side) der dedupes på event-id
// bagefter. Foreningen af de to vinduer indeholder stadig de N nyeste rækker
// der matcher, så paginerings-kontrakten holder.
function buildSourceQueries(supabase, sourceKey, { window, division, teamId }) {
  const cfg = SOURCES[sourceKey];
  const sides = division == null ? [null] : cfg.sides;
  return sides.map((innerSide) => {
    let q = supabase.from(cfg.table).select(cfg.select(innerSide));
    q = cfg.applyStatus(q);
    if (division != null) q = q.eq(`${innerSide}.division`, division);
    if (teamId != null) {
      // teamId er UUID-valideret i parseTradeFeedQuery — se kommentaren dér.
      q = q.or(cfg.teamColumns.map((col) => `${col}.eq.${teamId}`).join(","));
    }
    // pagination-safe: vinduet er hårdt loftet (offset+limit+1 ≤ 951) og sat
    // med .limit() nedenfor, så PostgREST's 1.000-cap ikke kan nås.
    return q.order(cfg.dateColumn, { ascending: false, nullsFirst: false }).limit(window);
  });
}

function teamRef(team) {
  if (!team?.id) return null;
  return { id: team.id, name: team.name ?? null, is_ai: Boolean(team.is_ai), division: team.division ?? null };
}

function mapAuction(row, resolveSeason) {
  const date = row.actual_end || row.created_at;
  // #785: gennemført auktion uden vinder (og uden garanteret AI-salg) = intet
  // salg. current_price er den umødte startpris og må hverken vises som beløb
  // eller tælle som et skifte.
  const noSale = !row.current_bidder_id && !row.is_guaranteed_sale;
  return {
    id: `auction:${row.id}`,
    type: "auction",
    date,
    season_number: resolveSeason(date),
    rider: row.rider ?? null,
    rider_swapped: null,
    from_team: teamRef(row.seller),
    to_team: teamRef(row.winner),
    amount: noSale ? null : (row.current_price ?? null),
    no_sale: noSale,
    is_guaranteed_sale: Boolean(row.is_guaranteed_sale),
    // Rapporterbar = præcis det backendens resolveTradeParties accepterer
    // (feedbackInbox.js): en auktion uden current_bidder_id har ingen modpart,
    // heller ikke når den er et garanteret AI-salg.
    reportable: Boolean(row.current_bidder_id),
  };
}

function mapTransfer(row, resolveSeason) {
  const amount = row.counter_amount ?? row.offer_amount ?? null;
  return {
    id: `transfer:${row.id}`,
    type: "transfer",
    date: row.updated_at,
    season_number: resolveSeason(row.updated_at),
    rider: row.rider ?? null,
    rider_swapped: null,
    from_team: teamRef(row.seller),
    to_team: teamRef(row.buyer),
    amount,
    no_sale: false,
    is_guaranteed_sale: false,
    reportable: Boolean(row.seller_team_id && row.buyer_team_id),
  };
}

function mapSwap(row, resolveSeason) {
  const cash = row.counter_cash ?? row.cash_adjustment ?? 0;
  return {
    id: `swap:${row.id}`,
    type: "swap",
    date: row.updated_at,
    season_number: resolveSeason(row.updated_at),
    // Bytte har to ryttere der går hver sin vej. from_team = den foreslående
    // side, så `rider` altid er rytteren der forlader from_team.
    rider: row.offered_rider ?? null,
    rider_swapped: row.requested_rider ?? null,
    from_team: teamRef(row.proposing),
    to_team: teamRef(row.receiving),
    amount: cash === 0 ? null : Math.abs(cash),
    // Fortegnet er set fra den foreslående side: positivt = proposing betaler.
    cash_direction: cash === 0 ? null : (cash > 0 ? "proposing_pays" : "receiving_pays"),
    no_sale: false,
    is_guaranteed_sale: false,
    reportable: Boolean(row.proposing_team_id && row.receiving_team_id),
  };
}

const MAPPERS = { auction: mapAuction, transfer: mapTransfer, swap: mapSwap };

/**
 * Fletter de tre kilder til én side af det globale feed, nyeste øverst.
 *
 * @returns {{ events: object[], limit: number, offset: number, has_more: boolean }}
 */
export async function buildGlobalTradeFeed(supabase, params) {
  const { limit, offset, type, division, teamId } = params;
  const window = offset + limit + 1;
  const sourceKeys = type ? [type] : TRADE_FEED_TYPES;

  const jobs = [];
  for (const key of sourceKeys) {
    for (const q of buildSourceQueries(supabase, key, { window, division, teamId })) {
      jobs.push({ key, promise: q });
    }
  }
  const seasonsPromise = supabase
    .from("seasons")
    .select("id, number, start_date, end_date")
    .order("number", { ascending: true });

  const [seasonsRes, ...results] = await Promise.all([seasonsPromise, ...jobs.map((j) => j.promise)]);

  // Security-audit 2026-06-12 (#1338): en slugt query-fejl ville ellers give et
  // falsk TOMT feed med HTTP 200 — "der er ingen handler" i stedet for "vi kunne
  // ikke læse dem".
  const guard = { seasons: seasonsRes };
  results.forEach((res, i) => { guard[`${jobs[i].key}[${i}]`] = res; });
  assertNoSupabaseError(guard, "buildGlobalTradeFeed");

  const resolveSeason = buildSeasonResolver(seasonsRes.data || []);
  const byId = new Map();
  results.forEach((res, i) => {
    const map = MAPPERS[jobs[i].key];
    for (const row of res.data || []) {
      const event = map(row, resolveSeason);
      // Dedupe: division-filtret kører to queries pr. kilde, og en handel hvor
      // BEGGE hold ligger i divisionen kommer med i begge vinduer.
      if (!byId.has(event.id)) byId.set(event.id, event);
    }
  });

  const merged = [...byId.values()].sort((a, b) => {
    const diff = new Date(b.date || 0) - new Date(a.date || 0);
    // Stabil sekundær nøgle: uden den kan to events med samme tidsstempel bytte
    // plads mellem to sidehentninger og blive vist to gange / slet ikke.
    return diff !== 0 ? diff : (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  });

  return {
    events: merged.slice(offset, offset + limit),
    limit,
    offset,
    has_more: merged.length > offset + limit,
  };
}
