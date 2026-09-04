// Edge-trigget alarm-dedupe oven på `ops_alert_state` (#2730-mønsteret, som
// cronHeartbeat.js allerede bruger mod Discord #ops). Formålet er ÉN alarm pr.
// TILSTAND — ikke én pr. tick.
//
// Rod-årsagen den blev skrevet til (CYCLINGZONE-58, 4/9): AI-trim-sweepens
// "persistent stall"-alarm kører på 5-min-kadence og fyrede en Sentry-error HVER
// tick så længe ét AI-hold var fastlåst — 378 events på 32 timer, og ~95 % af
// alle error-linjer i Railway-loggen. Selve fundet var korrekt (holdet ER
// permanent utrimbart, jf. den åbne FK-beslutning i #4233), men betingelsen kan
// først forsvinde når ejeren træffer et valg. En uafviselig tilstand må ikke
// larme 288 gange i døgnet: den drukner præcis det log-signal #4453 handler om,
// og brænder Sentry-kvote uden at tilføje information efter den første besked.
//
// Kontrakten er bevidst todelt, så vi hverken spammer eller taber signalet:
//   1. SIGNATUR-ÆNDRING alarmerer altid med det samme (nyt hold i sættet, et
//      hold der kom sig, ændret årsag) — det er ny information.
//   2. UÆNDRET signatur alarmerer igen når `reAlertAfterMs` er gået (gulv, så en
//      vedvarende tilstand forbliver synlig i stedet for at forsvinde helt —
//      det er forskellen fra cronHeartbeats rene edge-trigger).
//
// Fail-open: kan state-rækken ikke læses eller skrives, ALARMERER vi (og
// rapporterer DB-fejlen). En dedupe-mekanisme må aldrig kunne tie en ægte alarm
// ihjel fordi en hjælpetabel er nede.

export const OPS_ALERT_STATE_TABLE = "ops_alert_state";

/**
 * Byg en stabil signatur af et sæt alarm-emner. Sorteret + join'et, så
 * rækkefølgen fra kilden aldrig i sig selv ser ud som en ændring.
 *
 * @param {Array<string>} parts
 * @returns {string}
 */
export function buildAlertSignature(parts = []) {
  return [...new Set(parts.map((p) => String(p)))].sort().join(",");
}

/**
 * Skal denne alarm fyre nu? Læser + opdaterer `ops_alert_state` for `alertKey`.
 *
 * @param {{ supabase: object, alertKey: string, signature: string, now?: Date,
 *           reAlertAfterMs?: number|null, captureExceptionFn?: Function }} args
 * @returns {Promise<{ alert: boolean, reason: "changed"|"re-alert"|"suppressed"|"state-error" }>}
 */
export async function shouldAlertOnChange({
  supabase,
  alertKey,
  signature,
  now = new Date(),
  reAlertAfterMs = null,
  captureExceptionFn,
} = {}) {
  const { data: stateRow, error: readErr } = await supabase
    .from(OPS_ALERT_STATE_TABLE)
    .select("signature, last_alerted_at")
    .eq("alert_key", alertKey)
    .maybeSingle();

  if (readErr) {
    captureExceptionFn?.(new Error(`ops_alert_state read (${alertKey}): ${readErr.message}`), {
      tags: { alert_key: alertKey },
    });
    return { alert: true, reason: "state-error" };
  }

  const changed = (stateRow?.signature ?? "") !== signature;

  // Gulvet måles fra SIDSTE faktiske alarm, ikke fra sidste skrivning — ellers
  // ville en uændret tilstand kunne skubbe sit eget gulv i det uendelige.
  let reAlert = false;
  if (!changed && reAlertAfterMs != null) {
    const lastAlertedAt = stateRow?.last_alerted_at ? new Date(stateRow.last_alerted_at) : null;
    reAlert =
      !lastAlertedAt ||
      Number.isNaN(lastAlertedAt.getTime()) ||
      now.getTime() - lastAlertedAt.getTime() >= reAlertAfterMs;
  }

  const alert = changed || reAlert;

  // Skriv kun når der er noget at flytte: enten er signaturen ny, eller vi har
  // netop alarmeret og skal nulstille gulvet. Et undertrykt tick rører intet.
  if (changed || alert) {
    const { error: upsertErr } = await supabase.from(OPS_ALERT_STATE_TABLE).upsert(
      {
        alert_key: alertKey,
        signature,
        ...(alert ? { last_alerted_at: now.toISOString() } : {}),
        updated_at: now.toISOString(),
      },
      { onConflict: "alert_key" }
    );
    if (upsertErr) {
      captureExceptionFn?.(new Error(`ops_alert_state upsert (${alertKey}): ${upsertErr.message}`), {
        tags: { alert_key: alertKey },
      });
      // Skrivningen fejlede → næste tick ser den gamle signatur og alarmerer
      // igen. Det er den rigtige retning at fejle i (for meget, ikke for lidt).
      return { alert: true, reason: "state-error" };
    }
  }

  return { alert, reason: alert ? (changed ? "changed" : "re-alert") : "suppressed" };
}
