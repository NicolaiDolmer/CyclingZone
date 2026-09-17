import test from "node:test";
import assert from "node:assert/strict";
import { isJsonContentType, responseContentType, type ResponseLike } from "./raceHubResponseGuard.ts";

// #5291: en spiller fik /api/races/distribution til at svare 200 med HTML
// (SPA-fallback) i stedet for JSON. Disse tests bruger et mock fetch-svar (ikke
// den ægte browser-fetch) til at pin at klassifikationen faktisk fanger den
// klasse af svar, i stedet for kun at antage det via kildekode-regex.
function mockResponse(contentType: string | null): ResponseLike & { ok: boolean; status: number } {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
  };
}

test("isJsonContentType: HTML-200 (SPA-fallback) er IKKE JSON", () => {
  // Netop den hændelse #5291 blev åbnet på: fetch mod en tom/forkert API-base
  // rammer frontend'ens egen vært, som svarer index.html med status 200.
  const res = mockResponse("text/html; charset=utf-8");
  assert.equal(isJsonContentType(res), false);
});

test("isJsonContentType: application/json (med og uden charset) ER JSON", () => {
  assert.equal(isJsonContentType(mockResponse("application/json")), true);
  assert.equal(isJsonContentType(mockResponse("application/json; charset=utf-8")), true);
  // Case-insensitiv — nogle proxyer/CDN'er sender headeren med anden cases.
  assert.equal(isJsonContentType(mockResponse("Application/JSON")), true);
});

test("isJsonContentType: manglende Content-Type-header er IKKE JSON", () => {
  assert.equal(isJsonContentType(mockResponse(null)), false);
  assert.equal(isJsonContentType({ headers: {} }), false);
  assert.equal(isJsonContentType({}), false);
});

test("responseContentType: læser headeren defensivt uden at kaste på et mock uden get()", () => {
  assert.equal(responseContentType(mockResponse("text/plain")), "text/plain");
  assert.equal(responseContentType({}), "");
  assert.equal(responseContentType(null), "");
});
