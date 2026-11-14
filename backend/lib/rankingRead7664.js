// #7664: ranglisterne laeser de nye tabeller (skyggetabellerne fra #6765) bag
// kontakten ranking_shadow_decoupled_6765.
//
// Slukket (default): intet aendres. Klienten nedenfor sender hvert tabelnavn
// uaendret videre, forsidens top 5 bruger dagens RPC, og "opdateret kl." vises
// ikke. Taendt: alle rangliste-ruter, der i dag laeser et af de fire tunge
// matviews, laeser i stedet den tilsvarende skyggetabel. Skyggetabellerne
// holdes ajour trinvis efter hver aendring (apply_ranking_deltas), mens den
// fulde genberegning af matviews koeres sjaeldnere (refreshRankingMatviews.js).
//
// Sikkerhedsnet: skyggen bruges kun, naar BEGGE kontakter er taendt
// (ranking_shadow_enabled skriver skyggen, ranking_shadow_decoupled_6765
// afkobler den), naar databasen har bekraeftet, at seneste genopbygning er
// helt faerdig, og naar dens koe ikke er gaaet i staa. Ellers falder alle
// laesninger tilbage til matviews, saa en fejl i skyggen aldrig giver tomme
// eller gamle tal.
//
// Nødvej: fejler selve laesningen i skyggen (ruterne eller forsiden), faar
// spilleren svaret fra matviews i stedet for en fejl, kildevalget holdes paa
// matviews i SHADOW_FALLBACK_WINDOW_MS, og Sentry faar hoejst een rapport pr.
// vindue. Med kontakten slukket er intet af dette i spil.
//
// global_rank_mv har ingen skygge. Den bygger paa season_standings, som
// opdateres ved finaliseringen, og laeses som i dag.
import { AsyncLocalStorage } from "node:async_hooks";
import { Router } from "express";
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { fetchAllRows, SUPABASE_IN_CHUNK_SIZE } from "./supabasePagination.js";

export const RANKING_READ_FLAG_7664 = "ranking_shadow_decoupled_6765";
export const RANKING_SHADOW_WRITE_FLAG = "ranking_shadow_enabled";

// Matview -> skyggetabel. Skyggerne er oprettet med LIKE matviewet, saa
// kolonnenavne, typer og raekkefoelge er de samme (database/2026-10-19-6765-...).
export const SHADOW_READ_TABLES = Object.freeze({
  rider_rankings_mv: "ranking_rider_season",
  youth_rider_rankings_mv: "ranking_youth_rider_season",
  team_standings_ext_mv: "ranking_team_season_ext",
  team_race_points_mv: "ranking_team_race_points",
});

// En skyggekoe, hvis aeldste post er aeldre end skyggens egen staa-alarm
// (rankingShadowPass.ts), er ikke laengere fresher end matviews.
export const SHADOW_READ_MAX_LAG_S = 1800;
// Hvor laenge et kildevalg genbruges pr. backend-klient. Kort, saa
// "opdateret kl." foelger koeen, men aldrig et opslag pr. request.
export const SOURCE_CACHE_TTL_MS = 10_000;
// Naar laesningerne kommer fra skyggen, samler den fulde genberegning
// aendringerne i dette vindue foer den koerer (se refreshRankingMatviews.js).
export const LEGACY_HOLD_MS_7664 = 15 * 60 * 1000;

// Nødvej: fejler en laesning i de nye tabeller, laeses de gamle i stedet, og
// kildevalget holdes paa de gamle i dette vindue (saa hvert request ikke
// betaler for en fejlende laesning, og "opdateret kl." forsvinder, mens tallene
// kommer fra de gamle tabeller). Sentry faar hoejst een rapport pr. vindue.
export const SHADOW_FALLBACK_WINDOW_MS = 5 * 60 * 1000;

/** @type {Readonly<RankingReadSource>} */
const LEGACY = Object.freeze({ source: "legacy", currentAsOf: null });
let sourceCache = new WeakMap();
// Nødvejens hold pr. klient (udloebstid), gemt for sig selv: et kildeopslag,
// der allerede var i gang, da holdet blev sat, maa ikke kunne overskrive det.
let fallbackHoldUntil = new WeakMap();
let fallbackReport = { lastAt: -Infinity, suppressed: 0 };

