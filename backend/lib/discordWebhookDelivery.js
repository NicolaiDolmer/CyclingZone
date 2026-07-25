/**
 * Discord result-webhook levering med retry + backoff (#2882).
 * ============================================================
 * Rod-årsag 24/7: 4 tier-3-puljer (A/B/C/D) finaliserede inden for få sekunder
 * af hinanden. Hver post rammer 2 kanaler (gruppe + tier-samlekanal via
 * getResultWebhooks) → tier-samlekanalens webhook fik flere POSTs i hurtig
 * rækkefølge og ramte Discords per-webhook rate limit (429). Den gamle
 * sendWebhook (discordNotifier.js) havde INGEN retry — en 429 blev logget med
 * console.error og resultatet tabt for evigt (#2395 fangede kun 4xx≠429, ikke
 * 429-drop).
 *
 * Samme mønster som discordDmDelivery.js (#1115): pure, injicerbar
 * (fetchFn/sleepFn) så node --test dækker fejl-matricen uden netværk.
 *   - 429             → respektér Discords retry_after (body-felt ELLER
 *                        Retry-After-header), retry op til maxAttempts.
 *   - 5xx / netværksfejl → retry med lille stigende backoff.
 *   - 4xx ≠ 429       → permanent (webhook slettet/fejlkonfigureret, #2395) —
 *                        INGEN retry.
 *
 * IDEMPOTENS: Discord opretter kun beskeden ved 2xx. Et 429/5xx-svar betyder
 * beskeden ALDRIG blev oprettet, så et retry-forsøg kan pr. definition ikke
 * producere en dublet — loopet nedenfor returnerer med det samme ved første
 * 2xx og forsøger aldrig igen efter succes (ingen "fire again just in case").
 */

import { parseRetryAfterMs } from "./discordDmDelivery.js";

// Resultat-poster er (i modsætning til DM'er) ikke rent fire-and-forget for
// kalderen — cron.js/api.js awaiter sendWebhook før næste løb/etape behandles
// — men de MÅ heller ikke forsvinde tavst. 15s inline-loft er rigeligt til
// Discords typiske webhook-retry_after (typisk << 1s), samtidig med at en
// pato­logisk lang retry_after (Discord beder om minutter) ikke låser en
// cron-tick eller en admin-HTTP-request fast.
const MAX_INLINE_RETRY_WAIT_MS = 15_000;

/** Klassificér en HTTP-status fra Discords webhook-endpoint. */
export function classifyWebhookFailure(status) {
  if (status === 429) return { kind: "retryable", reason: "rate-limited" };
  if (status == null) return { kind: "retryable", reason: "network" };
  if (status >= 500) return { kind: "retryable", reason: "discord-5xx" };
  if (status >= 400) {
    // #2395: dødt/fejlkonfigureret webhook (slettet kanal, forkert id) er en
    // PERSISTENT config-/routing-fejl, ikke et transient rate-limit-hik.
    return { kind: "permanent", reason: "config-error" };
  }
  // Ukendte 2xx/3xx-varianter der alligevel ikke var res.ok: behandl som
  // retryable så vi hellere prøver igen end dropper.
  return { kind: "retryable", reason: `http-${status}` };
}

export { parseRetryAfterMs };

async function postOnce({ webhookUrl, payload, fetchFn }) {
  let res;
  try {
    res = await fetchFn(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { ok: false, status: null, errorText: err.message, retryAfterMs: null };
  }
  if (res.ok) return { ok: true, status: res.status };
  const text = await res.text().catch(() => "");
  return {
    ok: false,
    status: res.status,
    errorText: text.slice(0, 300),
    retryAfterMs: res.status === 429 ? parseRetryAfterMs(res, text) : null,
  };
}

/**
 * Forsøg at levere én webhook-post med inline-retry.
 *
 * @returns {Promise<{ok: boolean, status?: number|null, failure?: {kind: string, reason: string, deferred?: boolean}, error?: string, attempts: number}>}
 *   ok=true → leveret (2xx). ok=false → `failure.kind` afgør om fejlen var
 *   "permanent" (dødt webhook — ingen mening i at prøve igen) eller
 *   "retryable" (rate-limit/5xx/netværk som overlevede alle forsøg, evt.
 *   `deferred:true` hvis Discords retry_after oversteg maxInlineWaitMs).
 */
export async function attemptWebhookDelivery({
  webhookUrl,
  payload,
  fetchFn = fetch,
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxAttempts = 4,
  maxInlineWaitMs = MAX_INLINE_RETRY_WAIT_MS,
}) {
  let lastStatus = null;
  let lastError = "";
  let waitedMs = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await postOnce({ webhookUrl, payload, fetchFn });
    if (result.ok) return { ok: true, status: result.status, attempts: attempt };

    lastStatus = result.status;
    lastError = `${result.status ?? "network"}: ${result.errorText}`;

    const failure = classifyWebhookFailure(result.status);
    if (failure.kind === "permanent") {
      return { ok: false, status: lastStatus, failure, error: lastError, attempts: attempt };
    }

    if (attempt < maxAttempts) {
      // Respektér Discords retry_after; ellers lille stigende backoff.
      // Overstiger den samlede ventetid inline-loftet → giv op nu (deferred)
      // i stedet for at blokere kalderen i minutter.
      const waitMs = result.retryAfterMs ?? 500 * attempt;
      if (waitedMs + waitMs > maxInlineWaitMs) {
        return {
          ok: false,
          status: lastStatus,
          failure: { ...failure, deferred: true },
          error: lastError,
          attempts: attempt,
        };
      }
      waitedMs += waitMs;
      await sleepFn(waitMs);
    }
  }

  return {
    ok: false,
    status: lastStatus,
    failure: classifyWebhookFailure(lastStatus),
    error: lastError,
    attempts: maxAttempts,
  };
}
