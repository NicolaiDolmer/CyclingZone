// backend/lib/saleEscrowFlow6181.js
// #6181 PR 3 · Pengelaas: kalderne af sale_escrows (M1, database/2026-11-07-6181-sale-escrow-m1.sql).
//
// Problemet: naar et holdskifte parkeres (rytteren koerer et etapeloeb faerdigt for
// saelger, #1995), betaler koeberen ved handlen, og saelger krediteres i dag med det
// samme. Saelger kan saa bruge pengene, foer koeberen har faaet rytteren. Med kontakten
// sale_escrow_enabled taendt ligger beloebet i stedet i sale_escrows, og saelger
// krediteres foerst, naar rytteren faktisk skifter hold (ejer-beslutning 1, 7/11).
// Ved oejeblikkeligt skifte bruges escrow ikke; den sti er uaendret.
//
// To slags kode, bevidst adskilt:
//
//   OPRETTELSE og de varme afregningsstier (handel, bytte, auktion, flush,
//   pension/kontraktudloeb) er bag kontakten. Slukket returnerer de deres
//   no-op-vaerdi (fx den uaendrede incrementBalanceWithAudit), saa adfaerden er
//   den samme som foer PR 3. saleEscrowFlow6181.pglite.test.js beviser det.
//
//   SIKKERHEDSNETTET (reconcileHeldSaleEscrows, kaldt af heal-sweepet hvert 5. min,
//   og beta-reset) er IKKE bag kontakten. En escrow, der blev holdt mens kontakten
//   var taendt, skal afregnes, ogsaa hvis kontakten slukkes igen; ellers ville
//   pengene blive staaende. Er tabellen tom, laeser nettet een raekke-liste og
//   skriver intet.
//
// Al pengebevaegelse sker i de to RPC'er (hold_sale_escrow / settle_sale_escrow),
// hver i een transaktion. Koden her beslutter kun HVORNAAR og sender payloads.
//
// Refs #6181 #2176 #7871

import { incrementBalanceWithAudit } from "./balanceRpc.js";
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { FINANCE_ACTOR_TYPE } from "./economyConstants.js";

export const SALE_ESCROW_FLAG_KEY = "sale_escrow_enabled";

const DEAL_TYPES = new Set(["transfer", "auction", "swap"]);
// Samme noegler som M1's sale_escrow_finance_key og de nuvaerende stier.
const FINANCE_KEY_PREFIX = Object.freeze({
  transfer: { payer: "transfer_buyer:", payee: "transfer_seller:" },
  auction: { payer: "auction_winner:", payee: "auction_seller:" },
  swap: { payer: "swap_payer:", payee: "swap_receiver:" },
});
// hold_sale_escrow: 'held' = ny escrow, 'exists' = handlen er allerede gennem
// escrow-stien (gentagelse). Begge betyder, at den gamle sti ikke maa betale.
const HOLD_HANDLED = new Set(["held", "exists"]);
// Postgres 42P01 / PostgREST PGRST205: tabellen findes ikke endnu (M1 ikke applied).
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);
// PostgRESTs svarloft. Holdte escrows er faa (aabne parkerede salg); naar listen
// rammer loftet, er svaret maaske afskaaret, og opslaget fejler i stedet.
const MAX_HELD_ROWS = 1000;
const RIDER_CHUNK = 200;
// Slukket/ikke parkeret: den uaendrede betaling.
const DIRECT_PAYMENT = Object.freeze({ incrementBalanceWithAudit });
// Ejer-krav 1 (#7871): handlen har allerede en escrow (held/released). Koeberen er
// trukket af hold_sale_escrow, og saelger krediteres af settle_sale_escrow, saa en
// gentagelse af handlen maa ikke betale nogen af de to ben igen.
const PAID_BY_EXISTING_ESCROW = Object.freeze({
  incrementBalanceWithAudit: async function paidByExistingSaleEscrow() {
    return { skipped: true, balance: null, escrowExisting: true };
  },
});
const ESCROW_COLUMNS = "id, deal_type, deal_id, payer_team_id, payee_team_id, amount, rider_ids, target_team_ids, delivered_rider_ids, status, created_at";
// M1-review krav 5 (#7871): RPC'erne laaser hold foer ryttere. En sti, der laaser i
// omvendt raekkefoelge, kan give en deadlock; Postgres afbryder saa den ene
// transaktion helt (intet er sket), og kaldet proeves igen.
const RETRYABLE_LOCK_CODES = new Set(["40P01", "40001"]);
const RPC_ATTEMPTS = 3;