export function __resetRankingReadCacheForTests() {
  sourceCache = new WeakMap();
  fallbackHoldUntil = new WeakMap();
  fallbackReport = { lastAt: -Infinity, suppressed: 0 };
}

/** Holder nødvejen kildevalget paa de gamle tabeller lige nu? */
function fallbackHoldActive(supabase, at) {
  return (fallbackHoldUntil.get(supabase) ?? -Infinity) > at;
}

/** Supabase-fejl er ofte et objekt med `message`, ikke en Error. */
function toError(error) {
  if (error instanceof Error) return error;
  return new Error(String(/** @type {{ message?: unknown }} */ (error)?.message ?? error));
}

/**
 * En laesning i de nye tabeller fejlede, og laeseren bruger de gamle i stedet.
 * Holder kildevalget paa de gamle i vinduet og rapporterer hoejst een gang pr.
 * vindue (pr. backend-proces); de undertrykte taelles med i naeste rapport.
 * @param {any} supabase
 * @param {unknown} error
 * @param {string} path
 * @param {{ now?: () => number, captureExceptionFn?: CaptureFn }} [options]
 */
function noteShadowFallback(supabase, error, path, { now = Date.now, captureExceptionFn } = {}) {
  const at = now();
  if (supabase && typeof supabase === "object") {
    fallbackHoldUntil.set(supabase, at + SHADOW_FALLBACK_WINDOW_MS);
    // Efter holdet slaas kilden op paa ny i stedet for at genbruge et gammelt valg.
    sourceCache.delete(supabase);
  }
  if (at - fallbackReport.lastAt < SHADOW_FALLBACK_WINDOW_MS) {
    fallbackReport.suppressed += 1;
    return;
  }
  const suppressed = fallbackReport.suppressed;
  fallbackReport = { lastAt: at, suppressed: 0 };
  captureExceptionFn?.(toError(error), {
    tags: { lib: "rankingRead7664", path },
    fallback: "legacy_tables",
    suppressed_since_last_report: suppressed,
  });
}

/**
 * Er laeseskiftet taendt? Samme evaluering som skyggepasset (engineWrite),
 * saa afkoblingen og laeseskiftet altid foelges ad.
 */
export async function rankingReadSwitchOn(supabase, { now = Date.now } = {}) {
  const [decoupled, writes] = await Promise.all([
    readFlagStage(supabase, RANKING_READ_FLAG_7664, { now }),
    readFlagStage(supabase, RANKING_SHADOW_WRITE_FLAG, { now }),
  ]);
  return evaluateFlagStage(decoupled, { engineWrite: true })
    && evaluateFlagStage(writes, { engineWrite: true });
}

/**
 * Er skyggens seneste genopbygning helt faerdig? Et kontaktskift (eller
 * TRUNCATE) laegger en 'rebuild'-markoer, som udfoldes og behandles i mange
 * omgange med ny koe-alder, saa koe-alderen alene siger intet. Databasen
 * bekraefter faerdig, naar markoeren og alt det, den blev foldet ud til, er
 * behandlet (database/2026-11-13-7664-ranking-shadow-read-ready.sql). Kun et
 * eksplicit `ready: true` taeller; en fejl kastes og giver matviews.
 */
async function shadowRebuildFinished(supabase) {
  const { data, error } = await supabase.rpc("get_ranking_shadow_read_ready", {});
  if (error) throw new Error(error.message);
  return data?.ready === true;
}

/** @typedef {{ source: "legacy"|"shadow", currentAsOf: string|null }} RankingReadSource */
/** @typedef {(error: Error, context: { tags: Record<string, string>, [extra: string]: unknown }) => void} CaptureFn */

/**
 * Hvilken kilde rangliste-ruterne skal laese nu.
 * currentAsOf: tidspunktet hvor skyggen senest indeholdt alle kendte
 * aendringer (nu, naar koeen er tom; ellers foer den aeldste ventende post).
 * @param {any} supabase
 * @param {{ now?: () => number, captureExceptionFn?: CaptureFn }} [options]
 * @returns {Promise<RankingReadSource>}
 */
