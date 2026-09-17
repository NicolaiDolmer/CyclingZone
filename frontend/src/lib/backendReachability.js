// backendReachability — "naaede kaldet overhovedet frem?" (#5312).
//
// ── Hvorfor den findes ──────────────────────────────────────────────────────
//
// Hver browser har sin EGEN ordlyd for den samme transport-fejl (DNS, TLS,
// ingen rute, blokeret af et netvaerksfilter). De ser derfor ud som fire
// forskellige fejl i Sentry og som én uforstaaelig fejlkasse for spilleren,
// men er samme tilstand: browseren fik INTET HTTP-svar — i Firefox' konsol
// staar det som "Status code: (null)".
//
// Verificeret 17/9 paa #5312: en spiller paa Firefox fik 11 saadanne fejl paa
// dashboardet i traek. Chrome/Safari-ordlyden laa allerede i Sentry paa flere
// ANDRE spillere (CYCLINGZONE-57, -4Y, -50, -5T, -5K, senest samme dag), mens
// Firefox-ordlyden blev droppet helt i sentry.jsx' beforeSend. Omfanget var
// derfor umaaleligt, og foerste signal paa haendelsen 16/9 var en
// Discord-besked fra en spiller — ikke dashboardet. Samme laering som #4545.
//
// ── Hvorfor et EGET modul ───────────────────────────────────────────────────
//
// sentry.jsx ligger i entry-stien. Laa dette i networkErrorGuards.ts, ville
// importen traekke sessionExpiry + 401-kaeden med ind i entry-chunken, som
// allerede er for stor (#5177). Samme begrundelse som sentryDenyUrls.js: ren
// .js uden sidevirkninger, unit-testbar uden JSX/env, delt af begge kaldere.

import { getErrorText, isChunkLoadError } from "./chunkErrors.js";

/** Browser-ordlyd for "forbindelsen kom aldrig igennem". */
const TRANSPORT_FAILURE_PATTERNS = [
  /Failed to fetch/i, // Chrome, Edge
  /NetworkError when attempting to fetch resource/i, // Firefox
  /Load failed/i, // Safari, WebKit
  /The (?:Internet|network) connection appears to be offline/i, // iOS WebKit
];

/**
 * Er denne fejltekst en transport-fejl — altsaa "naaede aldrig serveren"?
 *
 * Chunk-fejl vinder ALTID. En fejlet modul-load hedder ogsaa "Failed to fetch
 * dynamically imported module", og den har sin egen bane (lazyWithRetry + eget
 * fingerprint, #4545). Blev en chunk-fejl klassificeret her, ville et
 * deploy-skred se ud som et netvaerksproblem hos spilleren — og spilleren ville
 * faa at vide at serveren ikke kan naas, selvom den kan. Derfor det BREDE
 * `isChunkLoadError` og ikke det snaevre: i tvivl er det en chunk.
 *
 * @param {string | null | undefined} text
 * @returns {boolean}
 */
export function isBackendUnreachableMessage(text) {
  if (!text) return false;
  if (isChunkLoadError({ message: text })) return false;
  return TRANSPORT_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Samme vurdering ud fra et fejl-objekt (name + message + stack + cause).
 * @param {unknown} error
 * @returns {boolean}
 */
export function isBackendUnreachable(error) {
  return isBackendUnreachableMessage(getErrorText(error));
}