/** @param {any} client @param {string} name @param {Record<string, unknown>} args @returns {Promise<{ data: any, error: any }>} */
async function rpcWithLockRetry(client, name, args) {
  let result = await client.rpc(name, args);
  for (let attempt = 2; attempt <= RPC_ATTEMPTS && result.error && RETRYABLE_LOCK_CODES.has(result.error.code); attempt += 1) {
    console.warn(`[saleEscrow] ${name}: ${result.error.code}, proever igen (${attempt}/${RPC_ATTEMPTS})`);
    result = await client.rpc(name, args);
  }
  return result;
}

/**
 * Codex P1 (#7874): foer-billedet af trup-felterne for en rytter, hvis handel
 * graduerer ham allerede ved parkeringen (seniorSquadPatch). Refunderes handlen,
 * gendanner M2-triggeren det. null, naar handlen ikke aendrer trup-felterne.
 *
 * @param {{ is_academy?: boolean|null, squad?: string|null, salary?: number|null, contract_length?: number|null, contract_end_season?: number|null }} rider  foer handlen
 * @param {Record<string, unknown>} patch  den trup-patch, handlen skriver
 * @returns {{ is_academy?: boolean, squad?: string, salary?: number|null, contract_length?: number|null, contract_end_season?: number|null } | null}
 */
export function squadRestoreImage(rider, patch) {
  // Tjekliste 9/11: samme betingelse som contractOnAcquirePatch. Handlen skriver en
  // ny kontrakt paa en kontraktloes rytter, og en refusion skal fjerne den igen.
  // Uden salary i kalderens SELECT vides intet, og en kontrakt maa aldrig slettes paa gaet.
  const contractWritten = Boolean(rider) && "salary" in rider && (rider.salary == null || rider.contract_end_season == null);
  const squadWritten = Boolean(patch) && Object.keys(patch).length > 0;
  if (!squadWritten && !contractWritten) return null;
  return {
    ...(squadWritten ? { is_academy: rider?.is_academy === true, ...(typeof rider?.squad === "string" ? { squad: rider.squad } : {}) } : {}),
    // contract_length er ikke i handlernes SELECT. Uden loen findes ingen kontrakt, saa
    // null er det rigtige foer-billede; med loen vides laengden ikke og roeres ikke.
    ...(contractWritten ? {
      salary: rider?.salary ?? null,
      contract_end_season: rider?.contract_end_season ?? null,
      ...("contract_length" in rider ? { contract_length: rider.contract_length ?? null } : rider.salary == null ? { contract_length: null } : {}),
    } : {}),
  };
}

/**
 * Tjekliste 9/11: laasen fejlede, efter at handlen parkerede rytterne. Uden dette
 * stod de parkeret uden betaling, og flushen flyttede dem senere gratis.
 * Fejler selve fortrydelsen, logges det, og den oprindelige fejl kastes videre.
 *
 * @param {any} client
 * @param {{ dealType: string, dealId: string, payerTeamId: string, payeeTeamId: string, riderIds: string[], targetTeamIds: string[], restore: Record<string, unknown> }} deal
 */
async function undoParkingAfterFailedHold(client, { dealType, dealId, payerTeamId, payeeTeamId, riderIds, targetTeamIds, restore }) {
  const { data, error } = await rpcWithLockRetry(client, "sale_escrow_undo_failed_hold", {
    p_deal_type: dealType,
    p_deal_id: dealId,
    p_payer_team_id: payerTeamId,
    p_payee_team_id: payeeTeamId,
    p_rider_ids: riderIds,
    p_target_team_ids: targetTeamIds,
    p_rider_restore: restore,
  });
  if (error) {
    console.error(`[saleEscrow] ${dealType} ${dealId}: parkeringen kunne ikke fjernes efter en fejlet laas: ${error.message}`);
    return;
  }
  console.warn(`[saleEscrow] ${dealType} ${dealId}: laasen fejlede, parkering fortrudt (${data?.status})`);
}

/**
 * Kontakten. Kun 'on' (eller true) taender; 'beta' er slukket, fordi det er penge.
 * Laeses friskt (et sluk virker med det samme); refusions-loekker i saesonskiftet
 * bruger den korte cache. Fejl giver slukket (featureStage).
 */
export async function isSaleEscrowEnabled(supabase, { fresh = true } = {}) {
  return evaluateFlagStage(await readFlagStage(supabase, SALE_ESCROW_FLAG_KEY, { fresh }));
}

