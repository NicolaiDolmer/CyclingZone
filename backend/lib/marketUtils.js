import { SALARY_RATE } from "./economyConstants.js";
import { normalizeSupabaseErrorMessage } from "./supabaseErrorNormalize.js";

// #838: ét fælles roster-loft for alle divisioner. Max er ensrettet til 30.
// Roster-FLOOR fjernet 2026-06-05: ingen division kræver længere et minimum
// antal ryttere — en manager kan sælge/afgive helt ned til 0. Hard-cap'en
// (max) er uændret. min=0 gør getOutgoingSquadViolation til en no-op og
// deaktiverer squadEnforcement-cron'ens under-min auto-køb + bøde.
export const MAX_SQUAD_SIZE = 30;

export const MARKET_SQUAD_LIMITS = {
  1: { min: 0, max: MAX_SQUAD_SIZE },
  2: { min: 0, max: MAX_SQUAD_SIZE },
  3: { min: 0, max: MAX_SQUAD_SIZE },
};

// #267: under et åbent transfervindue må manageren overskride division-cap
// midlertidigt med dette buffer (D1 → 32, D2 → 22, D3 → 12). Når vinduet
// lukker auto-sælger squadEnforcement-cron ned til hard-cap og fakturer
// SQUAD_FINE_AMOUNT + SQUAD_PENALTY_POINTS pr. afvigende rytter — så
// soft-cap koster spilleren bagud, men auktion-vindere bliver ikke
// længere afvist i døren.
export const TRANSFER_WINDOW_SOFT_CAP_BUFFER = 2;

export const MIN_RIDERS_FOR_RACE = 8;

// #1101 cutover: værdi kommer fra DB-kolonnen market_value (GENERATED fra
// base_value + prize_earnings_bonus). Fallback spejler DB'ens
// COALESCE(base_value, 1000) for callsites uden market_value i select.
// uci_points indgår ALDRIG. SKAL matche database/2026-06-10-value-cutover-base-value.sql.
export const RIDER_BASE_VALUE_FALLBACK = 1000;

const DEFAULT_DIVISION = 3;

export function ensureNoError(error) {
  if (error) {
    // #2023: kog en evt. Cloudflare/HTML-fejlside ned til én kort, grupperbar
    // linje, så en Supabase-outage ikke fylder Sentry med ulæselige issues.
    throw new Error(normalizeSupabaseErrorMessage(error.message));
  }
}

export async function expectSingle(query) {
  const { data, error } = await query.single();
  ensureNoError(error);
  return data;
}

export async function expectMaybeSingle(query) {
  const { data, error } = await query.maybeSingle();
  ensureNoError(error);
  return data;
}

export async function expectCount(query) {
  const { count, error } = await query;
  ensureNoError(error);
  return count || 0;
}

export async function expectMutation(query) {
  const { error } = await query;
  ensureNoError(error);
}

export function getSquadLimits(division = DEFAULT_DIVISION) {
  return MARKET_SQUAD_LIMITS[division] || MARKET_SQUAD_LIMITS[DEFAULT_DIVISION];
}

// #776/#822: når en rytter skifter ejer (auktionssalg, guaranteed-sale til
// banken, transfer/swap-execution, auto-salg) skal hans aktive
// transfer_listings lukkes, ellers står han som zombie-"til salg" på
// transfermarkedet — og kan i værste fald dobbelt-sælges via et åbent listing.
// status skal være i CHECK-enum'en: 'sold' (handlen gennemført) eller
// 'withdrawn' (annulleret). Delt af transferExecution + auctionFinalization +
// squadEnforcement.
export async function closeTransferListingsForRiders(supabase, riderIds, status) {
  await expectMutation(
    supabase
      .from("transfer_listings")
      .update({ status })
      .in("rider_id", riderIds)
      .in("status", ["open", "negotiating"])
  );
}

