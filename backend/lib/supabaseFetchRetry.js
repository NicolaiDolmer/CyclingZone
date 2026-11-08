// #7675 — fetch-wrapper til createClient({ global: { fetch } }).
//
// Problem (Sentry 4/11): Cloudflare-laget mellem Railway og Supabase returnerede kortvarigt
// en HTML-fejlside (520-525) selvom Supabase' egen edge-log ikke havde nogen 5xx. Ét enkelt
// kald fejlede og spilleren fik en fejl, selvom et nyt forsøg et øjeblik efter ville lykkes.
//
// Wrapperen prøver kun igen hvor det er sikkert:
//   - GET/HEAD (læsninger)
//   - POST med Prefer: resolution=merge-duplicates (upsert: samme payload giver samme tilstand)
// Alt andet (RPC, almindelige inserts, PATCH, DELETE) sendes præcis én gang, så en
// ikke-idempotent skrivning aldrig kan udføres to gange.
//
// Det der prøves igen: Cloudflare-HTML-svar (status 520-525) og netværksfejl (fetch kaster).
//
// Undgå gange-effekt: PostgREST-klienten (@supabase/postgrest-js) prøver i forvejen GET/HEAD
// igen ved netværksfejl og status 520 (op til 3 gange). Ligger vi under den og også prøver
// igen på det samme, ganges antallet af forsøg op under et udfald. For læsninger dækker
// wrapperen derfor kun det SDK'et ikke dækker (521-525); upserts (som SDK'et aldrig prøver
// igen) dækkes fuldt ud. Opgraderes SDK'et til at dække flere koder, bør listen herunder følge med.
// Resultater ændres aldrig: lykkes et forsøg, returneres det uændret; slår alle forsøg fejl,
// returneres det sidste svar / den sidste fejl, så normalizeSupabaseErrorMessage ser det samme
// som før.

const RETRY_DELAYS_MS = [300, 1000];
const CLOUDFLARE_STATUSES = new Set([520, 521, 522, 523, 524, 525]);
// Status som PostgREST-klienten selv prøver igen ved læsninger.
const SDK_RETRIED_READ_STATUS = 520;

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  if (Array.isArray(headers)) {
    const hit = headers.find(([key]) => String(key).toLowerCase() === name.toLowerCase());
    return hit ? String(hit[1]) : "";
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) return String(headers[key]);
  }
  return "";
}

function requestMethod(input, init) {
  return String(init?.method || input?.method || "GET").toUpperCase();
}

function requestHeaders(input, init) {
  return init?.headers ?? input?.headers;
}

export function isRetryableRequest(input, init) {
  const method = requestMethod(input, init);
  if (method === "GET" || method === "HEAD") return true;
  if (method !== "POST") return false;
  const url = String(input?.url ?? input ?? "");
  if (url.includes("/rpc/")) return false;
  return /resolution=merge-duplicates/i.test(headerValue(requestHeaders(input, init), "prefer"));
}

function isCloudflareHtmlResponse(response, isRead) {
  if (!response || !CLOUDFLARE_STATUSES.has(response.status)) return false;
  if (isRead && response.status === SDK_RETRIED_READ_STATUS) return false;
  const contentType = headerValue(response.headers, "content-type");
  // Cloudflares fejlside er HTML; en JSON-fejl med samme status er ikke vores tilfælde.
  return !contentType || /text\/html/i.test(contentType);
}

function isStreamBody(init) {
  const body = init?.body;
  return body != null && typeof body !== "string" && !(body instanceof URLSearchParams)
    && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body);
}

export function createSupabaseFetchWithRetry(baseFetch = globalThis.fetch, {
  delaysMs = RETRY_DELAYS_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  return async function supabaseFetchWithRetry(input, init) {
    if (!isRetryableRequest(input, init) || isStreamBody(init)) return baseFetch(input, init);

    const method = requestMethod(input, init);
    const isRead = method === "GET" || method === "HEAD";
    let attempt = 0;
    for (;;) {
      let response;
      let failure = null;
      try {
        response = await baseFetch(input, init);
      } catch (err) {
        // best-effort: fejlen gemmes og kastes uændret videre når forsøgene er brugt op.
        failure = err;
      }

      // Netværksfejl på læsninger prøves allerede igen af PostgREST-klienten.
      const retryable = failure
        ? !isRead && failure?.name !== "AbortError"
        : isCloudflareHtmlResponse(response, isRead);
      if (!retryable || attempt >= delaysMs.length || init?.signal?.aborted) {
        if (failure) throw failure;
        return response;
      }

      if (!failure) {
        // Frigiv forbindelsen før næste forsøg.
        try { await response.arrayBuffer(); } catch { /* best-effort: body er ligegyldig, vi prøver igen */ }
      }
      await sleep(delaysMs[attempt]);
      attempt += 1;
    }
  };
}