export async function resolveRankingReadSource(supabase, { now = Date.now, captureExceptionFn } = {}) {
  if (!supabase?.from || !supabase?.rpc) return LEGACY;
  if (fallbackHoldActive(supabase, now())) return LEGACY;
  const hit = sourceCache.get(supabase);
  if (hit && hit.expiresAt > now()) return hit.value;
  /** @type {RankingReadSource} */
  let value = LEGACY;
  try {
    if (await rankingReadSwitchOn(supabase, { now }) && await shadowRebuildFinished(supabase)) {
      const { data, error } = await supabase.rpc("get_ranking_shadow_metrics", {});
      if (error) throw new Error(error.message);
      const age = data?.oldest_age_s;
      const ageS = age === null || age === undefined ? 0 : Number(age);
      if (!Number.isFinite(ageS) || ageS < 0) throw new Error("Invalid ranking shadow queue age");
      if (ageS <= SHADOW_READ_MAX_LAG_S) {
        value = { source: "shadow", currentAsOf: new Date(now() - ageS * 1000).toISOString() };
      }
    }
  } catch (error) {
    // best-effort: kildevalget falder tilbage til matviews (dagens adfaerd).
    captureExceptionFn?.(error instanceof Error ? error : new Error(String(error)), {
      tags: { lib: "rankingRead7664" },
    });
    value = LEGACY;
  }
  // Blev nødvejens hold sat, mens opslaget kørte, vinder holdet, og opslagets
  // svar gemmes ikke.
  if (fallbackHoldActive(supabase, now())) return LEGACY;
  sourceCache.set(supabase, { value, expiresAt: now() + SOURCE_CACHE_TTL_MS });
  return value;
}

const requestSource = new AsyncLocalStorage();

/** Det kildevalg, der gaelder for det igangvaerende request (legacy udenfor). */
export function currentRankingReadSource() {
  return requestSource.getStore() ?? LEGACY;
}

/** Tabelnavnet en rangliste-laesning skal bruge for den givne kilde. */
export function rankingTableFor(name, source) {
  return source === "shadow" ? (SHADOW_READ_TABLES[name] ?? name) : name;
}

/**
 * Kører rangliste-routeren med kildevalget bundet til requestets asynkrone
 * kontekst (vaelges een gang pr. request).
 *
 * Kilden er de gamle tabeller (kontakten slukket): routeren koerer direkte,
 * praecis som foer; intet svar opfanges.
 *
 * Kilden er de nye tabeller: ender requestet i et 5xx-svar, efter at det har
 * laest mindst een ny tabel, sendes svaret ikke. Routeren koeres i stedet een
 * gang til mod de gamle tabeller, og spilleren faar det svar. Fejlen
 * rapporteres hoejst een gang pr. vindue (noteShadowFallback). Fejler ogsaa
 * de gamle tabeller, er svaret og rapporten som i dag.
 * @param {any} supabase den raa klient (samme noegle som kildevalget)
 * @param {(req: any, res: any, next: (err?: unknown) => void) => void} handler rangliste-routeren
 * @param {{ now?: () => number, captureExceptionFn?: CaptureFn }} [options]
 */