// #1748 (a): når en rytter sælges via auktion skal ALLE åbne transfer- OG
// swap-tilbud på ham også trækkes tilbage — ikke kun transfer_listings. Ellers
// kan en modpart bekræfte et tidligere tilbud EFTER auktionssalget og forsøge at
// dobbelt-overdrage rytteren (executeTransferOffer-TOCTOU-guarden fanger det, men
// at lade tilbuddet stå "aktivt" i UI'et er forvirrende). Idempotent: rammer kun
// stadig-åbne records. Delt af auctionFinalization (+ kan genbruges af andre
// salgs-stier). De aktive market-statuser spejler ACTIVE_MARKET_STATUSES i
// transferExecution.js (pending/countered/awaiting_confirmation).
export async function withdrawOpenTransferDealsForRiders(supabase, riderIds) {
  const ids = (riderIds || []).filter(Boolean);
  if (ids.length === 0) return;
  const openStatuses = ["pending", "countered", "awaiting_confirmation"];
  await expectMutation(
    supabase
      .from("transfer_offers")
      .update({ status: "withdrawn" })
      .in("rider_id", ids)
      .in("status", openStatuses)
  );
  const riderList = ids.join(",");
  await expectMutation(
    supabase
      .from("swap_offers")
      .update({ status: "withdrawn" })
      .in("status", openStatuses)
      .or(`offered_rider_id.in.(${riderList}),requested_rider_id.in.(${riderList})`)
  );
}

// #1748 (a): den delte "er denne rytter på en aktiv auktion?"-kilde. Returnerer
// delmængden af riderIds der har en auktion i status active/extended. Bruges af
// transfer-køb/-tilbud-gaterne (api.js + transferExecution) så en rytter kun kan
// anskaffes ad ÉN vej ad gangen — samme single-source-of-truth som auktion-vs-swap
// (getSwapAuctionConflict). Tom riderIds → tom liste (ingen query).
export async function getActiveAuctionRiderIds(supabase, riderIds = []) {
  const ids = (riderIds || []).filter(Boolean);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("auctions")
    .select("rider_id")
    .in("rider_id", ids)
    .in("status", ["active", "extended"]);
  ensureNoError(error);
  return [...new Set((data || []).map((row) => row.rider_id))];
}

export function calculateRiderMarketValue(rider = {}) {
  const explicit = Number(rider.market_value);
  if (Number.isFinite(explicit)) return explicit;
  const base = Number(rider.base_value) > 0 ? Number(rider.base_value) : RIDER_BASE_VALUE_FALLBACK;
  return base + (Number(rider.prize_earnings_bonus) || 0);
}

// Backend parity-twin af frontend getRiderSalary. Bruges af #1310-markeds-pakken (system-bølge-listings / prospektiv løn). Behold.
// #1309: frossen kontrakt-løn hvis sat; ellers estimat (SALARY_RATE af market_value)
// til VISNING af free agents. Ejede ryttere har altid salary != null (seed +
// on-acquire), så for dem returneres den frosne løn uændret. salary:0 er en
// gyldig (gratis) kontrakt og bevares som 0. SALARY_RATE = samme rate som signering
// (contractSeed) → estimatet matcher det rytteren faktisk fryses til ved erhvervelse.
export function resolveRiderSalary(rider = {}) {
  if (rider && rider.salary != null) return Number(rider.salary);
  return Math.max(1, Math.round(calculateRiderMarketValue(rider) * SALARY_RATE));
}

// Altid-åben handel (launch-checklist punkt 16 · ejer-direktiv 2026-06-22 · #1310 punkt 6):
// transfervinduet er AFSKAFFET — ryttere kan skifte hold når som helst i sæsonen.
// Funktionen returnerer derfor ALTID true, så alle confirm-stier (transferExecution,
// auctionFinalization) registrerer med det samme (deferRegistration=false) og intet
// parkeres på pending_team_id af vindue-årsager.
//
// #1996: den modstridende getTransferWindowStatus() + admin open/close-endpoints (med
// den gamle "flush ved vindue-åbning") er fjernet, så der ikke længere findes to kilder
// til om markedet er åbent. Squad-cap håndhæves ved selve handlen (hard cap, ingen
// buffer) — se getIncomingSquadViolation. pending_team_id-parkeringen bevares som
// mekanik: den genbruges af etapeløb-udskudt-skifte (#1995), som parkerer når rytteren
// er i et aktivt etapeløb og flusher ved løbs-finalisering (ikke ved vindue-åbning).
// Signaturen (async, supabase-arg) bevares så ingen kaldere ændres.
export async function getTransferWindowOpen() {
  return true;
}

