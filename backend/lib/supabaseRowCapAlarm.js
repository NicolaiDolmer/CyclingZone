// #8797 — driftsalarm når et Supabase-svar rammer PostgREST' rækkeloft.
//
// PostgREST returnerer højst 1.000 rækker pr. select (Supabase max_rows). En læsning
// uden .range()/.limit() som rammer loftet, fejler ikke: den afkorter stille. Den fejl
// er skibet flere gange (PCM-matcher, sponsor-indtægt, bestyrelseshistorik) og blev
// hver gang fundet af en spiller, ikke af os. Lint-vagten (scripts/lint-pagination-guard.mjs)
// fanger kildekoden; denne wrapper er signalet i drift for det vagten ikke ser.
//
// Regel: et GET-svar fra /rest/v1/ hvor kaldet IKKE selv bad om et vindue (ingen
// top-level limit/offset-parameter, ingen Range-header, ikke .single()) og hvor svaret
// indeholder PRÆCIS loftets antal rækker, er næsten altid afkortet. Så sendes en
// Sentry-advarsel med tabel og forespørgslens form.
//
// Antallet læses fra Content-Range-headeren ("0-999/*"), som PostgREST altid sender på
// læsninger. Svar-body'en læses aldrig, så wrapperen koster intet på store svar og kan
// ikke ændre resultatet. Mangler headeren, gøres intet.
//
// Privatliv: kun stien og NAVNENE på query-parametrene sendes (fx "select,team_id,order"),
// aldrig værdierne, så id'er og filterværdier ikke ender i Sentry.

export const POSTGREST_ROW_CAP = 1000;

// Samme forespørgselsform rapporteres højst én gang pr. vindue pr. proces, så en
// hyppig læsning ikke oversvømmer Sentry. Fingerprintet samler dem i ét issue pr. tabel.
const DEFAULT_DEDUPE_MS = 60 * 60 * 1000;

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

function requestUrl(input) {
  if (input == null) return null;
  const raw = typeof input === "string" ? input : (input.href ?? input.url ?? String(input));
  try {
    return new URL(raw);
  } catch {
    // best-effort: en relativ/ugyldig URL er ikke et PostgREST-kald vi kan vurdere.
    return null;
  }
}

/** Antal rækker i svaret ifølge Content-Range ("0-999/*" → 1000; "*\/0" → 0). */
export function rowsFromContentRange(value) {
  const m = /^\s*(\d+)-(\d+)\s*\/\s*(?:\d+|\*)\s*$/.exec(String(value || ""));
  if (!m) return null;
  return Number(m[2]) - Number(m[1]) + 1;
}

/**
 * Vurdér ét fetch-kald. Returnerer null når intet tyder på afkortning, ellers
 * { table, shape, rows } til rapporten.
 */
export function inspectRowCapResponse(input, init, response, { cap = POSTGREST_ROW_CAP } = {}) {
  if (!response || !response.ok) return null;
  const method = String(init?.method || input?.method || "GET").toUpperCase();
  if (method !== "GET") return null;

  const url = requestUrl(input);
  if (!url) return null;
  const idx = url.pathname.indexOf("/rest/v1/");
  if (idx === -1) return null;

  // Kaldet bad selv om et vindue (.range()/.limit()) — så er 1.000 et bevidst valg.
  if (url.searchParams.has("limit") || url.searchParams.has("offset")) return null;
  const reqHeaders = init?.headers ?? input?.headers;
  if (headerValue(reqHeaders, "range")) return null;
  if (/vnd\.pgrst\.object/i.test(headerValue(reqHeaders, "accept"))) return null;

  const rows = rowsFromContentRange(headerValue(response.headers, "content-range"));
  if (rows !== cap) return null;

  const table = decodeURIComponent(url.pathname.slice(idx + "/rest/v1/".length)) || "(ukendt)";
  const params = [...new Set([...url.searchParams.keys()])].sort();
  return { table, shape: params.join(","), rows };
}

/**
 * Pak en fetch ind, så hvert svar vurderes efter at det er modtaget. Svaret
 * returneres altid uændret; en fejl i selve vurderingen sluges (alarmen må aldrig
 * vælte et kald).
 *
 * @param {typeof fetch} baseFetch
 * @param {{ report?: (finding: {table:string, shape:string, rows:number}) => void,
 *           dedupeMs?: number, now?: () => number, cap?: number }} opts
 */
export function withRowCapAlarm(baseFetch, { report, dedupeMs = DEFAULT_DEDUPE_MS, now = () => Date.now(), cap = POSTGREST_ROW_CAP } = {}) {
  const lastReported = new Map();
  return async function supabaseFetchWithRowCapAlarm(input, init) {
    const response = await baseFetch(input, init);
    try {
      const finding = inspectRowCapResponse(input, init, response, { cap });
      if (finding && typeof report === "function") {
        const key = `${finding.table}?${finding.shape}`;
        const t = now();
        const prev = lastReported.get(key);
        if (prev == null || t - prev >= dedupeMs) {
          lastReported.set(key, t);
          report(finding);
        }
      }
    } catch {
      // best-effort: alarmen er et driftssignal; den må aldrig ændre eller vælte svaret.
    }
    return response;
  };
}

/** Fast Sentry-besked + fingerprint, så alle afkortninger af samme tabel samles. */
export function rowCapAlarmMessage(finding) {
  return `Supabase-svar ramte rækkeloftet (${finding.rows} rækker uden .range/.limit): ${finding.table}`;
}

export function rowCapAlarmFingerprint(finding) {
  return ["supabase-row-cap", finding.table];
}