/**
 * Betaling til en handel: et objekt med metoden incrementBalanceWithAudit (samme
 * signatur), saa kalderen kun saetter objektet foran kaldet, og audit-vagten
 * (auditTrail.test.js) stadig ser og tjekker hvert penge-kaldsted:
 *
 *   const payment = await saleEscrowPayment(supabase, { parked, dealType, dealId, riderIds, targetTeamIds });
 *   await payment.incrementBalanceWithAudit(supabase, koeberens traek, opts);
 *   await payment.incrementBalanceWithAudit(supabase, saelgers kredit, opts);
 *
 * Ikke parkeret eller kontakten slukket: metoden ER incrementBalanceWithAudit
 * (samme funktion, samme kald, samme raekkefoelge som foer).
 *
 * Parkeret og taendt: de to ben samles og sendes som EET hold_sale_escrow-kald
 * (koeber traekkes, beloebet laases). Kan escrow ikke bruges (rytteren er ikke
 * laengere parkeret mod koeberen, fx fordi loebet sluttede imellem, eller den gamle
 * sti har allerede betalt saelger), betales de to ben som foer. Det er korrekt i
 * begge tilfaelde: en leveret rytter maa gerne betales med det samme, og
 * finance-noeglerne goer gentagelser harmloese.
 *
 * Kalderen maa kun saette parked=true, naar begge ben kommer (der er en saelger
 * og et positivt beloeb).
 *
 * priorEscrow (ejer-krav 1, #7871) er svaret fra saleEscrowStatusForDeal, laest af
 * kalderen FOER rytteren flyttes. Har handlen allerede en escrow (held/released),
 * betales intet af den gamle sti, uanset kontakt og parkering: escrow'en ejer
 * pengene. Refunderet = handlen er annulleret, og kalderen skal have stoppet foer
 * rytteren blev flyttet; her kastes der som sidste vaern. Den endelige garanti er
 * databasens: triggeren fra M2 afviser en saelger-kredit efter en refusion under
 * holdlaasen. "none" (eller udeladt) = adfaerden fra foer.
 *
 * riderRestore (Codex P1, #7874) er foer-billedet pr. rytter (samme raekkefoelge
 * som riderIds, fra squadRestoreImage; null = intet at gendanne). Det gemmes i
 * escrow'en, og en refusion gendanner trup-status for en rytter, der bliver hos
 * sit hold.
 *
 * Ejerskab og raad (M1-review krav 3): kalderen har tjekket begge under handlen
 * (saelger ejer rytteren, koeber har raad), som den direkte sti. hold_sale_escrow
 * tjekker desuden, at et parkeret ben staar paa sit kildehold.
 *
 * @param {any} supabase
 * @param {{ parked: boolean, dealType: "transfer"|"auction"|"swap", dealId: string, riderIds: string[], targetTeamIds: string[], priorEscrow?: "none"|"held"|"released"|"refunded", riderRestore?: Array<Record<string, unknown>|null> }} deal
 * @returns {Promise<{ incrementBalanceWithAudit: typeof incrementBalanceWithAudit }>}
 */
