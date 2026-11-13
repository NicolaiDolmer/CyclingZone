// backend/lib/saleEscrowView6181.js
// #6181 · Det saelgeren SER af sine laaste salgspenge (ejerens udgave A, 13/11).
//
// Pengelogikken bor i saleEscrowFlow6181.js og roeres ikke herfra. Denne fil:
//
//   1. loadLockedSalesForTeam: den laesende vej til saelgers laaste beloeb (sale_escrows
//      med status 'held', hvor holdet er modtager). Menuen, dashboardet og Oekonomi
//      viser saldoen som det holdet kan bruge og "+X CZ$ laast" under den; Oekonomi
//      viser een linje pr. salg (rytter, loeb, hvor laenge loebet har tilbage, beloeb).
//      Kun eget hold (ruten giver req.team.id), samme adgang som resten af oekonomien.
//      Tabellen er service_role-only (M1); klienten laeser den aldrig direkte.
//
//   2. Saelgerens to beskeder (ejer-godkendte tekster 13/11):
//        ved handlen:      notif.saleEscrow.lockedMessage (kun naar handlen faktisk er laast)
//        ved udbetalingen: notif.saleEscrow.releasedTitle/releasedMessage
//      Er kontakten slukket, findes ingen holdt escrow for en ny handel, og alle
//      beskeder er praecis som foer.
//
// Refs #6181

import { copenhagenDateString } from "./copenhagenTime.js";
import { buildKeyedNotification } from "./notificationKeys.js";
import { notifyTeamOwner as notifyTeamOwnerDefault } from "./notificationService.js";

// Postgres 42P01 / PostgREST PGRST205: tabellen findes ikke (M1 ikke applied).
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);
// Et hold har faa aabne parkerede salg; loftet holder svaret under PostgRESTs graense.
const MAX_ROWS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

const errorMessage = (err) => (err instanceof Error ? err.message : String(err));

/** @param {{ firstname?: string|null, lastname?: string|null } | undefined} rider */
function riderName(rider) {
  return `${rider?.firstname ?? ""} ${rider?.lastname ?? ""}`.trim();
}

/**
 * De ryttere, saelgeren (modtageren) har solgt i handlen: dem, der skal til betaleren.
 * Transfer og auktion har een; et bytte har een i hver retning, og kun den ene er
 * modtagerens. Falder tilbage til alle, hvis formen er uventet.
 *
 * @param {{ rider_ids: string[], target_team_ids: string[], payer_team_id: string }} escrow
 * @returns {string[]}
 */
export function soldRiderIds(escrow) {
  const ids = (escrow.rider_ids || []).filter((_, i) => escrow.target_team_ids?.[i] === escrow.payer_team_id);
  return ids.length > 0 ? ids : [...(escrow.rider_ids || [])];
}

/**
 * Hele kalenderdage (dansk tid) fra nu til loebets sidste etape. 0 = i dag.
 * Negativt (sidste etape er passeret, loebet afsluttes) bliver 0.
 *
 * @param {string|Date|null|undefined} endsAt
 * @param {Date} now
 * @returns {number|null}
 */
