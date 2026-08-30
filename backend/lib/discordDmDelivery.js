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
 *   - 400/404 fra openDm → permanent (ugyldigt modtager-id, Discord-kode 50033)
 *            — samme slags døde kobling som 403, se
 *            PERMANENT_RECIPIENT_FAILURE_REASONS.
 *   - 400/404 fra postDm → permanent, men VORES fejl (payload afvist, typisk
 *            kode 50035) — tæller aldrig som modtager-fejl, se classifyDmFailure.
 * Vedvarende retryable-fejl ender i discord_dm_outbox (se discordDmOutbox.js)
 * så DM'en overlever IP-ban-vinduer og deploy-restarts i stedet for at forsvinde.
 */

const DISCORD_API = "https://discord.com/api/v10";

// Maks. samlet sleep pr. attemptDmDelivery-kald. Call-sites er fire-and-forget,
// men vi vil ikke holde en promise i live i minutter — længere ventetider hører
// hjemme i outbox'en.
const MAX_INLINE_RETRY_WAIT_MS = 5_000;

/**
 * Discord-fejlkoder vi klassificerer eksplicit på (JSON-body'ens `code`).
 * Docs: Discord REST → JSON Error Codes.
 */
export const DISCORD_CODE_INVALID_RECIPIENT = 50033;
export const DISCORD_CODE_INVALID_FORM_BODY = 50035;

/** Læs Discords fejlkode ud af en JSON-fejl-body. null hvis den ikke er der. */
export function parseDiscordErrorCode(bodyText) {
  try {
    const body = JSON.parse(bodyText);
    return typeof body?.code === "number" ? body.code : null;
  } catch {
    // best-effort: body var ikke JSON (proxy-HTML, tom krop). Fejlkoden er et
    // ekstra signal oven på status + step, aldrig det eneste — mangler den,
    // klassificerer vi videre på trin som før.
    return null;
  }
}

/**
 * Klassificér en HTTP-status fra Discord REST.
 * `null`/`undefined` status = netværks-/runtime-fejl (retryable).
 *
 * `step` skelner de to trin i en DM-levering, og dét er ikke kosmetik:
 * openDm sender KUN modtagerens id, så et 400/404 dér handler om modtageren.
 * postDm sender VORES embed-payload, så et 400 dér er vores egen fejl (Discord
 * -kode 50035 "Invalid Form Body", fx en title over 256 tegn). Review af #3483
 * fangede at de to før blev klassificeret ens: tre for lange notifikationer
 * ville dermed have afkoblet hver eneste tilknyttede spiller på én gang —
 * præcis den flok-afkobling 401 bevidst holdes udenfor for at undgå.
 *
 * @param {number|null|undefined} status
 * @param {{step?: "openDm"|"postDm", discordCode?: number|null}} [context]
 */
export function classifyDmFailure(status, { step = "openDm", discordCode = null } = {}) {
  if (status === 401) return { kind: "permanent", reason: "token-invalid" };
  if (status === 403) return { kind: "permanent", reason: "recipient-blocked" };
  if (status === 400 || status === 404) {
    // Vores payload afvist → aldrig en modtager-fejl. Trin-skelnen er det
    // primære signal; fejlkoden er et ekstra værn for et openDm-svar der
    // eksplicit siger 50035 (dvs. recipient_id-feltet selv er malformet).
    const ourPayload = step === "postDm" || discordCode === DISCORD_CODE_INVALID_FORM_BODY;
    return { kind: "permanent", reason: ourPayload ? "payload-rejected" : "bad-request" };
  }
  if (status === 429) return { kind: "retryable", reason: "rate-limited" };
  if (status != null && status >= 500) return { kind: "retryable", reason: "discord-5xx" };
  if (status == null) return { kind: "retryable", reason: "network" };
  // Ukendte koder: behandl som retryable så vi hellere prøver igen end dropper.
  return { kind: "retryable", reason: `http-${status}` };
}

/**
 * Permanente fejl-reasons der peger på MODTAGEREN, ikke på vores infrastruktur.
 *
 * #3483: 'recipient-blocked' (403) og 'bad-request' (400/404 FRA openDm,
 * Discord-kode 50033 "Invalid Recipient(s)") er begge døde koblinger set fra
 * spillerens side — han får aldrig en DM igen, uanset hvilken af de to Discord
 * svarer med. Begge skal derfor tælle på den samme dead-connection-tæller
 * (#3130). 400-grenen er den farligste af de to: 403 selvhelbreder, fordi
 * clearDmFailureCount nulstiller ved næste vellykkede levering, mens en
 * 400-kobling hverken kunne tælle op eller nulstilles og derfor stod som
 * "tilsluttet" for evigt.
 *
 * To reasons holdes bevidst UDENFOR, begge fordi de er VORES fejl og ville ramme
 * alle tilknyttede spillere samtidig efter tre notifikationer:
 *   - 'token-invalid' (401): bot-token roteret eller ugyldigt.
 *   - 'payload-rejected' (400/404 fra postDm, typisk kode 50035 "Invalid Form
 *     Body"): vores embed sprænger en af Discords grænser. Se clampEmbed i
 *     discordEmbedLimits.js, der lukker den fejlklasse i selve payload-byggeriet.
 */
export const PERMANENT_RECIPIENT_FAILURE_REASONS = Object.freeze([
  "recipient-blocked",
  "bad-request",
]);

/** True hvis en permanent fejl-reason betyder "denne modtager er død for os". */
export function isPermanentRecipientFailure(reason) {
  return PERMANENT_RECIPIENT_FAILURE_REASONS.includes(reason);
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
    return { ok: false, status: null, errorText: err.message, retryAfterMs: null, discordCode: null };
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
    discordCode: parseDiscordErrorCode(text),
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
  let lastStep = "openDm";
  let lastDiscordCode = null;
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
    lastStep = step;
    lastDiscordCode = result.discordCode ?? null;
    lastError = `${step} ${result.status ?? "network"}: ${result.errorText}`;

    // `step` bæres med ind i klassifikationen: kun openDm siger noget om
    // modtageren (se classifyDmFailure). `step` bæres også UD i failure-objektet,
    // så logs og Sentry kan se hvilket trin der fejlede uden at parse `error`.
    const failure = { ...classifyDmFailure(result.status, { step, discordCode: lastDiscordCode }), step };
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
    failure: {
      ...classifyDmFailure(lastStatus, { step: lastStep, discordCode: lastDiscordCode }),
      step: lastStep,
    },
    error: lastError,
    attempts: maxAttempts,
  };
}
