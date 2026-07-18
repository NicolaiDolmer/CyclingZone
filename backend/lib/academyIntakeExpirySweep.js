// backend/lib/academyIntakeExpirySweep.js
// #2627 — akademi-intake-tilbud har ingen udløbstid i dag. Konsekvens fundet i
// prod-audit 18/7 (#2623): 242 åbne 'offered'-rækker fordelt på ~48 inaktive
// menneske-hold (Ø ~17 dage gamle, ældste ~26 dage). RLS-policyen
// is_offered_intake_rider() skjuler EN RYTTER MED ÅBENT TILBUD for HELE
// spillerbasen, så disse 242 ryttere er globalt usynlige/usøgbare — rod-
// årsagen bag #2581/#2623-spillerrapporterne "rytteren findes ikke".
//
// Empiri (#2627): tilbud der besvares, besvares hurtigt (signed Ø 17,6 t;
// rejected Ø 36 t). Tilbud der står >2-3 dage tilhører i praksis inaktive
// managere og resolver aldrig organisk. INTAKE_OFFER_EXPIRY_DAYS=7 er derfor
// konservativt ift. svar-empirien.
//
// Denne sweep sætter 'offered'-rækker ældre end udløbsgrænsen til 'expired' +
// resolved_at=now. 'expired' er allerede en gyldig værdi i academy_intake's
// CHECK-constraint (academy_intake_status_check) — INGEN migration nødvendig
// (verificeret mod prod-skemaet 18/7). is_offered_intake_rider() filtrerer på
// status='offered', så en udløbet række frigiver rytteren automatisk — ingen
// separat RLS-ændring krævet.
//
// Mirror af raceEntryGeneratorSweep.js/autoPrizeSweep.js: gated bag runtime-
// flag intake_offer_expiry_enabled (fail-safe OFF — flag ikke sat/ikke 'on' →
// no-op). Idempotent: WHERE status='offered' i selve UPDATE'en er re-guarden,
// så et samtidigt sign/reject-kald aldrig overskrives, og et gentaget tick
// finder blot færre (til sidst ingen) rækker. Ingen backfill-migration for de
// eksisterende ~242 gamle tilbud — første kørsel efter flaget armeres tager dem
// via samme WHERE-betingelse (de er allerede >7 dage gamle).
import { isIntakeOfferExpiryEnabled } from "./academyIntakeExpiryFlag.js";

export const INTAKE_OFFER_EXPIRY_DAYS = 7;

export async function runIntakeOfferExpirySweep({
  supabase,
  now = new Date(),
  isEnabled = isIntakeOfferExpiryEnabled,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!(await isEnabled(supabase))) return { ran: false, reason: "flag_off" };

  const cutoffIso = new Date(now.getTime() - INTAKE_OFFER_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const resolvedAtIso = now.toISOString();

  const { data, error } = await supabase
    .from("academy_intake")
    .update({ status: "expired", resolved_at: resolvedAtIso })
    .eq("status", "offered")
    .lt("created_at", cutoffIso)
    .select("id");
  if (error) throw new Error(`academy_intake expiry update: ${error.message}`);

  return { ran: true, expired: Array.isArray(data) ? data.length : 0, cutoff: cutoffIso };
}
