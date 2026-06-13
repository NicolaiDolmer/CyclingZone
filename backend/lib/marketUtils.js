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
    throw new Error(error.message);
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

export function calculateRiderMarketValue(rider = {}) {
  const explicit = Number(rider.market_value);
  if (Number.isFinite(explicit)) return explicit;
  const base = Number(rider.base_value) > 0 ? Number(rider.base_value) : RIDER_BASE_VALUE_FALLBACK;
  return base + (Number(rider.prize_earnings_bonus) || 0);
}

// Backend parity-twin af frontend getRiderSalary. Bruges af #1310-markeds-pakken (system-bølge-listings / prospektiv løn). Behold.
// #1309: frossen kontrakt-løn hvis sat; ellers estimat (10% af market_value) til
// VISNING af free agents. Ejede ryttere har altid salary != null (seed +
// on-acquire), så for dem returneres den frosne løn uændret. salary:0 er en
// gyldig (gratis) kontrakt og bevares som 0.
export function resolveRiderSalary(rider = {}) {
  if (rider && rider.salary != null) return Number(rider.salary);
  return Math.max(1, Math.round(calculateRiderMarketValue(rider) * 0.10));
}

export async function getTransferWindowOpen(supabase) {
  const latestWindow = await expectMaybeSingle(
    supabase
      .from("transfer_windows")
      .select("status")
      .order("created_at", { ascending: false })
      .limit(1)
  );

  return latestWindow?.status === "open";
}

export async function getTeamMarketState(supabase, teamId) {
  const team = await expectSingle(
    supabase
      .from("teams")
      .select("id, name, balance, division, user_id")
      .eq("id", teamId)
  );

  const [riderCount, pendingCount, outgoingCount, activeLoanCount] = await Promise.all([
    expectCount(
      supabase
        .from("riders")
        .select("id", { count: "exact", head: true })
        .eq("team_id", teamId)
    ),
    expectCount(
      supabase
        .from("riders")
        .select("id", { count: "exact", head: true })
        .eq("pending_team_id", teamId)
    ),
    // #268: ryttere på vej VÆK fra holdet — ejet (team_id = mit) men med
    // pending_team_id sat til et andet hold (eller bank/AI). Disse skal
    // trækkes fra current-count for at få "fremtidens hold-størrelse".
    expectCount(
      supabase
        .from("riders")
        .select("id", { count: "exact", head: true })
        .eq("team_id", teamId)
        .not("pending_team_id", "is", null)
        .neq("pending_team_id", teamId)
    ),
    // #19 audit: count "active" (running loan) + "window_pending" (accept parked
    // while window closed — rider stays on lender, so only this loan represents
    // the incoming rider). "buyout_pending" is DELIBERATELY excluded: a parked
    // buyout sets rider.pending_team_id = borrower, so it is already counted via
    // pendingCount above. Adding it here would double-count the rider against the
    // borrower's squad cap.
    expectCount(
      supabase
        .from("loan_agreements")
        .select("id", { count: "exact", head: true })
        .eq("to_team_id", teamId)
        .in("status", ["active", "window_pending"])
    ),
  ]);

  const squadLimits = getSquadLimits(team.division);
  // #268: future_count = ejede nu - på-vej-væk + på-vej-ind + aktive lån.
  // Matcher frontend's computeDashboardSquadStats (jf. #250) så squad-cap
  // checks bruger samme baseline som dashboard-tælleren manageren ser.
  const futureCount = riderCount - outgoingCount + pendingCount + activeLoanCount;

  return {
    ...team,
    rider_count: riderCount,
    pending_count: pendingCount,
    outgoing_count: outgoingCount,
    active_loan_count: activeLoanCount,
    // total_count beholdes som legacy felt (current + pending + loans, uden
    // outgoing-subtraktion) for at undgå at bryde kalde-sites der måtte
    // læse det direkte. Nye checks skal bruge future_count.
    total_count: riderCount + pendingCount + activeLoanCount,
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
