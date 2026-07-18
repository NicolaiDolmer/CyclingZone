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
// Flow pr. udløbet tilbud (ejer-beslutning 18/7): status → 'expired' +
// resolved_at, og rytteren listes derefter på en 24-AKTIV-TIMERS ungdomsauktion
// (mod standard 1 time i prod) via samme listRejectedAsYouthAuction-mekanik som
// afviste kandidater — vinderen får rytteren i sit akademi; ingen bud →
// rytteren slettes ved finalisering (forlader sporten, #2456-semantikken,
// identisk med afviste). 'expired' er allerede gyldig i CHECK-constrainten
// (academy_intake_status_check) — INGEN migration nødvendig (verificeret mod
// prod 18/7). is_offered_intake_rider() filtrerer på status='offered', så
// udløbet frigiver rytteren synligheds-mæssigt øjeblikkeligt.
//
// Drypvis udrulning: maks INTAKE_EXPIRY_MAX_PER_RUN (30, ejer-justeret fra 25) pr. dagligt tick,
// ældste først — første kørsler tager backloggen (~223 pr. 18/7) over ~8 dage
// i stedet for at dumpe alt på auktionsmarkedet på én gang. Bonus: jævn
// auktionsaktivitet (ejer-ønske 17/7 om mere markedsliv).
//
// Mirror af raceEntryGeneratorSweep.js/autoPrizeSweep.js: gated bag runtime-
// flag intake_offer_expiry_enabled (fail-safe OFF — flag ikke sat/ikke 'on' →
// no-op). Idempotent: status-flippet er guarded på .eq(status,'offered') (et
// samtidigt sign/reject overskrives aldrig), og auktions-listningen er
// idempotent i youthMarket (allerede-aktiv auktion returneres, unique-index på
// rytter). En fejlet auktions-listning aborterer ikke resten (heal-sweep-
// mønsteret); rytteren er da udløbet men u-auktioneret — næste dags tick rører
// ham ikke igen (rækken er 'expired'), så fejl rapporteres i resultatet til
// cron-loggen/Sentry-monitoren.
import { isIntakeOfferExpiryEnabled } from "./academyIntakeExpiryFlag.js";
import { listRejectedAsYouthAuction } from "./youthMarket.js";

export const INTAKE_OFFER_EXPIRY_DAYS = 7;
export const INTAKE_EXPIRY_AUCTION_DURATION_HOURS = 24;
export const INTAKE_EXPIRY_MAX_PER_RUN = 30;

export async function runIntakeOfferExpirySweep({
  supabase,
  now = new Date(),
  isEnabled = isIntakeOfferExpiryEnabled,
  listYouthAuctionFn = listRejectedAsYouthAuction,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!(await isEnabled(supabase))) return { ran: false, reason: "flag_off" };

  const cutoffIso = new Date(now.getTime() - INTAKE_OFFER_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const resolvedAtIso = now.toISOString();

  // Ældste først + cap — deterministisk drypvis afvikling af backloggen.
  const { data: candidates, error: selError } = await supabase
    .from("academy_intake")
    .select("id, rider_id")
    .eq("status", "offered")
    .lt("created_at", cutoffIso)
    .order("created_at", { ascending: true })
    .limit(INTAKE_EXPIRY_MAX_PER_RUN);
  if (selError) throw new Error(`academy_intake expiry select: ${selError.message}`);
  if (!candidates?.length) return { ran: true, expired: 0, auctioned: 0, cutoff: cutoffIso };

  // Status-flip — .eq(status,'offered') er re-guarden mod et samtidigt sign/reject.
  const { data: flipped, error: updError } = await supabase
    .from("academy_intake")
    .update({ status: "expired", resolved_at: resolvedAtIso })
    .in("id", candidates.map((c) => c.id))
    .eq("status", "offered")
    .select("id, rider_id");
  if (updError) throw new Error(`academy_intake expiry update: ${updError.message}`);

  // 24h-ungdomsauktion pr. udløbet rytter. Fejl pr. rytter aborterer ikke resten.
  let auctioned = 0;
  const auctionErrors = [];
  for (const row of flipped ?? []) {
    try {
      const auction = await listYouthAuctionFn(supabase, {
        riderId: row.rider_id,
        now,
        durationHours: INTAKE_EXPIRY_AUCTION_DURATION_HOURS,
      });
      if (auction) auctioned += 1;
    } catch (e) {
      auctionErrors.push(`${row.rider_id}: ${e?.message ?? e}`);
    }
  }

  return {
    ran: true,
    expired: flipped?.length ?? 0,
    auctioned,
    ...(auctionErrors.length ? { auctionErrors } : {}),
    cutoff: cutoffIso,
  };
}