export function rankingReadWithFallback7664(supabase, handler, options = {}) {
  return async (req, res, next) => {
    const value = await resolveRankingReadSource(supabase, options);
    if (value.source !== "shadow") {
      requestSource.run(value, () => handler(req, res, next));
      return;
    }
    /** @type {ShadowAttempt} */
    const attempt = { ...value, fallback: true, shadowRead: false, withheld: null };
    const statusBefore = res.statusCode;
    const headersBefore = res.getHeaders();
    const ownSend = Object.prototype.hasOwnProperty.call(res, "send") ? res.send : null;
    let settled = false;
    const release = () => {
      if (settled) return false;
      settled = true;
      if (ownSend) res.send = ownSend;
      else delete res.send; // tilbage til Express' egen send
      return true;
    };
    // Ingen nødvej (svaret gik igennem, eller routeren gav videre): en
    // tilbageholdt fejl rapporteres, som routeren selv ville have gjort.
    const passThrough = () => {
      if (release()) attempt.withheld?.report();
    };
    res.send = function sendWithFallback(/** @type {unknown[]} */ ...args) {
      if (settled || !(res.statusCode >= 500 && attempt.shadowRead)) {
        passThrough();
        return res.send(...args);
      }
      release();
      const failedStatus = res.statusCode;
      // Nulstil det, det fejlede forsoeg naaede at saette, foer de gamle laeses.
      for (const name of res.getHeaderNames()) if (!(name in headersBefore)) res.removeHeader(name);
      for (const [name, header] of Object.entries(headersBefore)) if (header !== undefined) res.setHeader(name, header);
      res.statusCode = statusBefore;
      noteShadowFallback(supabase, attempt.withheld?.error ?? new Error(`ranking read failed with HTTP ${failedStatus}`), "route", options);
      requestSource.run(LEGACY, () => handler(req, res, next));
      return res;
    };
    requestSource.run(attempt, () => handler(req, res, (/** @type {unknown} */ err) => { passThrough(); next(err); }));
  };
}

/**
 * reportError til rangliste-routeren. I et forsoeg mod de nye tabeller, der
 * allerede har laest en ny tabel, holdes fejlen tilbage: nødvejen rapporterer
 * den (een gang pr. vindue). Alle andre fejl, og alt med kontakten slukket,
 * gaar direkte videre som i dag.
 * @param {(error: unknown) => void} reportError
 */
export function withShadowFallbackReport(reportError) {
  return (/** @type {unknown} */ error) => {
    const store = /** @type {ShadowAttempt | undefined} */ (requestSource.getStore());
    if (store?.fallback && store.shadowRead && !store.withheld) {
      store.withheld = { error, report: () => reportError(error) };
      return;
    }
    reportError(error);
  };
}

/** @typedef {RankingReadSource & { fallback: true, shadowRead: boolean, withheld: { error: unknown, report: () => void } | null }} ShadowAttempt */

/**
 * Samme klient, men `.from(<matview>)` peger paa skyggetabellen, naar
 * requestets kilde er "shadow". Alt andet (rpc, andre tabeller) er uaendret.
 */
