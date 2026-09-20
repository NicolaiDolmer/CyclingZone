// #5089 — apiFetch: Retry-After-vindue + ingen fejlkasse for et 429 der løses
// af at vente ("stille backoff") + ét 401-dispatch, aldrig en retry.
import test from "node:test";
import assert from "node:assert/strict";
import {
  apiFetch,
  parseRetryAfterSeconds,
  _clearRetryWindowsForTests,
  type ApiFetchResponseLike,
  type ApiFetchImpl,
} from "./apiFetch.ts";
import type { AuthClientLike } from "./networkErrorGuards.ts";

test.beforeEach(() => _clearRetryWindowsForTests());

function fakeAuthClient(): AuthClientLike {
  return {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: null }, error: { status: 401 } }),
      signOut: async () => {},
    },
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): ApiFetchResponseLike {
  const headerMap = new Map(Object.entries(headers));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headerMap.get(k) ?? null },
    json: async () => body,
    clone() {
      return jsonResponse(status, body, headers);
    },
  };
}

test("parseRetryAfterSeconds læser heltals-headeren (backendens draft-7-form)", () => {
  const res = jsonResponse(429, null, { "Retry-After": "42" });
  assert.equal(parseRetryAfterSeconds(res, null), 42);
});

test("parseRetryAfterSeconds falder tilbage til retry_after_seconds i kroppen", () => {
  const res = jsonResponse(429, null, {});
  assert.equal(parseRetryAfterSeconds(res, { retry_after_seconds: 17 }), 17);
});

test("parseRetryAfterSeconds accepterer en HTTP-dato-form, og runder OP (Math.ceil, ikke Math.round)", () => {
  // toUTCString formaterer altid til et helt sekund — vælg derfor et "nu" der
  // IKKE selv ligger på et helt sekund, så differencen bliver brøkdel-sekunder
  // og round/ceil rent faktisk kan give forskellige svar (3.2s: round → 3,
  // ceil → 4). Epoch-millisekunder skrevet direkte, ikke "now + X", for ikke
  // selv at snuble i toUTCString's afrunding.
  const now = 1_000_800;
  const future = new Date(1_004_000).toUTCString(); // helt sekund, som HTTP-date kræver
  const res = jsonResponse(429, null, { "Retry-After": future });
  const seconds = parseRetryAfterSeconds(res, null, () => now);
  assert.equal(seconds, 4, "3.2s skal rundes OP til 4 — Math.round ville i stedet give 3, FØR den dato serveren bad om");
});

test("parseRetryAfterSeconds bruger det INJICEREDE ur til dato-grenen, ikke det ægte (CodeRabbit-fund)", () => {
  // Fiktivt "nu" = 1970 (epoch 0), vidt forskelligt fra det ægte ur (2026).
  // Datoen er 10s EFTER det fiktive nu. Brugte koden det ægte Date.now() ved
  // en fejl, ville 1970+10s ligge langt i FORTIDEN og klampes til 0 — så
  // enhver værdi ANDET end 0 beviser at det er det injicerede ur der bruges.
  const fakeNow = 0;
  const future = new Date(fakeNow + 10_000).toUTCString();
  const res = jsonResponse(429, null, { "Retry-After": future });
  const seconds = parseRetryAfterSeconds(res, null, () => fakeNow);
  assert.equal(seconds, 10, "skal regnes mod det injicerede ur, ikke mod Date.now()");
});

test("parseRetryAfterSeconds returnerer null uden hverken header eller krop", () => {
  const res = jsonResponse(429, null, {});
  assert.equal(parseRetryAfterSeconds(res, null), null);
});

test("et 429 sætter et vindue — ingen automatisk retry før det er udløbet (#5089 punkt 2)", async () => {
  let now = 1_000_000;
  let fetchCalls = 0;
  const fetchImpl: ApiFetchImpl = async () => {
    fetchCalls += 1;
    return jsonResponse(429, { retry_after_seconds: 10 }, { "Retry-After": "10" });
  };
  const url = "https://api.test/api/riders/1/development";

  const first = await apiFetch(url, {}, { now: () => now, fetchImpl });
  assert.equal(first.limited, true);
  assert.equal(fetchCalls, 1);

  now += 3_000; // stadig inden for vinduet
  const second = await apiFetch(url, {}, { now: () => now, fetchImpl });
  assert.equal(second.limited, true, "et kald inden for vinduet skal IKKE nå netværket");
  assert.equal(fetchCalls, 1, "fetchImpl må ikke kaldes igen mens vinduet står");
  assert.equal(second.data, null, "et blokeret kald skal ikke lade som om det har et 429-svars krop");
});