export async function saleEscrowPayment(supabase, { parked, dealType, dealId, riderIds, targetTeamIds, priorEscrow = "none", riderRestore = [] }) {
  if (priorEscrow === "refunded") {
    throw new Error(`saleEscrowPayment: ${dealType} ${dealId} er refunderet til koeberen; handlen betales ikke igen`);
  }
  if (priorEscrow === "held" || priorEscrow === "released") return PAID_BY_EXISTING_ESCROW;
  if (!parked) return DIRECT_PAYMENT;
  if (!(await isSaleEscrowEnabled(supabase))) return DIRECT_PAYMENT;
  if (!DEAL_TYPES.has(dealType) || !dealId) {
    throw new Error(`saleEscrowPayment: ukendt handel ${dealType}/${dealId}`);
  }

  const legs = [];
  return { incrementBalanceWithAudit: async function payThroughSaleEscrow(client, leg, options = {}) {
    legs.push({ leg, options });
    if (legs.length === 1) return { skipped: false, balance: null, escrowPending: true };
    if (legs.length > 2) throw new Error("saleEscrowPayment: en handel har kun to ben");

    const payer = legs.find((l) => l.leg.delta < 0);
    const payee = legs.find((l) => l.leg.delta > 0);
    /** @type {Record<string, unknown>} */
    const restore = {};
    riderIds.forEach((riderId, i) => { if (riderRestore[i]) restore[riderId] = riderRestore[i]; });

    // Svaret paa laasen: et resultat, eller "pay" naar den gamle sti skal betale. Alt,
    // der kaster herinde, betyder at ingen penge er flyttet, mens rytterne er parkeret.
    const lockLegs = async () => {
      if (!payer || !payee || payer.leg.delta !== -payee.leg.delta) {
        throw new Error(`saleEscrowPayment: ${dealType} ${dealId} skal have eet traek og een kredit med samme beloeb`);
      }
      const keys = FINANCE_KEY_PREFIX[dealType];
      if (payer.leg.payload?.idempotency_key !== `${keys.payer}${dealId}`
        || payee.leg.payload?.idempotency_key !== `${keys.payee}${dealId}`) {
        throw new Error(`saleEscrowPayment: ${dealType} ${dealId} bruger ikke de faste finance-noegler`);
      }
      const { data, error } = await rpcWithLockRetry(client, "hold_sale_escrow", {
        p_deal_type: dealType,
        p_deal_id: dealId,
        p_payer_team_id: payer.leg.teamId,
        p_payee_team_id: payee.leg.teamId,
        p_amount: payee.leg.delta,
        p_rider_ids: riderIds,
        p_target_team_ids: targetTeamIds,
        p_payer_payload: payer.leg.payload,
        p_payee_payload: payee.leg.payload,
        p_rider_restore: restore,
      });
      if (error) throw error;
      if (HOLD_HANDLED.has(data?.status)) {
        return { skipped: false, balance: null, escrow: data };
      }

      // Uden escrow maa der kun betales, naar det er sikkert: den gamle sti har allerede
      // krediteret saelger (gentagelse), eller alle ryttere er faktisk leveret. Ellers
      // (parkeringen forsvandt, eller rytteren er i en anden laast handel) flyttes ingen
      // penge, og handlen fejler hoejt i stedet for at betale for en rytter, der ikke kom.
      if (data?.status !== "payee_already_credited") {
        const states = await loadRiderStates(client, riderIds);
        const delivered = riderIds.every((rid, i) => states.get(rid)?.team_id === targetTeamIds[i]);
        if (data?.status !== "not_parked" || !delivered) {
          throw new Error(`saleEscrowPayment: ${dealType} ${dealId} kan hverken laases eller betales (${data?.status ?? "ukendt"})`);
        }
      }
      console.warn(`[saleEscrow] ${dealType} ${dealId}: ${data?.status}, betales uden escrow`);
      return "pay";
    };

    let locked;
    try {
      locked = await lockLegs();
    } catch (err) {
      await undoParkingAfterFailedHold(client, {
        dealType, dealId, riderIds, targetTeamIds, restore,
        payerTeamId: payer?.leg.teamId ?? legs[0].leg.teamId,
        payeeTeamId: payee?.leg.teamId ?? legs[1].leg.teamId,
      });
      throw err;
    }
    if (locked !== "pay") return locked;
    await incrementBalanceWithAudit(client, payer.leg, payer.options);
    return incrementBalanceWithAudit(client, payee.leg, payee.options);
  } };
}

/**
 * Alle holdte escrows (eller dem, der indeholder en af riderIds). Populationen er
 * lille (aabne parkerede salg), saa der filtreres i JS.
 *
 * @param {any} supabase
 * @param {{ riderIds?: string[] | null }} [opts]
 * @returns {Promise<{ rows: any[], error: any }>} manglende tabel = ingen escrows.
 */
export async function fetchHeldSaleEscrows(supabase, { riderIds = null } = {}) {
  const { data, error } = await supabase
    .from("sale_escrows")
    .select(ESCROW_COLUMNS)
    .eq("status", "held")
    .order("id");
  if (error) {
    if (MISSING_TABLE_CODES.has(error.code)) return { rows: [], error: null };
    return { rows: [], error };
  }
  // Fail-closed: et afskaaret svar maa aldrig se ud som "ingen escrows".
  if (Array.isArray(data) && data.length >= MAX_HELD_ROWS) {
    return { rows: [], error: { message: `mindst ${MAX_HELD_ROWS} holdte escrows; opslaget skal pagineres` } };
  }
  const rows =Array.isArray(data) ? data.filter((e) => e?.status === "held" && Array.isArray(e.rider_ids)) : [];
  if (!riderIds) return { rows, error: null };
  const wanted = new Set(riderIds);
  return { rows: rows.filter((e) => e.rider_ids.some((id) => wanted.has(id))), error: null };
}

/**
 * Ejer-krav 1 (#7871): har denne handel en escrow, og hvilken status? Laeses af
 * handels-stierne FOER rytteren flyttes, saa en gentagelse af handlen efter en
 * refusion hverken flytter rytteren igen eller krediterer saelger (koeberens traek
 * ville springes over som dublet, saelgers kredit ikke: penge ville opstaa). IKKE
 * bag kontakten: en escrow fra en taendt periode gaelder ogsaa efter et sluk.
 * Fail-closed: en laesefejl kaster (handlen stopper, foer noget flyttes).
 *
 * @param {any} supabase
 * @param {{ dealType: "transfer"|"auction"|"swap", dealId: string }} deal
 * @returns {Promise<"none"|"held"|"released"|"refunded">}
 */