export function createRankingReadClient(supabase) {
  return new Proxy(supabase, {
    get(target, prop) {
      if (prop === "from") {
        return (name, ...rest) => {
          const store = /** @type {ShadowAttempt | undefined} */ (requestSource.getStore());
          const table = rankingTableFor(name, store?.source);
          if (store?.fallback && table !== name) store.shadowRead = true;
          return target.from(table, ...rest);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * GET /freshness -> { source, current_as_of }. Frontenden viser kun
 * "opdateret kl." naar source er "shadow".
 */
export function createRankingFreshnessRouter({ supabase, requireAuth, reportError, now = Date.now }) {
  const router = Router();
  router.get("/freshness", requireAuth, async (req, res) => {
    const value = await resolveRankingReadSource(supabase, { captureExceptionFn: reportError, now });
    res.set("Cache-Control", "private, no-store").json({ source: value.source, current_as_of: value.currentAsOf });
  });
  return router;
}

const n = (value) => Number(value) || 0;
// Samme orden som databasen faar besked paa (points DESC NULLS LAST, rider_id):
// en raekke uden point staar efter alle med point, ogsaa efter 0. Lige point
// afgoeres af rytter-id, som paa rytterranglisten (dagens RPC bruger i stedet
// det laveste resultat-id; se PR-teksten for #7664).
const sortPoints = (value) => (value === null || value === undefined || value === "" ? -Infinity : n(value));
const byPointsThenId = (a, b) => {
  const pa = sortPoints(a.points), pb = sortPoints(b.points);
  if (pa !== pb) return pb > pa ? 1 : -1;
  return a.rider_id < b.rider_id ? -1 : a.rider_id > b.rider_id ? 1 : 0;
};

/**
 * Ren funktion: forsidens top 5 ud fra rytterranglistens raekker, i samme
 * omfang og raekkefoelge som rytterranglisten med forsidens division/pulje
 * forvalgt (point faldende, derefter rytter-id). Pensionerede og ryttere
 * uden visningsdata springes over, som paa ranglistesiden.
 */
export function pickDashboardTopRiders(stats, displayById, limit = 5) {
  const rows = [];
  // Sorteres paa de raa point (NULL efter 0), foer de vises som tal.
  for (const stat of [...stats].sort(byPointsThenId)) {
    if (rows.length === limit) break;
    const display = displayById.get(stat.rider_id);
    if (!display) continue;
    rows.push({
      rider_id: stat.rider_id,
      firstname: display.firstname ?? null,
      lastname: display.lastname ?? null,
      nationality_code: display.nationality_code ?? null,
      team_name: display.team?.name ?? null,
      is_ai: display.team?.is_ai ?? false,
      points: n(stat.points),
      stage_wins: n(stat.stage_wins),
      gc_wins: n(stat.gc_wins),
      classic_wins: n(stat.classic_wins),
    });
  }
  return rows;
}

const DISPLAY_COLUMNS = "id,firstname,lastname,nationality_code,team:team_id(name,is_ai,league_division_id)";
const TOP_STAT_COLUMNS = "rider_id,points,stage_wins,gc_wins,classic_wins";
const DASHBOARD_TOP_LIMIT = 5;
const POINTS_ORDER = Object.freeze({ ascending: false, nullsFirst: false });
// Samlet tidsgraense for forsidens nye vej (kildevalg + alle laesninger).
// Forsiden skal svare under 3 s; vejen tager normalt 5 korte trin. Hænger en
// laesning, opgives vejen efter 1,5 s, saa dagens RPC har den anden halvdel.
export const DASHBOARD_SHADOW_TIMEOUT_MS = 1500;

/**
 * Forsidens top 5 fra rytterranglistens skyggetabel. Returnerer null, naar
 * kilden er matviews: saa koerer forsiden praecis som i dag.
 *
 * Nødvej: fejler eller haenger en laesning i den nye vej (samlet graense
 * DASHBOARD_SHADOW_TIMEOUT_MS), rapporteres det een gang, og der returneres
 * null, saa forsiden bruger dagens RPC i stedet for at svare 500 eller vente.
 * @param {any} supabase
 * @param {{ seasonId: string, leagueDivisionId: number|null, source?: RankingReadSource, captureExceptionFn?: CaptureFn, now?: () => number, timeoutMs?: number }} options
 */
export async function readDashboardTopRiders7664(supabase, { seasonId, leagueDivisionId, source, captureExceptionFn, now = Date.now, timeoutMs = DASHBOARD_SHADOW_TIMEOUT_MS }) {
  const controller = new AbortController();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`dashboard top riders: shadow path exceeded ${timeoutMs} ms`));
    }, timeoutMs);
  });
  // Kun den nye vej rapporteres. Haenger selve kildevalget (fx flag-opslaget,
  // ogsaa med kontakten slukket), er svaret alligevel rigtigt (dagens RPC), og
  // kildevalget rapporterer selv sine fejl.
  let shadowStarted = false;
  const work = (async () => {
    const chosen = source ?? await resolveRankingReadSource(supabase, { captureExceptionFn, now });
    if (chosen.source !== "shadow") return null;
    shadowStarted = true;
    return readShadowTopRiders(supabase, { seasonId, leagueDivisionId, signal: controller.signal });
  })();
  try {
    return await Promise.race([work, timeout]);
  } catch (error) {
    // best-effort: forsiden falder tilbage til dagens RPC (api.js).
    if (!shadowStarted) return null;
    // Hoejst een rapport pr. vindue, og kildevalget holdes paa de gamle tabeller.
    noteShadowFallback(supabase, error, "dashboard-top", { now, captureExceptionFn });
    return null;
  } finally {
    clearTimeout(timer);
    // best-effort: den tabte vej maa ikke give en ubehandlet afvisning efter
    // afbrydelsen; dens fejl er allerede rapporteret een gang ovenfor.
    work.catch(() => { /* best-effort: allerede rapporteret */ });
  }
}