test("et 429-vindue er stille backoff, ikke en fejl (#5089 punkt 2: ingen fejlkasse)", async () => {
  const fetchImpl: ApiFetchImpl = async () => jsonResponse(429, { retry_after_seconds: 5 }, { "Retry-After": "5" });
  const result = await apiFetch("https://api.test/x", {}, { now: () => 0, fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.limited, true, "kaldstedet skal kunne skelne 'vent stille' fra en rigtig fejl");
});

test("vinduet er pr. url — en anden ressource rammes ikke af naboens 429", async () => {
  const now = 0;
  const fetchImpl: ApiFetchImpl = async (url) =>
    url.endsWith("/development")
      ? jsonResponse(429, { retry_after_seconds: 10 }, { "Retry-After": "10" })
      : jsonResponse(200, { ok: true });
  await apiFetch("https://api.test/api/riders/1/development", {}, { now: () => now, fetchImpl });
  const other = await apiFetch("https://api.test/api/riders/1/value-trend", {}, { now: () => now, fetchImpl });
  assert.equal(other.limited, undefined);
  assert.deepEqual(other.data, { ok: true });
});

test("efter vinduet er udløbet, når kaldet netværket igen", async () => {
  let now = 0;
  let calls = 0;
  const fetchImpl: ApiFetchImpl = async () => {
    calls += 1;
    return calls === 1
      ? jsonResponse(429, { retry_after_seconds: 5 }, { "Retry-After": "5" })
      : jsonResponse(200, { ok: true });
  };
  const url = "https://api.test/x";
  await apiFetch(url, {}, { now: () => now, fetchImpl });
  now += 5_001; // lige efter vinduet
  const after = await apiFetch(url, {}, { now: () => now, fetchImpl });
  assert.equal(calls, 2, "andet kald skal ramme netværket igen");
  assert.deepEqual(after.data, { ok: true });
});

test("et 401 afleveres til networkErrorGuards og retry'es aldrig automatisk (#5089 punkt 3)", async () => {
  let fetchCalls = 0;
  const fetchImpl: ApiFetchImpl = async () => {
    fetchCalls += 1;
    return jsonResponse(401, { error: "invalid_token" });
  };
  const result = await apiFetch(
    "https://api.test/x",
    { headers: { Authorization: "Bearer tok-1" } },
    { now: () => 0, fetchImpl, authClient: fakeAuthClient() },
  );
  assert.equal(result.unauthorized, true);
  assert.equal(fetchCalls, 1, "apiFetch selv må aldrig gentage kaldet efter en 401");
});

test("en almindelig 2xx passerer uændret igennem", async () => {
  const fetchImpl: ApiFetchImpl = async () => jsonResponse(200, { riders: [] });
  const result = await apiFetch("https://api.test/x", {}, { now: () => 0, fetchImpl });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { riders: [] });
});

