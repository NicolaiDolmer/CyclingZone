// #2718/#2719: en spiller-handling der fejler må ikke dø tavst.
//
// Baggrund: Clarity viste et rage-click-mønster (kontrakt-knap klikket 15 gange)
// UDEN en eneste JS-fejl i Sentry i samme periode. Det er ikke fordi intet gik
// galt — det er fordi hele frontenden fanger fejl fra spiller-handlinger, viser
// dem som en lokaliseret streng i UI'et, og så kaster dem væk. Der er derfor
// ingen telemetri på "handlingen blev afvist" overhovedet.
//
// Denne helper lukker det hul: hver gang en spiller-initieret mutation fejler
// (HTTP-fejl, afvist af backend-guard, eller netværksfejl), rapporterer vi den
// som en warning-event med et `player_action`-tag, så fejlende handlinger kan
// tælles og grupperes i Sentry — uafhængigt af om UI'et allerede viste noget.
//
// GDPR: kun spil-id'er (rider/auction/team) og backend-fejlkoder. Aldrig email,
// holdnavn eller anden PII — samme linje som setSentryUser i sentry.jsx (#621).
//
// ── #3767: afvisninger er produktdata, ikke hændelser ────────────────────────
//
// Oprindeligt gik BEGGE udfald til Sentry som issues. Det gav en flade der
// hverken virkede som drift eller som analyse: de fem `player action rejected`-
// issues stod `archived_until_escalating`, kunne pr. definition ikke udløse
// projektets eneste alarmregel (kun high-priority), og blev derfor aldrig set.
// 51 afvisninger over 30 dage — heriblandt 13 spillere stoppet af
// `contract_extension_cap_reached` — lå usete i arkivet.
//
// De to udfald er forskellige ting og hører derfor to forskellige steder:
//
//   rejected — backend/UI sagde nej til en gyldig forespørgsel (for lavt bud,
//              loft nået). Det er ikke en fejl; det er en spiller der rammer en
//              væg. → player_events, hvor det kan tælles og krydses med resten
//              af produktanalysen. Sentry får kun en breadcrumb, så konteksten
//              stadig følger med hvis der SENERE sker en ægte fejl i samme
//              session. Breadcrumbs opretter ingen issues og larmer derfor ikke.
//
//   threw    — en Error slap ud (netværk, uventet tilstand). Det ER en
//              hændelse. → Sentry som exception, uændret.
//
// Konsekvensen er at Sentrys issue-liste igen kun indeholder rigtige fejl, så
// en bred alarmregel ("giv besked ved nye unresolved issues") bliver brugbar i
// stedet for at spamme. Prisen: player_events er consent-gated, så afvisninger
// fra spillere uden analytics-samtykke tælles ikke. Det er den rigtige GDPR-
// position for adfærdsdata, og undertællingen er ensartet på tværs af events.
import * as Sentry from "@sentry/react";
import { logEvent } from "./logEvent.js";

const ENABLED = import.meta.env.PROD && Boolean(import.meta.env.VITE_SENTRY_DSN);

// Fejlbeskeder er lokaliserede og kan være lange; klip dem så en enkelt event
// ikke bærer en hel UI-tekst med sig.
function trim(value, max = 200) {
  if (typeof value !== "string") return undefined;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Rapportér at en spiller-initieret handling blev afvist eller fejlede.
 *
 * @param {string} action  Stabilt slug, fx "rider_contract_extend" eller
 *                         "auction_proxy_remove". Bruges som Sentry-tag, så hold
 *                         det lavt-kardinalt (ingen id'er i selve navnet).
 * @param {object} [detail]
 * @param {string} [detail.reason]  Backend-/UI-fejltekst eller fejlkode.
 * @param {number} [detail.status]  HTTP-status hvis kendt.
 * @param {unknown} [detail.cause]  Kastet Error (netværksfejl) hvis der var en.
 * @param {object} [detail.context] Spil-id'er, fx { riderId, auctionId }.
 */
export function reportActionFailure(action, detail = {}) {
  if (!action) return;
  const { reason, status, cause, context } = detail;
  const trimmedReason = trim(reason);

  // threw: en ægte Error slap ud → Sentry-exception, uændret adfærd.
  if (cause instanceof Error) {
    if (!ENABLED) return;
    Sentry.captureException(cause, {
      level: "warning",
      tags: { player_action: action, player_action_kind: "threw" },
      extra: { reason: trimmedReason, status, ...context },
    });
    return;
  }

  // rejected: spilleren blev stoppet af en regel. Produktdata (#3767).
  // logEvent har sine egne gates (samtykke + auth) og er fire-and-forget —
  // instrumentering må aldrig vælte spillerens flow.
  logEvent("action_rejected", {
    action,
    reason: trimmedReason,
    status,
    ...context,
  });

  // Breadcrumb, ikke captureMessage: giver konteksten videre til en eventuel
  // senere exception i samme session uden at oprette et issue.
  if (!ENABLED) return;
  Sentry.addBreadcrumb({
    category: "player_action",
    level: "warning",
    message: `player action rejected: ${action}`,
    data: { reason: trimmedReason, status, ...context },
  });
}

// Kun til test — lader unit-tests verificere trim-adfærden uden Sentry-runtime.
export const __testing__ = { trim };
