// #7251 · Tilbagekøbsret for ryttere frigivet UDEN varsel ved S4→S5.
//
// Ejer 26/10 (valg A): ved S4→S5 stoppede kontraktvarslet ved PostgREST's
// 1.000-loft (#7246), så ~45 % af managerne aldrig fik "Contract expiring".
// Frigivelsen var korrekt. Kompensationen er en ret, ikke en massemutation:
// rytteren kan i 7 dage gen-signes af sit tidligere hold til normal løn, 1 sæson,
// uden signing fee. Manageren vælger selv.
//
// Hvem: (hold, rytter) i det FASTE snapshot `app_config.buyback_7251_snapshot`, taget
// 26/10 fra frigivelserne i S4→S5-vinduet uden en contract_expiring-besked for sæson 4.
// Snapshottet (ikke den levende indbakke) afgør retten, så en manager ikke kan slette et
// varsel og dermed få retten (Codex P1). Derudover: stadig fri (team_id og
// pending_team_id null), ikke pensioneret, ikke på en aktiv auktion, inden for 7 dage.
import { computeFrozenSalary, computeContractEndSeason } from "./contractSeed.js";
import { getTeamMarketState, getIncomingSquadViolation, expectMutationAffectingRows } from "./marketUtils.js";
import { SQUAD_CAPS, isYouthSquad, seniorSquadPatch } from "./squads.js";
import { buildContractExpiringNotification, notifyUser } from "./notificationService.js";
import { recordRiderOwnershipEvent, RIDER_OWNERSHIP_REASON } from "./riderOwnershipAudit.js";
import { SUPABASE_IN_CHUNK_SIZE, fetchAllRows } from "./supabasePagination.js";

export const BUYBACK_7251 = Object.freeze({
  // S4→S5-skiftet kørte 25/10 kl. 21:51 (Copenhagen). Vinduet dækker frigivelses-fasen.
  releasedFromIso: "2026-10-25T18:00:00Z",
  releasedToIso: "2026-10-26T00:00:00Z",
  windowDays: 7,
  warnedSeasonNumber: 4,
  contractLength: 1,
});

export const BUYBACK_7251_SNAPSHOT_KEY = "buyback_7251_snapshot";

/** Snapshottets rytter-id'er for holdet. Mangler snapshottet: tom liste (fail closed). */
async function loadSnapshotRiderIds({ supabase, teamId }) {
  const { data, error } = await supabase.from("app_config").select("value").eq("key", BUYBACK_7251_SNAPSHOT_KEY).maybeSingle();
  if (error) throw error;
  const pairs = Array.isArray(data?.value?.pairs) ? data.value.pairs : [];
  return new Set(pairs.filter((p) => Array.isArray(p) && p[0] === teamId).map((p) => p[1]));
}

