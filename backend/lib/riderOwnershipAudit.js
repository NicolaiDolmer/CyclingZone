// #3582 — bevægelses-log for rytter-ejerskab.
//
// SKRIVER til rider_ownership_events (database/2026-08-18-3582-rider-ownership-
// audit.sql, IKKE anvendt endnu — se migrationens header). Én række pr.
// ejerskabsskifte: hvem havde rytteren, hvem fik ham, hvorfor, og hvilken
// entitet (auktion/handel/bytte/admin) udløste det.
//
// BEST-EFFORT, ALDRIG FATAL — samme princip som #3401's post-hammerslag-reveal
// og #1872's kontraktudløb-notifikation i auctionFinalization.js: en fejlet
// berigelses-skrivning må ALDRIG kunne rulle en allerede-committet
// ejerskabsændring tilbage. Det gælder DOBBELT her: indtil migrationen rent
// faktisk er kørt i prod, findes tabellen slet ikke, og ethvert kald ville
// ellers fejle finaliseringen for enhver auktion i systemet.
//
// idempotency_key (valgfri) genbruger SAMME nøgle som den ledsagende
// finance_transactions-postering hvor én findes (fx `auction_winner:<id>`) —
// en cron-retry der rammer 23505 på financen no-op'er så også audit-raekken.

import { normalizeSupabaseErrorMessage } from "./supabaseErrorNormalize.js";

export const RIDER_OWNERSHIP_REASON = Object.freeze({
  AUCTION_WIN: "auction_win",
  GUARANTEED_BANK_SALE: "guaranteed_bank_sale",
  TRADE: "trade",
  SWAP: "swap",
  RELEASE: "release",
  FREE_AGENT_SIGNING: "free_agent_signing",
  ACADEMY_PROMOTION: "academy_promotion",
  SEASON_TRANSITION: "season_transition",
  ADMIN: "admin",
  STAGE_RACE_DEFERRED_FLUSH: "stage_race_deferred_flush",
});

/**
 * Skriv ÉN rider_ownership_events-række. Kastes ALDRIG — en fejl logges og
 * sluges, så kalderen (allerede efter den reelle ejerskabs-/finance-mutation
 * er committet) aldrig kan rulles tilbage af en audit-skrivnings-fejl.
 *
 * @param {object} supabase
 * @param {object} event
 * @param {string} event.riderId
 * @param {string} [event.riderFirstname] rider-navns-SNAPSHOT (overlever rytterens sletning, #3561-lektien)
 * @param {string} [event.riderLastname]
 * @param {string|null} [event.fromTeamId] null = fri agent/akademi-fri-agent
 * @param {string|null} [event.toTeamId]   null = frigivet til fri agent
 * @param {string} event.reason en af RIDER_OWNERSHIP_REASON
 * @param {string} [event.relatedEntityType] 'auction'|'transfer'|'swap'|'manual' (samme enum som finance_transactions)
 * @param {string} [event.relatedEntityId]
 * @param {string} [event.actorType] 'cron'|'api'|'admin'|'system'|'migration'
 * @param {string|null} [event.actorId]
 * @param {string} [event.occurredAt] ISO-timestamp — default now() i DB
 * @param {string} [event.idempotencyKey] genbrug financens nøgle hvor der findes én
 * @returns {Promise<{ok:boolean, skipped:boolean}>} kaster ALDRIG
 */
export async function recordRiderOwnershipEvent(supabase, event) {
  try {
    if (!supabase?.from) throw new Error("Supabase client required");
    if (!event?.riderId || !event?.reason) {
      throw new Error("recordRiderOwnershipEvent: riderId and reason are required");
    }

    const payload = {
      rider_id: event.riderId,
      rider_firstname: event.riderFirstname ?? null,
      rider_lastname: event.riderLastname ?? null,
      from_team_id: event.fromTeamId ?? null,
      to_team_id: event.toTeamId ?? null,
      reason: event.reason,
      related_entity_type: event.relatedEntityType ?? null,
      related_entity_id: event.relatedEntityId ?? null,
      actor_type: event.actorType ?? null,
      actor_id: event.actorId ?? null,
      idempotency_key: event.idempotencyKey ?? null,
    };
    if (event.occurredAt) payload.occurred_at = event.occurredAt;

    const { error } = await supabase.from("rider_ownership_events").insert(payload);

    if (error) {
      // 23505 (idempotency_key-dublet) = cron-retry af en allerede-loggede
      // hændelse. Forventet, ikke-fatal — no-op på samme måde som financens
      // egen idempotency-guard (balanceRpc.js DUPLICATE_VIOLATION_CODE).
      if (error.code === "23505") {
        return { ok: true, skipped: true };
      }
      throw new Error(normalizeSupabaseErrorMessage(error.message));
    }

    return { ok: true, skipped: false };
  } catch (e) {
    // best-effort: se modul-header — en fejlet audit-skrivning (inkl.
    // "tabellen findes ikke endnu" FØR migrationen er kørt) må ALDRIG kunne
    // kastes videre til en kalder der allerede har committet den rigtige
    // ejerskabsmutation.
    console.error(
      `  ⚠️  recordRiderOwnershipEvent fejlede for rytter ${event?.riderId} (ikke-fatal, #3582):`,
      e.message
    );
    return { ok: false, skipped: false };
  }
}