test("en 404/500 sendes uændret videre — modulet opfinder ingen ny fejlhåndtering for dem", async () => {
  const fetchImpl: ApiFetchImpl = async () => jsonResponse(500, { error: "boom" });
  const result = await apiFetch("https://api.test/x", {}, { now: () => 0, fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(result.limited, undefined);
  assert.equal(result.unauthorized, undefined);
});

// ── #5322: "nåede aldrig serveren" ≠ "serveren svarede en fejl" ─────────────

test("#5322 en transportfejl KASTER ikke — den bliver til { ok:false, status:0, networkError:true }", async () => {
  const transportFailure = new TypeError("Failed to fetch");
  const fetchImpl: ApiFetchImpl = async () => {
    throw transportFailure;
  };
  const result = await apiFetch("https://api.test/x", {}, { now: () => 0, fetchImpl });
  assert.equal(result.networkError, true);
  assert.equal(result.ok, false);
  assert.equal(result.status, 0, "status 0 er konventionen for 'intet HTTP-svar'");
  assert.equal(result.data, null);
  assert.equal(result.error, transportFailure, "den oprindelige exception skal bevares til logning/Sentry");
});

test("#5322 en HTTP-fejl er IKKE en netværksfejl — de to grene skal kunne skelnes", async () => {
  const fetchImpl: ApiFetchImpl = async () => jsonResponse(500, { error: "boom" });
  const result = await apiFetch("https://api.test/x", {}, { now: () => 0, fetchImpl });
  assert.notEqual(result.networkError, true, "et 500 ER et svar fra serveren");
  assert.equal(result.status, 500);
});

test("#5322 alle browseres transport-ordlyd giver samme entydige resultat", async () => {
  // Chrome/Edge, Firefox, Safari, iOS WebKit — fire ordlyde, én tilstand.
  for (const message of [
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
    "The Internet connection appears to be offline.",
  ]) {
    const fetchImpl: ApiFetchImpl = async () => {
      throw new TypeError(message);
    };
    const result = await apiFetch(`https://api.test/${encodeURIComponent(message)}`, {}, { now: () => 0, fetchImpl });
    assert.equal(result.networkError, true, `ordlyden "${message}" skal klassificeres som netværksfejl`);
    assert.equal(result.status, 0);
  }
});

test("#5322 en AFBRYDELSE (AbortController) kastes stadig — den er kaldstedets egen annullering", async () => {
  const abort = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
  const fetchImpl: ApiFetchImpl = async () => {
    throw abort;
  };
  await assert.rejects(
    () => apiFetch("https://api.test/x", {}, { now: () => 0, fetchImpl }),
    (err: unknown) => err === abort,
    "en unmount'et komponents afbrudte kald må aldrig vises som 'kan ikke nå serveren'",
  );
});

test("#5322 401-kæden er uændret af transport-grenen (ét dispatch, ingen retry, intet networkError-flag)", async () => {
  let fetchCalls = 0;
  const fetchImpl: ApiFetchImpl = async () => {
    fetchCalls += 1;
    return jsonResponse(401, { error: "invalid_token" });
  };
  const result = await apiFetch(
    "https://api.test/x",
    { headers: { Authorization: "Bearer tok-1" } },
    { now: () => 0, fetchImpl, authClient: fakeAuthClient() },
  );
  assert.equal(result.unauthorized, true);
  assert.equal(result.status, 401);
  assert.equal(result.networkError, undefined, "et 401 er et SVAR fra serveren, ikke en transportfejl");
  assert.equal(fetchCalls, 1);
});

test("#5322 en transportfejl sætter INGEN retry-vindue — næste forsøg må ramme netværket med det samme", async () => {
  let calls = 0;
  const fetchImpl: ApiFetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("Failed to fetch");
    return jsonResponse(200, { ok: true });
  };
  const url = "https://api.test/x";
  const first = await apiFetch(url, {}, { now: () => 0, fetchImpl });
  assert.equal(first.networkError, true);
  const second = await apiFetch(url, {}, { now: () => 0, fetchImpl });
  assert.equal(calls, 2, "429-vinduet er kun for 429'ere — en transportfejl må gerne prøves igen straks");
  assert.deepEqual(second.data, { ok: true });
});

test("#5322 en relativ sti opløses gennem apiUrl, og en færdig url passerer uændret", async () => {
  const seen: string[] = [];
  const fetchImpl: ApiFetchImpl = async (requestUrl) => {
    seen.push(requestUrl);
    return jsonResponse(200, { ok: true });
  };
  // Under node --test findes import.meta.env ikke, så basen er tom streng:
  // "/api/x" forbliver "/api/x". Pointen her er at kaldet IKKE forvanskes.
  await apiFetch("/api/x", {}, { now: () => 0, fetchImpl });
  await apiFetch("https://api.test/api/y", {}, { now: () => 0, fetchImpl });
  assert.deepEqual(seen, ["/api/x", "https://api.test/api/y"]);
});