export async function saleEscrowStatusForDeal(supabase, { dealType, dealId }) {
  if (!DEAL_TYPES.has(dealType) || !dealId) {
    throw new Error(`saleEscrowStatusForDeal: ukendt handel ${dealType}/${dealId}`);
  }
  // UNIQUE (deal_type, deal_id) i M1: hoejst een raekke.
  const { data, error } = await supabase
    .from("sale_escrows")
    .select("status")
    .eq("deal_type", dealType)
    .eq("deal_id", dealId)
    .limit(1);
  if (error) {
    if (MISSING_TABLE_CODES.has(error.code)) return "none";
    throw new Error(`sale_escrows-opslag for ${dealType} ${dealId} fejlede: ${error.message}`);
  }
  const status = Array.isArray(data) ? data[0]?.status : undefined;
  return status === "held" || status === "released" || status === "refunded" ? status : "none";
}

/** @param {unknown} err */
const errorMessage = (err) => (err instanceof Error ? err.message : String(err));

/** @param {any} supabase @param {string[]} riderIds @returns {Promise<Map<string, any>>} */
async function loadRiderStates(supabase, riderIds) {
  const ids = [...new Set(riderIds)];
  const states = new Map();
  // Bidder under PostgRESTs svarloft, saa en manglende raekke kun kan betyde en slettet rytter.
  for (let i = 0; i < ids.length; i += RIDER_CHUNK) {
    const { data, error } = await supabase
      .from("riders") // pagination-safe: unique riders.id IN at most RIDER_CHUNK (200) ids, below the response cap.
      .select("id, team_id, pending_team_id")
      .in("id", ids.slice(i, i + RIDER_CHUNK));
    if (error) throw new Error(`saleEscrow: rytteropslag fejlede: ${error.message}`);
    for (const r of data || []) states.set(r.id, r);
  }
  return states;
}

/**
 * Hvad skal der ske med en holdt escrow? Ren funktion.
 *   release: alle ryttere er leveret (varigt bevis eller staar paa maalholdet).
 *   refund:  ingen er leveret, og mindst een kan ikke laengere leveres (parkeringen
 *            er vaek: pension, kontraktudloeb, reset, admin). Handlen er annulleret.
 *   wait:    resten venter parkeret mod maalholdet (flushen flytter dem).
 *   stuck:   et bytte, hvor een rytter er leveret og den anden ikke kan leveres.
 *            Kraever et menneske; ownershipInvariantWatch melder det, og admin
 *            afgoer det med resolveStuckSaleEscrow (ejer-krav 2, #7871).
 *
 * @param {{ rider_ids: string[], target_team_ids: string[], delivered_rider_ids?: string[] }} escrow
 * @param {Map<string, { team_id?: string|null, pending_team_id?: string|null }>} ridersById
 * @returns {"release"|"refund"|"wait"|"stuck"}
 */
export function classifyHeldEscrow(escrow, ridersById) {
  const delivered = new Set(escrow.delivered_rider_ids || []);
  let nDelivered = 0;
  let nBroken = 0;
  escrow.rider_ids.forEach((riderId, i) => {
    const target = escrow.target_team_ids[i];
    const rider = ridersById.get(riderId);
    if (delivered.has(riderId) || (rider && rider.team_id === target)) nDelivered += 1;
    else if (!rider || rider.pending_team_id !== target) nBroken += 1;
  });
  if (nDelivered === escrow.rider_ids.length) return "release";
  if (nBroken > 0) return nDelivered === 0 ? "refund" : "stuck";
  return "wait";
}

function refundPayload(sourcePath) {
  return {
    type: "transfer_in",
    description: "Refusion af handel, rytteren skiftede ikke hold",
    metadata: { code: "tx.saleEscrowRefund", params: {} },
    actor_type: FINANCE_ACTOR_TYPE.CRON,
    actor_id: null,
    source_path: sourcePath,
  };
}

/** @param {any} supabase @param {string} escrowId @param {"release"|"refund"} outcome @param {{ at: string, sourcePath: string }} opts */
async function settle(supabase, escrowId, outcome, { at, sourcePath }) {
  const { data, error } = await rpcWithLockRetry(supabase, "settle_sale_escrow", {
    p_escrow_id: escrowId,
    p_outcome: outcome,
    p_refund_payload: outcome === "refund" ? refundPayload(sourcePath) : null,
    p_settled_at: at,
  });
  if (error) throw new Error(`settle_sale_escrow(${escrowId}, ${outcome}) fejlede: ${error.message}`);
  return data;
}

