import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isBackendUnreachable, isBackendUnreachableMessage } from "./backendReachability.js";

describe("isBackendUnreachableMessage — de fire browser-ordlyd (#5312)", () => {
  test("Chrome/Edge: 'Failed to fetch'", () => {
    assert.equal(isBackendUnreachableMessage("TypeError: Failed to fetch"), true);
  });

  test("Firefox: 'NetworkError when attempting to fetch resource' — den der blev droppet", () => {
    assert.equal(
      isBackendUnreachableMessage("NetworkError when attempting to fetch resource"),
      true,
    );
  });

  test("Safari/WebKit: 'Load failed'", () => {
    assert.equal(isBackendUnreachableMessage("TypeError: Load failed"), true);
  });

  test("iOS WebKit: 'The Internet connection appears to be offline'", () => {
    assert.equal(
      isBackendUnreachableMessage("The Internet connection appears to be offline."),
      true,
    );
  });
});

describe("isBackendUnreachableMessage — chunk-fejl vinder altid", () => {
  // Den vigtigste test i filen: chunk-beskeden INDEHOLDER "Failed to fetch".
  // Uden chunk-vagten ville et deploy-skred blive vist for spilleren som
  // "kan ikke naa serveren" og lande i netvaerks-gruppen i Sentry i stedet
  // for chunk-gruppen (#4545).
  test("ChunkLoadError med 'Failed to fetch dynamically imported module' er IKKE netvaerksfejl", () => {
    assert.equal(
      isBackendUnreachableMessage(
        "ChunkLoadError: Failed to fetch dynamically imported module (chunk reload needed): Importing a module script failed.",
      ),
      false,
    );
  });

  test("WebKit-varianten 'Importing a module script failed' er heller ikke netvaerksfejl", () => {
    assert.equal(
      isBackendUnreachableMessage("Importing a module script failed."),
      false,
    );
  });
});

describe("isBackendUnreachableMessage — hvad der IKKE tælles med", () => {
  test("tom og manglende tekst", () => {
    assert.equal(isBackendUnreachableMessage(""), false);
    assert.equal(isBackendUnreachableMessage(null), false);
    assert.equal(isBackendUnreachableMessage(undefined), false);
  });

  test("en almindelig HTTP-fejl er ikke en transport-fejl", () => {
    // Serveren SVAREDE — det er noget andet end at kaldet aldrig naaede frem,
    // og spilleren skal ikke have besked om sin netvaerksforbindelse.
    assert.equal(isBackendUnreachableMessage("HTTP 500: Internal Server Error"), false);
    assert.equal(isBackendUnreachableMessage("Unauthorized"), false);
  });

  test("et aegte crash er ikke en transport-fejl", () => {
    assert.equal(
      isBackendUnreachableMessage("TypeError: Cannot read properties of undefined (reading 'id')"),
      false,
    );
  });
});

describe("isBackendUnreachable — fra fejl-objekt", () => {
  test("laeser message", () => {
    assert.equal(isBackendUnreachable(new TypeError("Failed to fetch")), true);
  });

  test("laeser cause (fejl pakket ind af et kaldsted)", () => {
    const wrapped = new Error("Dashboard load failed", {
      cause: new TypeError("NetworkError when attempting to fetch resource"),
    });
    assert.equal(isBackendUnreachable(wrapped), true);
  });

  test("null/undefined giver false, ikke et kast", () => {
    assert.equal(isBackendUnreachable(null), false);
    assert.equal(isBackendUnreachable(undefined), false);
  });
});