export async function getTeamMarketState(supabase, teamId) {
  const team = await expectSingle(
    supabase
      .from("teams")
      .select("id, name, balance, division, user_id")
      .eq("id", teamId)
  );

  const [riderCount, pendingCount, outgoingCount] = await Promise.all([
    // #1308: akademiryttere tæller ikke mod senior-cap
    expectCount(
      supabase
        .from("riders")
        .select("id", { count: "exact", head: true })
        .eq("team_id", teamId)
        .eq("is_academy", false)
    ),
    // #1308: akademiryttere tæller ikke mod senior-cap
    expectCount(
      supabase
        .from("riders")
        .select("id", { count: "exact", head: true })
        .eq("pending_team_id", teamId)
        .eq("is_academy", false)
    ),
    // #268: ryttere på vej VÆK fra holdet — ejet (team_id = mit) men med
    // pending_team_id sat til et andet hold (eller bank/AI). Disse skal
    // trækkes fra current-count for at få "fremtidens hold-størrelse".
    // #1308: akademiryttere tæller ikke mod senior-cap
    expectCount(
      supabase
        .from("riders")
        .select("id", { count: "exact", head: true })
        .eq("team_id", teamId)
        .eq("is_academy", false)
        .not("pending_team_id", "is", null)
        .neq("pending_team_id", teamId)
    ),
  ]);

  const squadLimits = getSquadLimits(team.division);
  // #268: future_count = ejede nu - på-vej-væk + på-vej-ind.
  // Matcher frontend's computeDashboardSquadStats (jf. #250) så squad-cap
  // checks bruger samme baseline som dashboard-tælleren manageren ser.
  const futureCount = riderCount - outgoingCount + pendingCount;

  return {
    ...team,
    rider_count: riderCount,
    pending_count: pendingCount,
    outgoing_count: outgoingCount,
    // total_count beholdes som legacy felt (current + pending, uden
    // outgoing-subtraktion) for at undgå at bryde kalde-sites der måtte
    // læse det direkte. Nye checks skal bruge future_count.
    total_count: riderCount + pendingCount,
    future_count: futureCount,
    squad_limits: squadLimits,
  };
}

// #267: softCapBuffer = ekstra ryttere over hard-cap'en der tillades MIDT i et
// åbent transfervindue. Defaulter til 0 (= hard-cap) for bagudkompat på
// callsites der ikke kender vindue-state. Brug TRANSFER_WINDOW_SOFT_CAP_BUFFER
// (2) når windowOpen er bekræftet — squadEnforcement-cron straffer
// over-cap-ryttere ved vindue-luk.
export function getIncomingSquadViolation(
  teamState,
  { incomingCount = 1, softCapBuffer = 0 } = {}
) {
  // #268: future_count trækker outgoing-pending ryttere fra inden vi tjekker
  // capacity, så pending-out (rytter solgt men ikke afregnet endnu) ikke
  // dobbelt-tæller mod cap. Falder tilbage til total_count for unit tests
  // og legacy-callsites der ikke har future_count.
  const baseCount = teamState?.future_count ?? teamState?.total_count ?? 0;
  const totalAfter = baseCount + incomingCount;
  const maxRiders = teamState?.squad_limits?.max || getSquadLimits(teamState?.division).max;
  const buffer = Number(softCapBuffer) || 0;
  const effectiveCap = maxRiders + buffer;

  if (totalAfter > effectiveCap) {
    return { totalAfter, maxRiders, effectiveCap, softCapBuffer: buffer };
  }

  return null;
}

export function getOutgoingSquadViolation(teamState, outgoingCount = 1) {
  const baseCount = teamState?.future_count ?? teamState?.total_count ?? 0;
  const totalAfter = baseCount - outgoingCount;
  // ?? (ikke ||) så en eksplicit min=0 ikke fejlagtigt falder tilbage til
  // division-defaulten — 0 er en gyldig (og nu normal) floor.
  const minRiders = teamState?.squad_limits?.min ?? getSquadLimits(teamState?.division).min;

  if (totalAfter < minRiders) {
    return { totalAfter, minRiders };
  }

  return null;
}