/**
 * Flush af EEN parkeret rytter (flushParkedRider) med escrow. Returnerer null, naar
 * den almindelige flush skal koere (kontakten slukket, ingen escrow, eller et bytte
 * hvor den anden rytter stadig venter: den almindelige flush flytter rytteren, og
 * triggeren noterer leveringen). Ellers flytter settle_sale_escrow rytteren og
 * krediterer saelger i een transaktion, og svaret har samme form som
 * riders.update(...).select("id"): { data: [{ id }] | [], error }.
 *
 * @param {any} supabase
 * @param {{ id: string, pending_team_id: string }} rider
 * @param {{ flushedAt: string }} opts
 */
export async function releaseSaleEscrowForFlush(supabase, rider, { flushedAt }) {
  if (!(await isSaleEscrowEnabled(supabase))) return null;
  const { rows, error } = await fetchHeldSaleEscrows(supabase, { riderIds: [rider.id] });
  if (error) {
    // Rytteren flyttes alligevel; heal-sweepets reconcile afregner escrow'en bagefter.
    console.warn(`[saleEscrow] escrow-opslag fejlede for ${rider.id}, almindelig flush: ${error.message}`);
    return null;
  }
  // Rytteren kan staa i to holdte escrows: leveret i et bytte, hvis andet ben stadig
  // venter, og solgt videre af sin nye ejer. Kun den, han endnu ikke er leveret i,
  // og som peger paa hans parkering, gaelder.
  const escrow = rows.find((e) => !(e.delivered_rider_ids || []).includes(rider.id)
    && e.target_team_ids[e.rider_ids.indexOf(rider.id)] === rider.pending_team_id);
  if (!escrow) return null;

  // Et bytte frigives foerst, naar begge ryttere er flyttet.
  const others = escrow.rider_ids.filter((id) => id !== rider.id);
  if (others.length > 0) {
    const states = await loadRiderStates(supabase, others);
    const delivered = new Set(escrow.delivered_rider_ids || []);
    const allOthersDelivered = others.every((id) => {
      const target = escrow.target_team_ids[escrow.rider_ids.indexOf(id)];
      return delivered.has(id) || states.get(id)?.team_id === target;
    });
    if (!allOthersDelivered) return null;
  }

  const { data, error: rpcError } = await rpcWithLockRetry(supabase, "settle_sale_escrow", {
    p_escrow_id: escrow.id,
    p_outcome: "release",
    p_refund_payload: null,
    p_settled_at: flushedAt,
  });
  if (rpcError) return { data: null, error: rpcError };
  if (data?.status !== "released") return null;
  const moved = Array.isArray(data.moved_rider_ids) && data.moved_rider_ids.includes(rider.id);
  return { data: moved ? [{ id: rider.id }] : [], error: null };
}

/**
 * Hul 6: pension og kontraktudloeb frigiver en rytter og nulstiller parkeringen.
 * Kaldes EFTER frigivelsen: en holdt escrow for rytteren kan saa ikke leveres, og
 * koeberen faar pengene tilbage (settle_sale_escrow refund, een transaktion).
 * Bag kontakten; slukket goer den intet. Kaster ikke: en fejl logges, og
 * heal-sweepets reconcile refunderer bagefter.
 *
 * @param {any} supabase
 * @param {string[]} riderIds
 * @param {{ now?: Date, sourcePath?: string }} [opts]
 * @returns {Promise<{ refunded: number, failed: number }>}
 */
export async function refundSaleEscrowsForReleasedRiders(supabase, riderIds, { now = new Date(), sourcePath = "saleEscrowFlow6181.refund" } = {}) {
  const stats = { refunded: 0, failed: 0 };
  if (!riderIds?.length || !(await isSaleEscrowEnabled(supabase, { fresh: false }))) return stats;
  try {
    const { rows, error } = await fetchHeldSaleEscrows(supabase, { riderIds });
    if (error) throw new Error(error.message);
    if (rows.length === 0) return stats;
    const states = await loadRiderStates(supabase, rows.flatMap((e) => e.rider_ids));
    for (const escrow of rows) {
      if (classifyHeldEscrow(escrow, states) !== "refund") continue;
      const result = await settle(supabase, escrow.id, "refund", { at: now.toISOString(), sourcePath });
      if (result?.status === "refunded") stats.refunded += 1;
    }
  } catch (err) {
    // best-effort: frigivelsen er allerede sket; reconcile i heal-sweepet refunderer inden for 5 min.
    stats.failed += 1;
    console.error(`[saleEscrow] refusion fejlede (${sourcePath}), reconcile tager den:`, errorMessage(err));
  }
  return stats;
}

