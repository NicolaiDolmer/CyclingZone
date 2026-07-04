import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isNetworkError, mapSupabaseAuthError, isEmailNotConfirmedError } from "./authErrors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = join(__dirname, "..", "..", "public", "locales");

// #1348 — netværksfejl ved login/signup/password-reset skal mappes til den
// EKSISTERENDE connection-error-copy (errors:generic.networkError), så et
// rejected Supabase-kald (offline/dropped connection) giver en handlingsanvisende
// besked i stedet for at efterlade formularen tom eller vise rå engelsk tekst.

// Fake t() returnerer key'en uændret, så vi kan asserte HVILKEN i18n-key der vælges.
const t = (key) => key;

test("isNetworkError genkender browser TypeError 'Failed to fetch' (#1348)", () => {
  assert.equal(isNetworkError(new TypeError("Failed to fetch")), true);
});

test("isNetworkError genkender supabase-js AuthRetryableFetchError via name (#1348)", () => {
  const err = new Error("request failed");
  err.name = "AuthRetryableFetchError";
  assert.equal(isNetworkError(err), true);
});

test("isNetworkError genkender NetworkError / fetch failed / load failed-varianter (#1348)", () => {
  assert.equal(isNetworkError(new Error("NetworkError when attempting to fetch resource")), true);
  assert.equal(isNetworkError(new Error("network error")), true);
  assert.equal(isNetworkError(new Error("fetch failed")), true);
  assert.equal(isNetworkError(new Error("Load failed")), true);
});

test("isNetworkError er false for almindelige auth-fejl og tomt input (#1348)", () => {
  assert.equal(isNetworkError(new Error("Invalid login credentials")), false);
  assert.equal(isNetworkError(null), false);
  assert.equal(isNetworkError(undefined), false);
  assert.equal(isNetworkError(""), false);
});

test("mapSupabaseAuthError mapper netværksfejl til generic.networkError (#1348)", () => {
  // Dette er kernen i #1348: et rejected kald (network) skal blive til en
  // ACTIONABLE besked — ikke den rå "Failed to fetch".
  assert.equal(
    mapSupabaseAuthError(new TypeError("Failed to fetch"), t),
    "errors:generic.networkError",
  );
  const retryable = new Error("dropped");
  retryable.name = "AuthRetryableFetchError";
  assert.equal(mapSupabaseAuthError(retryable, t), "errors:generic.networkError");
});

test("mapSupabaseAuthError bevarer den eksisterende Supabase-fejlmapping (#1348)", () => {
  // Forward-guard: network-grenen må ikke ødelægge den kendte mapping.
  assert.equal(
    mapSupabaseAuthError({ message: "Invalid login credentials" }, t),
    "errors:supabase.invalidCredentials",
  );
  assert.equal(
    mapSupabaseAuthError({ message: "Token has expired" }, t),
    "errors:supabase.tokenExpired",
  );
  assert.equal(
    mapSupabaseAuthError({ message: "User already registered" }, t),
    "errors:supabase.userAlreadyRegistered",
  );
});

test("mapSupabaseAuthError mapper begge rate-limit-varianter til rateLimited (#2068)", () => {
  // Live test mod prod (resend-knap) viste Supabases dynamiske "...after N
  // seconds"-variant — kun "...this once" var dækket før, så det faldt
  // igennem til den rå engelske besked i stedet for den oversatte copy.
  assert.equal(
    mapSupabaseAuthError({ message: "For security purposes, you can only request this once every 60 seconds" }, t),
    "errors:supabase.rateLimited",
  );
  assert.equal(
    mapSupabaseAuthError({ message: "For security purposes, you can only request this after 54 seconds" }, t),
    "errors:supabase.rateLimited",
  );
});

test("isEmailNotConfirmedError genkender BÅDE code og message (#2172)", () => {
  // Kernen i #2172-hærdningen: resend-knappen må aldrig tavst forsvinde. Vi
  // matcher supabase-js' stabile machine-code OG den engelske message, så et
  // ordlyds-skifte fra Supabase ikke efterlader en ubekræftet spiller uden
  // vej videre.
  assert.equal(isEmailNotConfirmedError({ code: "email_not_confirmed" }), true);
  assert.equal(isEmailNotConfirmedError({ message: "Email not confirmed" }), true);
  // Kun en anden fejl med samme HTTP-status må IKKE trigge resend.
  assert.equal(isEmailNotConfirmedError({ code: "invalid_credentials", message: "Invalid login credentials" }), false);
  assert.equal(isEmailNotConfirmedError(null), false);
  assert.equal(isEmailNotConfirmedError(""), false);
  assert.equal(isEmailNotConfirmedError("Email not confirmed"), true);
});

test("mapSupabaseAuthError falder tilbage til unknown ved tom besked (#1348)", () => {
  assert.equal(mapSupabaseAuthError({}, t), "errors:supabase.unknown");
});

test("connection-error-copy findes allerede i BÅDE en og da errors.json (ingen ny copy) (#1348)", () => {
  // Guard: vi opfinder IKKE ny player-facing copy — vi mapper til den
  // eksisterende generic.networkError i begge sprog.
  for (const lang of ["en", "da"]) {
    const errors = JSON.parse(readFileSync(join(localesDir, lang, "errors.json"), "utf8"));
    assert.ok(
      errors.generic && typeof errors.generic.networkError === "string" && errors.generic.networkError.length > 0,
      `${lang}/errors.json mangler generic.networkError — mapSupabaseAuthError ville pege på en ikke-eksisterende key`,
    );
  }
});