export class BuybackError extends Error {
  constructor(code, status = 400, options = undefined) {
    super(code, options);
    this.code = code;
    this.status = status;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ren regel: må rytteren købes tilbage nu? Returnerer null eller en blokerings-kode. */
export function buybackBlockReason({ rider, releasedAt, warned, onActiveAuction, now }) {
  if (warned) return "buyback_not_eligible";
  if (!rider || rider.team_id != null || rider.pending_team_id != null) return "buyback_rider_not_free";
  if (rider.is_retired) return "buyback_rider_retired";
  if (onActiveAuction) return "buyback_rider_on_auction";
  const deadline = new Date(new Date(releasedAt).getTime() + BUYBACK_7251.windowDays * DAY_MS);
  if (!(now < deadline)) return "buyback_expired";
  return null;
}

async function activeSeasonNumber(supabase) {
  const { data, error } = await supabase
    .from("seasons").select("number").eq("status", "active")
    .order("number", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data?.number) throw new BuybackError("buyback_no_active_season", 409);
  return data.number;
}

/**
 * Holdets tilbagekøbs-kandidater: alle ryttere frigivet uden varsel i vinduet, med
 * deadline og en evt. blokerings-kode (så UI'et kan vise hvorfor en knap er slået fra).
 */
export async function loadBuybackCandidates({ supabase, team, now = new Date() }) {
  if (!team?.id || !team?.user_id) return [];
  const entitled = await loadSnapshotRiderIds({ supabase, teamId: team.id });
  if (entitled.size === 0) return [];
  const events = await fetchAllRows(() => supabase
    .from("rider_ownership_events")
    .select("id, rider_id, occurred_at")
    .eq("from_team_id", team.id)
    .eq("reason", RIDER_OWNERSHIP_REASON.RELEASE)
    .is("to_team_id", null)
    .gte("occurred_at", BUYBACK_7251.releasedFromIso)
    .lt("occurred_at", BUYBACK_7251.releasedToIso)
    .order("id"));
  const releasedAtByRider = new Map();
  for (const e of events) if (entitled.has(e.rider_id)) releasedAtByRider.set(e.rider_id, e.occurred_at);
  const riderIds = [...releasedAtByRider.keys()];
  if (riderIds.length === 0) return [];

  const riders = [];
  const onAuction = new Set();
  for (let i = 0; i < riderIds.length; i += SUPABASE_IN_CHUNK_SIZE) {
    const chunk = riderIds.slice(i, i + SUPABASE_IN_CHUNK_SIZE);
    const [riderRows, auctions] = await Promise.all([
      fetchAllRows(() => supabase.from("riders")
        .select("id, firstname, lastname, team_id, pending_team_id, is_retired, squad, current_production_value")
        .in("id", chunk).order("id")),
      fetchAllRows(() => supabase.from("auctions").select("id, rider_id").in("status", ["active", "extended"]).in("rider_id", chunk).order("id")),
    ]);
    riders.push(...riderRows);
    for (const a of auctions) onAuction.add(a.rider_id);
  }

  // Allerede købt tilbage: rytteren er på holdet igen og skal ikke stå som "signet af andre".
  return riders
    .filter((r) => r.team_id !== team.id)
    .map((r) => {
      const releasedAt = releasedAtByRider.get(r.id);
      const deadline = new Date(new Date(releasedAt).getTime() + BUYBACK_7251.windowDays * DAY_MS).toISOString();
      return {
        id: r.id,
        firstname: r.firstname,
        lastname: r.lastname,
        squad: r.squad,
        salary: computeFrozenSalary(r),
        released_at: releasedAt,
        deadline,
        blocked: buybackBlockReason({ rider: r, releasedAt, warned: false, onActiveAuction: onAuction.has(r.id), now }),
      };
    })
    .sort((a, b) => `${a.lastname}${a.firstname}`.localeCompare(`${b.lastname}${b.firstname}`));
}

async function assertSquadRoom({ supabase, teamId, squad }) {
  if (isYouthSquad(squad)) {
    const cap = SQUAD_CAPS[squad];
    const { count, error } = await supabase.from("riders").select("id", { count: "exact", head: true })
      .eq("team_id", teamId).eq("squad", squad).eq("is_retired", false);
    if (error) throw error;
    if (cap != null && (count ?? 0) + 1 > cap) throw new BuybackError("buyback_squad_full", 409);
    return;
  }
  const state = await getTeamMarketState(supabase, teamId);
  if (getIncomingSquadViolation(state, { softCapBuffer: 0 })) throw new BuybackError("buyback_squad_full", 409);
}

/** Gen-sign én rytter for holdet. Kaster BuybackError med en kode ved afvisning. */
export async function buybackRider({ supabase, team, riderId, now = new Date() }) {
  const candidates = await loadBuybackCandidates({ supabase, team, now });
  const candidate = candidates.find((c) => c.id === riderId);
  if (!candidate) throw new BuybackError("buyback_not_eligible", 404);
  if (candidate.blocked) throw new BuybackError(candidate.blocked, 409);
  await assertSquadRoom({ supabase, teamId: team.id, squad: candidate.squad });

  const seasonNumber = await activeSeasonNumber(supabase);
  const acquiredAt = now.toISOString();
  // team_id IS NULL i WHERE: en samtidig handel (auktion/anden manager) vinder, og vi
  // ser 0 rækker i stedet for at overskrive den (expectMutationAffectingRows kaster).
  await expectMutationAffectingRows(
    supabase.from("riders").update({
      team_id: team.id,
      pending_team_id: null,
      acquired_at: acquiredAt,
      salary: candidate.salary,
      contract_length: BUYBACK_7251.contractLength,
      contract_end_season: computeContractEndSeason(seasonNumber, BUYBACK_7251.contractLength),
      // squads.js: squad og is_academy skrives altid sammen (is_academy = squad <> senior).
      ...(isYouthSquad(candidate.squad) ? { squad: candidate.squad, is_academy: true } : seniorSquadPatch()),
    }).eq("id", riderId).is("team_id", null).is("pending_team_id", null),
    { context: `buyback_7251 team=${team.id} rider=${riderId}` },
  ).catch((err) => { throw new BuybackError("buyback_rider_not_free", 409, { cause: err }); }); // error-ok: expectMutationAffectingRows tjekker selv error og 0 rækker

  await recordRiderOwnershipEvent(supabase, {
    riderId,
    riderFirstname: candidate.firstname,
    riderLastname: candidate.lastname,
    fromTeamId: null,
    toTeamId: team.id,
    reason: RIDER_OWNERSHIP_REASON.FREE_AGENT_SIGNING,
    // CHECK-constraints (#3582): entitet manual, aktør api; kilden står i idempotency-nøglen.
    relatedEntityType: "manual",
    actorType: "api",
    actorId: team.user_id,
    occurredAt: acquiredAt,
    idempotencyKey: `ownership:buyback7251:${team.id}:${riderId}`,
  });
  // Kontrakten udløber i den aktive sæson: varsl straks (samme besked som auktionsstien),
  // så den tilbagekøbte rytter aldrig igen forsvinder ved næste skifte uden varsel.
  const endSeason = computeContractEndSeason(seasonNumber, BUYBACK_7251.contractLength);
  try {
    const riderName = `${candidate.firstname ?? ""} ${candidate.lastname ?? ""}`.trim();
    await notifyUser({ supabase, userId: team.user_id, ...buildContractExpiringNotification({ riderName, riderId, seasonNumber: endSeason }) });
  } catch { /* best-effort: selve signeringen er gennemført */ }
  return { rider_id: riderId, salary: candidate.salary, contract_end_season: endSeason };
}