/**
 * Sikkerhedsnettet: afregn enhver holdt escrow, der kan afregnes nu (release eller
 * refund efter classifyHeldEscrow). Ikke bag kontakten (se fil-headeren).
 * Idempotent: settle_sale_escrow afregner hoejst een gang. Hver escrow er isoleret.
 *
 * @returns {Promise<{ checked: number, released: number, refunded: number, waiting: number, stuck: number, failed: number, errors: Array<{ escrowId: string|null, message: string }> }>}
 */
/** @param {{ supabase: any, now?: Date, sourcePath?: string }} args */
export async function reconcileHeldSaleEscrows({ supabase, now = new Date(), sourcePath = "saleEscrowFlow6181.reconcile" }) {
  /** @type {{ checked: number, released: number, refunded: number, waiting: number, stuck: number, failed: number, errors: Array<{ escrowId: string|null, message: string }> }} */
  const result = { checked: 0, released: 0, refunded: 0, waiting: 0, stuck: 0, failed: 0, errors: [] };
  const { rows, error } = await fetchHeldSaleEscrows(supabase);
  if (error) {
    result.failed += 1;
    result.errors.push({ escrowId: null, message: `sale_escrows-opslag fejlede: ${error.message}` });
    return result;
  }
  if (rows.length === 0) return result;
  result.checked = rows.length;

  let states;
  try {
    states = await loadRiderStates(supabase, rows.flatMap((e) => e.rider_ids));
  } catch (err) {
    // best-effort: taelles i failed/errors, som cron-wrapperen sender til Sentry; naeste koersel proever igen.
    result.failed += 1;
    result.errors.push({ escrowId: null, message: errorMessage(err) });
    console.error("[saleEscrow] reconcile kunne ikke laese rytterne:", errorMessage(err));
    return result;
  }
  const at = now.toISOString();
  for (const escrow of rows) {
    const action = classifyHeldEscrow(escrow, states);
    if (action === "wait") { result.waiting += 1; continue; }
    if (action === "stuck") { result.stuck += 1; continue; }
    try {
      const settled = await settle(supabase, escrow.id, action, { at, sourcePath });
      if (settled?.status === "released") result.released += 1;
      else if (settled?.status === "refunded") result.refunded += 1;
    } catch (err) {
      // best-effort: een escrow maa ikke stoppe resten; taelles i failed/errors (Sentry via cron-wrapperen).
      result.failed += 1;
      result.errors.push({ escrowId: escrow.id, message: errorMessage(err) });
      console.error(`[saleEscrow] reconcile af ${escrow.id} fejlede:`, errorMessage(err));
    }
  }
  return result;
}

/**
 * Codex P1 (#7874, tjekliste 9/11): de holdte escrows, der ville sidde fast efter
 * en fuld beta-nulstilling. Nulstillingen fjerner parkeringerne, saa et bytte med
 * een leveret rytter ikke laengere kan afregnes automatisk. Tomt Map = den tilstand,
 * hvor kun det varige leveringsbevis staar tilbage. Fail-closed: en laesefejl kaster.
 *
 * @param {any} supabase
 * @returns {Promise<string[]>} escrow-id'er
 */
export async function findSaleEscrowsBlockingBetaReset(supabase) {
  const { rows, error } = await fetchHeldSaleEscrows(supabase);
  if (error) throw new Error(`sale_escrows-opslag fejlede: ${error.message}`);
  if (rows.length === 0) return [];
  const states = await loadRiderStates(supabase, rows.flatMap((e) => e.rider_ids));
  const afterReset = new Map();
  return rows
    .filter((e) => classifyHeldEscrow(e, states) === "stuck" || classifyHeldEscrow(e, afterReset) === "stuck")
    .map((e) => e.id);
}

/**
 * Ejer-krav 2 (#7871): oversigt til admin over holdte escrows med den handling,
 * reconcile ville tage (release/refund/wait/stuck). "stuck" er dem, kun
 * resolveStuckSaleEscrow kan afregne. Read-only.
 *
 * @param {any} supabase
 * @returns {Promise<Array<{ id: string, deal_type: string, deal_id: string, payer_team_id: string, payee_team_id: string, amount: number, rider_ids: string[], target_team_ids: string[], delivered_rider_ids: string[], created_at: string, action: string }>>}
 */
