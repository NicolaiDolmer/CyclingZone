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
      "  ⚠️  recordRiderOwnershipEvent fejlede for rytter %s (ikke-fatal, #3582):",
      event?.riderId,
      e.message
    );
    return { ok: false, skipped: false };
  }
}

/**
 * #6504: en udgang fra et hold (team_id -> null) logges af DB-triggeren
 * trg_record_rider_team_exit som reason release/retirement, actor system. En
 * kalder, der kender den rigtige aktør (admin-flytningen), skriver IKKE en egen
 * række (det gav en dubletrække), men tilskriver triggerens række. Best-effort
 * og kaster aldrig, som recordRiderOwnershipEvent.
 *
 * @param {any} supabase Supabase-klient (service_role)
 * @param {object} p
 * @param {string} p.riderId
 * @param {string} p.fromTeamId holdet rytteren forlod
 * @param {string} p.since ISO-tid lige før UPDATE'en (snævrer ind til denne udgang)
 * @param {string} p.reason en af RIDER_OWNERSHIP_REASON
 * @param {string|null} [p.relatedEntityType]
 * @param {string|null} [p.actorType]
 * @param {string|null} [p.actorId]
 * @returns {Promise<{ok:boolean, updated:number}>}
 */
export async function attributeTeamExitEvent(supabase, { riderId, fromTeamId, since, reason, relatedEntityType = null, actorType = null, actorId = null }) {
  try {
    // Kun den nyeste udgangs-række: en ældre udgang i samme vindue må aldrig omdøbes.
    const { data: rows, error: findError } = await supabase.from("rider_ownership_events")
      .select("id")
      .eq("rider_id", riderId).eq("from_team_id", fromTeamId).is("to_team_id", null)
      .eq("actor_type", "system").gte("created_at", since)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(1);
    if (findError) throw new Error(normalizeSupabaseErrorMessage(findError.message));
    const id = rows?.[0]?.id;
    if (id == null) return { ok: true, updated: 0 };
    const { data, error } = await supabase.from("rider_ownership_events")
      .update({ reason, related_entity_type: relatedEntityType, actor_type: actorType, actor_id: actorId })
      .eq("id", id).eq("actor_type", "system")
      .select("id");
    if (error) throw new Error(normalizeSupabaseErrorMessage(error.message));
    return { ok: true, updated: data?.length ?? 0 };
  } catch (e) {
    // best-effort: ejerskabsændringen er allerede committet; kun tilskrivningen mangler.
    console.error("  ⚠️  attributeTeamExitEvent fejlede for rytter %s (ikke-fatal, #6504):", riderId, e instanceof Error ? e.message : String(e));
    return { ok: false, updated: 0 };
  }
}
