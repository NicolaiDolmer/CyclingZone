import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSupabaseErrorMessage,
  isTransientSupabaseError,
  toSupabaseError,
  withSupabaseRetry,
} from "./supabaseErrorNormalize.js";

// Realistiske Cloudflare-fejlsider (forkortet) som de lander i error.message når
// PostgREST/supabase-js får et non-JSON-svar fra gatewayen og text()'er det rå body.
const CF_522 = `<!DOCTYPE html>
<html class="no-js" lang="en-US"><head>
<title>supabase.co | 522: Connection timed out</title>
</head><body><div id="cf-error-details">
<span class="inline-block">Connection timed out</span>
<span class="code-label">Error code 522</span>
Cloudflare Ray ID: a13706d0887b12fa
</div></body></html>`;

const CF_525 = `<!DOCTYPE html>
<html class="no-js" lang="en-US"><head>
<title>supabase.co | 525: SSL handshake failed</title>
</head><body><div id="cf-error-details">
<span class="inline-block">SSL handshake failed</span>
<span class="code-label">Error code 525</span>
</div></body></html>`;

const HTML_NO_CODE = `<!DOCTYPE html>
<html><head><title>Service Unavailable</title></head><body>nginx</body></html>`;

// ── normalizeSupabaseErrorMessage ────────────────────────────────────────────

test("normaliserer Cloudflare 522 til kort, grupperbar besked", () => {
  assert.equal(
    normalizeSupabaseErrorMessage(CF_522),
    "Supabase unavailable (522 Connection timed out)"
  );
});

test("normaliserer Cloudflare 525 til kort besked", () => {
  assert.equal(
    normalizeSupabaseErrorMessage(CF_525),
    "Supabase unavailable (525 SSL handshake failed)"
  );
});

test("HTML-fejlside uden parsebar kode falder tilbage til generisk besked", () => {
  assert.equal(
    normalizeSupabaseErrorMessage(HTML_NO_CODE),
    "Supabase unavailable (HTML error page)"
  );
});

test("ægte PostgREST-fejlbesked passerer uændret igennem", () => {
  const msg = 'permission denied for table "riders"';
  assert.equal(normalizeSupabaseErrorMessage(msg), msg);
});

test("ikke-string input returneres uændret (defensivt)", () => {
  assert.equal(normalizeSupabaseErrorMessage(null), null);
  assert.equal(normalizeSupabaseErrorMessage(undefined), undefined);
});

// ── isTransientSupabaseError ─────────────────────────────────────────────────

test("Cloudflare 5xx-side er transient", () => {
  assert.equal(isTransientSupabaseError({ message: CF_522 }), true);
  assert.equal(isTransientSupabaseError({ message: CF_525 }), true);
});

test("netværksfejl er transient", () => {
  assert.equal(isTransientSupabaseError(new Error("fetch failed")), true);
  assert.equal(isTransientSupabaseError({ message: "read ECONNRESET" }), true);
});

test("permission denied er IKKE transient", () => {
  assert.equal(
    isTransientSupabaseError({ message: 'permission denied for table "riders"' }),
    false
  );
});

// ── toSupabaseError ──────────────────────────────────────────────────────────

test("toSupabaseError giver et Error med normaliseret besked", () => {
  const err = toSupabaseError({ message: CF_522, code: "522" });
  assert.ok(err instanceof Error);
  assert.equal(err.message, "Supabase unavailable (522 Connection timed out)");
});

// ── withSupabaseRetry ────────────────────────────────────────────────────────

test("retry'er transient fejl og lykkes på 3. forsøg", async () => {
  let attempts = 0;
  const result = await withSupabaseRetry(
    async () => {
      attempts++;
      if (attempts < 3) {
        const e = new Error(CF_522);
        throw e;
      }
      return "ok";
    },
    { retries: 3, sleepFn: async () => {} }
  );
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("retry'er IKKE en ikke-transient fejl — kaster med det samme", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      withSupabaseRetry(
        async () => {
          attempts++;
          throw new Error('permission denied for table "riders"');
        },
        { retries: 3, sleepFn: async () => {} }
      ),
    /permission denied/
  );
  assert.equal(attempts, 1);
});

test("ikke-transient plain Supabase-objekt bobler op som rigtigt Error med code", async () => {
  await assert.rejects(
    () =>
      withSupabaseRetry(
        async () => {
          // Supabase returnerer plain { message, code } — ikke et Error.
          throw { message: 'permission denied for table "riders"', code: "42501" };
        },
        { retries: 2, sleepFn: async () => {} }
      ),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /permission denied/);
      assert.equal(err.code, "42501");
      return true;
    }
  );
});

test("giver op efter retries og kaster normaliseret besked", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      withSupabaseRetry(
        async () => {
          attempts++;
          throw new Error(CF_522);
        },
        { retries: 2, sleepFn: async () => {} }
      ),
    /Supabase unavailable \(522 Connection timed out\)/
  );
  assert.equal(attempts, 3); // 1 initial + 2 retries
});