export async function listHeldSaleEscrowsForAdmin(supabase) {
  const { rows, error } = await fetchHeldSaleEscrows(supabase);
  if (error) throw new Error(`sale_escrows-opslag fejlede: ${error.message}`);
  if (rows.length === 0) return [];
  const states = await loadRiderStates(supabase, rows.flatMap((e) => e.rider_ids));
  return rows.map((e) => ({
    id: e.id,
    deal_type: e.deal_type,
    deal_id: e.deal_id,
    payer_team_id: e.payer_team_id,
    payee_team_id: e.payee_team_id,
    amount: Number(e.amount),
    rider_ids: e.rider_ids,
    target_team_ids: e.target_team_ids,
    delivered_rider_ids: e.delivered_rider_ids || [],
    created_at: e.created_at,
    action: classifyHeldEscrow(e, states),
  }));
}

/**
 * Ejer-krav 2 (#7871): den manuelle vej for et bytte, der sidder fast (een rytter
 * er leveret, den anden kan ikke leveres; settle_sale_escrow afviser baade release
 * og refund). Admin vaelger:
 *   release: modtageren krediteres kontantbeloebet (byttet staar ved magt).
 *   refund:  betaleren faar kontantbeloebet tilbage.
 * Ingen rytter flyttes i nogen af delene; den leverede bliver, hvor han er.
 * resolve_stuck_sale_escrow (M2) goer det i een transaktion under hold- og
 * raekkelaasene og tjekker selv, at escrow'en faktisk sidder fast (ellers
 * 'not_stuck': saa er det reconcile/heal-sweepets sag). Penge kan ikke opstaa:
 * release og refund udelukker hinanden (samme noegler og vagter som settle).
 *
 * @param {any} supabase
 * @param {{ escrowId: string, outcome: "release"|"refund", adminUserId: string|null, now?: Date }} args
 * @returns {Promise<{ status: string, [k: string]: any }>}
 */
export async function resolveStuckSaleEscrow(supabase, { escrowId, outcome, adminUserId, now = new Date() }) {
  if (outcome !== "release" && outcome !== "refund") {
    throw new Error(`resolveStuckSaleEscrow: outcome skal vaere release eller refund, ikke ${outcome}`);
  }
  const { data, error } = await rpcWithLockRetry(supabase, "resolve_stuck_sale_escrow", {
    p_escrow_id: escrowId,
    p_outcome: outcome,
    // Refusionens post. Ved release bruges escrow'ens gemte saelger-post (samme
    // tekst som handlen), og herfra kun actor_type, actor_id og source_path.
    p_payload: {
      type: "transfer_in",
      description: "Refusion af handel, afgjort af admin",
      metadata: { code: "tx.saleEscrowRefund", params: {} },
      actor_type: FINANCE_ACTOR_TYPE.ADMIN,
      actor_id: adminUserId,
      source_path: "api.admin.saleEscrowResolve",
    },
    p_settled_at: now.toISOString(),
  });
  if (error) throw new Error(`resolve_stuck_sale_escrow(${escrowId}, ${outcome}) fejlede: ${error.message}`);
  return data;
}

/**
 * Invariant H (ownershipInvariantWatch): holdte escrows, der er aeldre end
 * graensen og ikke venter paa et loeb, der stadig koerer. Det er netop dem, flush,
 * heal-sweep og reconcile skulle have afregnet. Read-only.
 *
 * @param {any} supabase
 * @param {{ now: Date, staleHours: number, getRidersInActiveStageRaceFn: Function }} opts
 * @returns {Promise<Array<{ id: string, deal_type: string, action: string, created_at: string }>>}
 */
export async function findStaleHeldSaleEscrows(supabase, { now, staleHours, getRidersInActiveStageRaceFn }) {
  const { rows, error } = await fetchHeldSaleEscrows(supabase);
  if (error) throw new Error(`sale_escrows-opslag fejlede: ${error.message}`);
  const staleMs = staleHours * 60 * 60 * 1000;
  const aged = rows.filter((e) => now.getTime() - new Date(e.created_at).getTime() > staleMs);
  if (aged.length === 0) return [];
  const states = await loadRiderStates(supabase, aged.flatMap((e) => e.rider_ids));
  const racing = new Set(await getRidersInActiveStageRaceFn(supabase, aged.flatMap((e) => e.rider_ids)));
  return aged
    .map((e) => ({ escrow: e, action: classifyHeldEscrow(e, states) }))
    .filter(({ escrow, action }) => action !== "wait" || !escrow.rider_ids.some((id) => racing.has(id)))
    .map(({ escrow, action }) => ({ id: escrow.id, deal_type: escrow.deal_type, action, created_at: escrow.created_at }));
}
