// frontend/src/lib/raceHubResponseGuard.ts
// #5291: en spiller fik `/api/races/distribution` til at svare HTTP 200 med en
// HTML-side (SPA-fallback, formentlig fordi API-basen var tom i klienten og
// kaldet derfor ramte frontend'ens egen vært) i stedet for JSON. RaceHubBoard's
// load() prøvede at parse svaret som JSON og kastede en rå SyntaxError.
//
// Denne rene helper lader load() tjekke Content-Type FØR den kalder res.json(),
// så en HTML-200 rammer den eksisterende "parse"-fejlgren direkte i stedet for
// at først skulle fejle inde i JSON.parse. Ingen React, ingen I/O — testbar med
// et rent mock-response-objekt (node --test, samme mønster som raceHubLogic.js).

/** Minimal form af et fetch-svar dette modul har brug for — injicérbar for test. */
export interface ResponseLike {
  headers?: {
    get?: (name: string) => string | null | undefined;
  } | null;
}

// Henter Content-Type-headeren defensivt (mock-responses i tests har ikke altid
// en fuld Headers-instans).
export function responseContentType(res: ResponseLike | null | undefined): string {
  return res?.headers?.get?.("content-type") || "";
}

// #5291: kun selve JSON-mediatypen tæller — en SPA-fallback svarer typisk
// `text/html`, en proxy-fejlside kan svare `text/plain`. Case-insensitiv og
// robust mod et charset-suffiks (`application/json; charset=utf-8`).
export function isJsonContentType(res: ResponseLike | null | undefined): boolean {
  return responseContentType(res).toLowerCase().includes("application/json");
}
