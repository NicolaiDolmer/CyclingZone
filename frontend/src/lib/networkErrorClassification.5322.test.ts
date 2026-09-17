// #5322 — isNetworkError + apiUrl.
//
// Klassifikatoren er det kaldsiderne bruger til at vælge mellem "vi kan ikke
// nå serveren lige nu" og "noget gik galt". Den skal kunne begge former en
// fejl kan have i appen: apiFetch's RESULTAT (som efter #5322 ikke længere
// kaster ved en transportfejl) og en KASTET fejl (Supabase-klienten og de
// endnu ikke migrerede bare fetch-kaldsteder, #5242).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isNetworkError, NETWORK_ERROR_MESSAGE_KEY } from "./networkErrorGuards.ts";
import { apiUrl } from "./apiBase.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function apiFetchResult(over: Record<string, unknown> = {}) {
  return { ok: false, status: 0, data: null, ...over };
}

test("isNetworkError genkender apiFetch's netværks-resultat", () => {
  assert.equal(isNetworkError(apiFetchResult({ networkError: true })), true);
});

test("isNetworkError siger NEJ til et HTTP-fejlsvar — serveren svarede jo", () => {
  assert.equal(isNetworkError(apiFetchResult({ status: 500, data: { error: "boom" } })), false);
  assert.equal(isNetworkError(apiFetchResult({ status: 401, unauthorized: true })), false);
  assert.equal(isNetworkError(apiFetchResult({ status: 429, limited: true })), false);
  assert.equal(isNetworkError(apiFetchResult({ ok: true, status: 200, data: { riders: [] } })), false);
});

test("isNetworkError læser IKKE et 5xx-svars krop som en fejltekst", () => {
  // Et serversvar der tilfældigvis indeholder browser-ordlyden må ikke blive
  // vist som et netværksproblem hos spilleren — resultatet afgøres KUN på
  // sit eget flag (og den bevarede oprindelige exception).
  const result = apiFetchResult({ status: 500, data: { error: "Failed to fetch upstream provider" } });
  assert.equal(isNetworkError(result), false);
});

test("isNetworkError genkender en KASTET transportfejl (alle fire browser-ordlyde)", () => {
  for (const message of [
    "Failed to fetch", // Chrome, Edge
    "NetworkError when attempting to fetch resource.", // Firefox
    "Load failed", // Safari, WebKit
    "The Internet connection appears to be offline.", // iOS WebKit
  ]) {
    assert.equal(isNetworkError(new TypeError(message)), true, message);
  }
});

test("isNetworkError falder tilbage til resultatets bevarede exception", () => {
  // Et resultat uden flag, men med en transport-exception i `error`, er stadig
  // et netværkssvigt — flaget og exception'en må ikke kunne modsige hinanden.
  assert.equal(isNetworkError(apiFetchResult({ error: new TypeError("Failed to fetch") })), true);
});

test("isNetworkError siger NEJ til en chunk-load-fejl (den har sin egen bane, #4545)", () => {
  // "Failed to fetch dynamically imported module" er et deploy-skred, ikke et
  // netværksproblem hos spilleren. Klassifikationen arves fra
  // backendReachability.js, og guarden skal gælde HER også.
  assert.equal(
    isNetworkError(new TypeError("Failed to fetch dynamically imported module: /assets/Dashboard-abc.js")),
    false,
  );
});

test("isNetworkError siger NEJ til en almindelig programfejl og til tomme værdier", () => {
  assert.equal(isNetworkError(new Error("Cannot read properties of null")), false);
  assert.equal(isNetworkError(null), false);
  assert.equal(isNetworkError(undefined), false);
});

test("NETWORK_ERROR_MESSAGE_KEY findes i BEGGE sprog (key-parity), uden em-dash", () => {
  const [ns, key] = NETWORK_ERROR_MESSAGE_KEY.split(":");
  assert.equal(ns, "common");
  const localePath = (lang: string) =>
    join(__dirname, "..", "..", "public", "locales", lang, `${ns}.json`);
  const en = JSON.parse(readFileSync(localePath("en"), "utf8")) as Record<string, string>;
  const da = JSON.parse(readFileSync(localePath("da"), "utf8")) as Record<string, string>;
  assert.ok(en[key], `en ${ns}.json mangler ${key}`);
  assert.ok(da[key], `da ${ns}.json mangler ${key}`);
  // #2849 — ingen em-dash i spiller-vendt copy (tone-check-em-dash.mjs).
  assert.doesNotMatch(en[key], /—/);
  assert.doesNotMatch(da[key], /—/);
  // DA skrives med rigtige æøå, aldrig ae/oe/aa i player-facing copy.
  assert.match(da[key], /å/, "den danske tekst skal bruge rigtige æøå-bogstaver");
});

// ── apiUrl ─────────────────────────────────────────────────────────────────

test("apiUrl sætter basen foran en relativ sti", () => {
  assert.equal(apiUrl("/api/board/status", "https://api.test"), "https://api.test/api/board/status");
});

test("apiUrl tilføjer den manglende skråstreg i stedet for at klistre sammen", () => {
  assert.equal(apiUrl("api/board/status", "https://api.test"), "https://api.test/api/board/status");
});

test("apiUrl dobbelt-skråstreger ikke når basen ender på én", () => {
  // Basen normaliseres i apiBase(); helperen selv får den normaliserede form,
  // men en injiceret base skal heller ikke kunne give "//api".
  assert.equal(apiUrl("/api/x", "https://api.test".replace(/\/+$/, "")), "https://api.test/api/x");
});

test("apiUrl lader en FÆRDIG url passere uændret (bagudkompatibilitet for de ~22 apiFetch-kaldsteder)", () => {
  assert.equal(apiUrl("https://api.test/api/x", "https://other.test"), "https://api.test/api/x");
  assert.equal(apiUrl("http://localhost:3000/api/x", "https://other.test"), "http://localhost:3000/api/x");
  assert.equal(apiUrl("//cdn.test/api/x", "https://other.test"), "//cdn.test/api/x");
});

test("apiUrl uden base giver en ren relativ sti — aldrig 'undefined/api/x'", () => {
  assert.equal(apiUrl("/api/x", ""), "/api/x");
});