export function daysUntil(endsAt, now) {
  if (!endsAt) return null;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return null;
  const a = Date.parse(`${copenhagenDateString(now)}T00:00:00Z`);
  const b = Date.parse(`${copenhagenDateString(end)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

/**
 * Det aktive etapeloeb pr. rytter (samme graense som stageRaceTransferDefer:
 * stage_race, ikke completed, stages_completed > 0) og hvornaar dets sidste etape koerer.
 * Koerer en rytter flere, gaelder det, der slutter sidst (flushen venter paa det).
 *
 * @param {any} supabase
 * @param {string[]} riderIds
 * @returns {Promise<Map<string, { id: string, name: string, endsAt: string|null }>>}
 */
async function activeStageRaceByRider(supabase, riderIds) {
  const result = new Map();
  if (riderIds.length === 0) return result;
  const { data: races, error: rErr } = await supabase
    .from("races")
    .select("id, name")
    .eq("race_type", "stage_race")
    .neq("status", "completed")
    .gt("stages_completed", 0);
  if (rErr) throw new Error(`loadLockedSalesForTeam: races lookup failed: ${rErr.message}`);
  if (!races?.length) return result;

  const raceIds = races.map((r) => r.id);
  const { data: entries, error: eErr } = await supabase
    .from("race_entries") // pagination-safe: kun holdets faa solgte ryttere (hoejst 2 pr. laast salg, MAX_ROWS salg) i de aktive etapeloeb.
    .select("race_id, rider_id")
    .in("race_id", raceIds)
    .in("rider_id", riderIds);
  if (eErr) throw new Error(`loadLockedSalesForTeam: entries lookup failed: ${eErr.message}`);
  if (!entries?.length) return result;

  const entryRaceIds = [...new Set(entries.map((e) => e.race_id))];
  const { data: stages, error: sErr } = await supabase
    .from("race_stage_schedule") // pagination-safe: kun de faa loeb, de solgte ryttere koerer (et etapeloeb har faa etaper).
    .select("race_id, scheduled_at")
    .in("race_id", entryRaceIds);
  if (sErr) throw new Error(`loadLockedSalesForTeam: stage schedule lookup failed: ${sErr.message}`);

  /** @type {Map<string, string>} */
  const lastStage = new Map();
  for (const s of stages || []) {
    if (!s?.scheduled_at) continue;
    const prev = lastStage.get(s.race_id);
    if (!prev || new Date(s.scheduled_at) > new Date(prev)) lastStage.set(s.race_id, s.scheduled_at);
  }
  const raceById = new Map(races.map((r) => [r.id, r]));
  for (const e of entries || []) {
    const race = raceById.get(e.race_id);
    if (!race) continue;
    const candidate = { id: race.id, name: race.name ?? "", endsAt: lastStage.get(race.id) ?? null };
    const prev = result.get(e.rider_id);
    if (!prev || (candidate.endsAt && (!prev.endsAt || new Date(candidate.endsAt) > new Date(prev.endsAt)))) {
      result.set(e.rider_id, candidate);
    }
  }
  return result;
}

/**
 * Saelgers laaste salg: hvert holdt sale_escrow, hvor holdet faar pengene.
 * Read-only. Manglende tabel = ingen laaste salg.
 *
 * @param {any} supabase  service-klienten
 * @param {string} teamId  saelgerens eget hold (fra req.team)
 * @param {{ now?: Date }} [opts]
 * @returns {Promise<{ total: number, sales: Array<{ id: string, dealType: string, riders: Array<{ id: string, name: string }>, race: { id: string, name: string } | null, endsAt: string|null, daysLeft: number|null, amount: number, lockedAt: string }> }>}
 */
export async function loadLockedSalesForTeam(supabase, teamId, { now = new Date() } = {}) {
  const empty = { total: 0, sales: [] };
  if (!teamId) return empty;
  const { data, error } = await supabase
    .from("sale_escrows")
    .select("id, deal_type, payer_team_id, amount, rider_ids, target_team_ids, created_at")
    .eq("payee_team_id", teamId)
    .eq("status", "held")
    .order("created_at", { ascending: true })
    .limit(MAX_ROWS);
  if (error) {
    if (MISSING_TABLE_CODES.has(error.code)) return empty;
    throw new Error(`loadLockedSalesForTeam: sale_escrows lookup failed: ${error.message}`);
  }
  const rows = Array.isArray(data) ? data.filter((e) => Array.isArray(e?.rider_ids) && Number(e.amount) > 0) : [];
  if (rows.length === 0) return empty;

  const sold = rows.map((e) => soldRiderIds(e));
  const allRiderIds = [...new Set(sold.flat())];
  const [{ data: riders, error: riderErr }, raceByRider] = await Promise.all([
    supabase.from("riders").select("id, firstname, lastname").in("id", allRiderIds), // pagination-safe: unikke rider-id'er, hoejst 2 pr. laast salg og MAX_ROWS salg.
    activeStageRaceByRider(supabase, allRiderIds),
  ]);
  if (riderErr) throw new Error(`loadLockedSalesForTeam: riders lookup failed: ${riderErr.message}`);
  const riderById = new Map((riders || []).map((r) => [r.id, r]));

  const sales = rows.map((e, i) => {
    // Et bytte kan have flere solgte ryttere; det loeb, der slutter sidst, afgoer udbetalingen.
    /** @type {{ id: string, name: string, endsAt: string|null } | null} */
    let race = null;
    for (const id of sold[i]) {
      const r = raceByRider.get(id);
      if (r && (!race || (r.endsAt && (!race.endsAt || new Date(r.endsAt) > new Date(race.endsAt))))) race = r;
    }
    return {
      id: e.id,
      dealType: e.deal_type,
      riders: sold[i].map((id) => ({ id, name: riderName(riderById.get(id)) })),
      race: race ? { id: race.id, name: race.name } : null,
      endsAt: race?.endsAt ?? null,
      daysLeft: race ? daysUntil(race.endsAt, now) : null,
      amount: Number(e.amount),
      lockedAt: e.created_at,
    };
  });
  return { total: sales.reduce((sum, s) => sum + s.amount, 0), sales };
}

export const SALE_ESCROW_FORCE_BLOCKED_ERROR =
  "Et sæsonskifte kan ikke tvinges igennem, mens der står låste salg (sale_escrows). Lad heal-sweepet afregne dem, og afgør fastlåste bytter via GET /api/admin/sale-escrows.";

/**
 * Ejer 13/11 (fast regel): et saesonskifte tvinges aldrig igennem, mens der staar
 * laaste salg. Ellers koerer loennen, foer saelgeren har faaet sine penge.
 * Antal holdte escrows til transition-rutens force-gren. Fail-closed: kan tabellen
 * ikke laeses, svares 1, saa force afvises. Manglende tabel = 0 (ingen laas findes).
 *
 * @param {any} supabase
 * @returns {Promise<number>}
 */
export async function countHeldSaleEscrowsForForce(supabase) {
  try {
    const { count, error } = await supabase
      .from("sale_escrows")
      .select("id", { count: "exact", head: true })
      .eq("status", "held");
    if (error) {
      if (MISSING_TABLE_CODES.has(error.code)) return 0;
      console.error(`[saleEscrow] force-spaerren kunne ikke laese sale_escrows, afviser force: ${error.message}`);
      return 1;
    }
    return Number(count) || 0;
  } catch (err) {
    // best-effort-laesning, fail-closed: hellere et afvist force end loen foer saelgers udbetaling.
    console.error(`[saleEscrow] force-spaerren fejlede, afviser force: ${errorMessage(err)}`);
    return 1;
  }
}

/**
 * Er saelgers penge for denne handel laast lige nu? Laeses efter betalingen, saa
 * den daekker baade JS-stien og RPC-stien (auto-accept betaler i selve RPC'en).
 * Kun en parkeret handel kan vaere laast; ellers spoerges der ikke. Fejl = false:
 * saa faar saelgeren beskeden fra foer, og handlen er allerede gennemfoert.
 *
 * @param {any} supabase
 * @param {{ parked: boolean, dealType: "transfer"|"auction"|"swap", dealId: string }} deal
 * @returns {Promise<boolean>}
 */
export async function isSaleLockedForDeal(supabase, { parked, dealType, dealId }) {
  if (!parked || !dealId) return false;
  try {
    const { data, error } = await supabase
      .from("sale_escrows")
      .select("status")
      .eq("deal_type", dealType)
      .eq("deal_id", dealId)
      .limit(1);
    if (error) {
      if (!MISSING_TABLE_CODES.has(error.code)) console.warn(`[saleEscrow] laast-opslag for ${dealType} ${dealId} fejlede: ${error.message}`);
      return false;
    }
    return Array.isArray(data) && data[0]?.status === "held";
  } catch (err) {
    // best-effort: kun beskedens ordlyd afhaenger af svaret; handlen og pengene er gennemfoert.
    console.warn(`[saleEscrow] laast-opslag for ${dealType} ${dealId} fejlede: ${errorMessage(err)}`);
    return false;
  }
}

/**
 * Saelgerens besked ved en laast handel. Titlen er den, saelgeren faar i dag for
 * samme handelstype; kun beskeden er ny.
 *
 * @param {{ riderName: string, price: number, riderId?: string|null, titleCode: string }} args
 */
export function buildSaleLockedSellerNotification({ riderName: name, price, riderId = null, titleCode }) {
  return buildKeyedNotification({
    titleCode,
    messageCode: "notif.saleEscrow.lockedMessage",
    messageParams: { riderName: name, price },
    metadata: riderId ? { riderId } : {},
  });
}

/**
 * Saelgerens besked, naar de laaste penge er udbetalt (rytteren har skiftet hold).
 * Kaldes efter et settle med status 'released'. Kaster aldrig: pengene er allerede
 * flyttet, og en manglende besked maa ikke ligne en fejlet udbetaling.
 *
 * @param {any} supabase
 * @param {{ id: string, payee_team_id: string, payer_team_id: string, amount: number|string, rider_ids: string[], target_team_ids: string[] }} escrow
 * @param {{ notifyTeamOwner?: typeof notifyTeamOwnerDefault }} [deps]
 * @returns {Promise<boolean>} true naar beskeden er sendt
 */
export async function notifySellerSaleEscrowReleased(supabase, escrow, { notifyTeamOwner = notifyTeamOwnerDefault } = {}) {
  try {
    if (!escrow?.id || !escrow.payee_team_id) return false;
    const ids = soldRiderIds(escrow);
    const { data: riders, error } = await supabase.from("riders").select("id, firstname, lastname").in("id", ids); // pagination-safe: een handels 1-2 ryttere.
    if (error) throw new Error(error.message);
    const byId = new Map((riders || []).map((r) => [r.id, r]));
    const names = ids.map((id) => riderName(byId.get(id))).filter(Boolean).join(", ");
    const notice = buildKeyedNotification({
      titleCode: "notif.saleEscrow.releasedTitle",
      messageCode: "notif.saleEscrow.releasedMessage",
      messageParams: { riderName: names, amount: Number(escrow.amount) },
      metadata: { riderId: ids[0] ?? null, saleEscrowId: escrow.id },
    });
    await notifyTeamOwner({
      supabase,
      teamId: escrow.payee_team_id,
      type: "transfer_offer_accepted",
      title: notice.title,
      message: notice.message,
      relatedId: escrow.id,
      metadata: notice.metadata,
    });
    return true;
  } catch (err) {
    // best-effort: udbetalingen er sket i settle_sale_escrow; kun beskeden mangler.
    console.error(`[saleEscrow] udbetalings-besked til saelger for ${escrow?.id} fejlede: ${errorMessage(err)}`);
    return false;
  }
}
