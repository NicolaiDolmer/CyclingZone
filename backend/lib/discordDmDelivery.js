/**
 * Discord DM-levering med retry + fejl-klassifikation (#1115).
 * ============================================================
 * Rod-årsag 2026-06-10: DMs døde IGEN — men denne gang var token GYLDIGT.
 * Discord svarede 429 (rate-limit) fra Railways delte egress-IP (Sentry
 * CYCLINGZONE-Z: 429 på allerførste request efter boot 9/6 — kan ikke være
 * bottens eget request-budget). Den gamle sendDM droppede enhver fejlet DM
 * permanent efter ét forsøg og loggede kun console.error → usynligt, fordi
 * Railway-logs roterer på minutter ved hyppige deploys.
 *
 * Dette modul er pure (alle effekter injiceres) så node --test kan dække
 * fejl-matricen uden netværk:
 *   - 429  → respektér Discords `retry_after`, retry op til maxAttempts.
 *   - 5xx / netværksfejl → retry med lille backoff.
 *   - 401  → permanent (token roteret/ugyldigt) — INGEN retry, skal alarmere.
 *   - 403  → permanent (modtager har lukket DMs / deler ikke server) — data,
 *            ikke infra; ingen alarm-spam.
 * Vedvarende retryable-fejl ender i discord_dm_outbox (se discordDmOutbox.js)
 * så DM'en overlever IP-ban-vinduer og deploy-restarts i stedet for at forsvinde.
 */

const DISCORD_API = "https://discord.com/api/v10";

// Maks. samlet sleep pr. attemptDmDelivery-kald. Call-sites er fire-and-forget,
// men vi vil ikke holde en promise i live i minutter — længere ventetider hører
// hjemme i outbox'en.
const MAX_INLINE_RETRY_WAIT_MS = 5_000;

/**
 * Klassificér en HTTP-status fra Discord REST.
 * `null`/`undefined` status = netværks-/runtime-fejl (retryable).
 */
export function classifyDmFailure(status) {
  if (status === 401) return { kind: "permanent", reason: "token-invalid" };
  if (status === 403) return { kind: "permanent", reason: "recipient-blocked" };
  if (status === 400 || status === 404) return { kind: "permanent", reason: "bad-request" };
  if (status === 429) return { kind: "retryable", reason: "rate-limited" };
  if (status != null && status >= 500) return { kind: "retryable", reason: "discord-5xx" };
  if (status == null) return { kind: "retryable", reason: "network" };
  // Ukendte koder: behandl som retryable så vi hellere prøver igen end dropper.
  return { kind: "retryable", reason: `http-${status}` };
}

/** Parse Discords retry_after (sekunder, kan være decimal) → ms, ellers null. */
export function parseRetryAfterMs(res, bodyText) {
  try {
    const body = JSON.parse(bodyText);
    if (typeof body?.retry_after === "number") return Math.ceil(body.retry_after * 1000);
  } catch {
    // body var ikke JSON — fald tilbage til header
  }
  const header = res?.headers?.get?.("Retry-After");
  if (header == null || header === "") return null; // Number(null) er 0 — guard så manglende header → null
  const headerSeconds = Number(header);
  if (Number.isFinite(headerSeconds) && headerSeconds >= 0) return Math.ceil(headerSeconds * 1000);
  return null;
}

async function discordRequest({ url, botToken, body, fetchFn }) {
  let res;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, status: null, errorText: err.message, retryAfterMs: null };
  }
  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: true, status: res.status, data };
  }
  const text = await res.text().catch(() => "");
  return {
    ok: false,
    status: res.status,
    errorText: text.slice(0, 300),
    retryAfterMs: res.status === 429 ? parseRetryAfterMs(res, text) : null,
  };
}

/**
 * Forsøg at levere en DM (open channel + post message) med inline-retry.
 *
 * @returns {Promise<{ok: boolean, status?: number|null, failure?: {kind: string, reason: string}, error?: string, attempts: number}>}
 *   ok=true → leveret. ok=false → `failure.kind` afgør om den skal i outbox
 *   ("retryable") eller droppes/alarmeres ("permanent").
 */
export async function attemptDmDelivery({
  discordId,
  payload,
  botToken,
  fetchFn = fetch,
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxAttempts = 3,
  maxInlineWaitMs = MAX_INLINE_RETRY_WAIT_MS,
}) {
  let lastStatus = null;
  let lastError = "";
  let waitedMs = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 1) Åbn (eller genfind) DM-kanalen
    const open = await discordRequest({
      url: `${DISCORD_API}/users/@me/channels`,
      botToken,
      body: { recipient_id: discordId },
      fetchFn,
    });

    let step = "openDm";
    let result = open;

    // 2) Send beskeden
    if (open.ok) {
      step = "postDm";
      result = await discordRequest({
        url: `${DISCORD_API}/channels/${open.data.id}/messages`,
        botToken,
        body: payload,
        fetchFn,
      });
      if (result.ok) {
        return { ok: true, status: result.status, attempts: attempt };
      }
    }

    lastStatus = result.status;
    lastError = `${step} ${result.status ?? "network"}: ${result.errorText}`;

    const failure = classifyDmFailure(result.status);
    if (failure.kind === "permanent") {
      return { ok: false, status: lastStatus, failure, error: lastError, attempts: attempt };
    }

    if (attempt < maxAttempts) {
      // Respektér Discords retry_after; ellers lille backoff. Overstiger den
      // samlede ventetid inline-loftet → giv op nu og lad outbox'en tage over.
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
    failure: classifyDmFailure(lastStatus),
    error: lastError,
    attempts: maxAttempts,
  };
}