async function readShadowTopRiders(supabase, { seasonId, leagueDivisionId, signal }) {
  const table = SHADOW_READ_TABLES.rider_rankings_mv;
  if (leagueDivisionId == null) {
    // Ingen pulje: hele ranglisten, som rytterfanens standard. Bladrer i
    // pointorden, indtil fem synlige (ikke-pensionerede) ryttere er fundet.
    const PAGE = 50;
    const stats = [], displayById = new Map();
    for (let from = 0; ; from += PAGE) {
      const { data: page, error } = await supabase.from(table).select(TOP_STAT_COLUMNS)
        .eq("season_id", seasonId).order("points", POINTS_ORDER).order("rider_id")
        .range(from, from + PAGE - 1).abortSignal(signal);
      if (error) throw error;
      const ids = (page || []).map((row) => row.rider_id);
      if (ids.length) {
        // pagination-safe: bounded by the PAGE-sized id list above.
        const { data: display, error: displayError } = await supabase.from("riders").select(DISPLAY_COLUMNS)
          .in("id", ids).eq("is_retired", false).abortSignal(signal);
        if (displayError) throw displayError;
        for (const row of display || []) displayById.set(row.id, row);
        stats.push(...page);
      }
      if (ids.length < PAGE || stats.filter((row) => displayById.has(row.rider_id)).length >= 5) break;
    }
    return pickDashboardTopRiders(stats, displayById);
  }
  // Puljens ryttere (nuvaerende hold), samme filter som rytterfanen efter
  // forsidens "Fuld rangliste"-link (team.league_division_id).
  const { data: teams, error: teamsError } = await supabase.from("teams").select("id")
    .eq("league_division_id", leagueDivisionId).abortSignal(signal);
  if (teamsError) throw teamsError;
  const teamIds = (teams || []).map((row) => row.id);
  if (!teamIds.length) return [];
  // Kun id'er (ca. 600-1.100 pr. pulje i prod 13/11, een til to sider).
  const poolRiders = await fetchAllRows(() => supabase.from("riders").select("id")
    .in("team_id", teamIds).eq("is_retired", false).order("id").abortSignal(signal));
  const ids = poolRiders.map((row) => row.id);
  if (!ids.length) return [];
  // Top 5 pr. bid af puljens ryttere, filtreret og sorteret i databasen (unik
  // noegle season_id + rider_id). Den samlede top 5 ligger altid i foreningen
  // af hver bids top 5, saa hver laesning er hoejst fem raekker. Bidderne
  // koeres samtidig. Foer hentede denne vej hele saesonens tabel side for side.
  const chunks = [];
  for (let i = 0; i < ids.length; i += SUPABASE_IN_CHUNK_SIZE) chunks.push(ids.slice(i, i + SUPABASE_IN_CHUNK_SIZE));
  const perChunk = await Promise.all(chunks.map(async (chunk) => {
    // pagination-safe: limit(5) per chunk of at most SUPABASE_IN_CHUNK_SIZE ids.
    const { data, error } = await supabase.from(table).select(TOP_STAT_COLUMNS)
      .eq("season_id", seasonId).in("rider_id", chunk)
      .order("points", POINTS_ORDER).order("rider_id").limit(DASHBOARD_TOP_LIMIT).abortSignal(signal);
    if (error) throw error;
    return data || [];
  }));
  const top = perChunk.flat().sort(byPointsThenId).slice(0, DASHBOARD_TOP_LIMIT);
  if (!top.length) return [];
  // pagination-safe: at most DASHBOARD_TOP_LIMIT ids.
  const { data: display, error: displayError } = await supabase.from("riders").select(DISPLAY_COLUMNS)
    .in("id", top.map((row) => row.rider_id)).eq("is_retired", false).abortSignal(signal);
  if (displayError) throw displayError;
  const displayById = new Map((display || []).map((row) => [row.id, row]));
  return pickDashboardTopRiders(top, displayById);
}
