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
import * as Sentry from "@sentry/react";

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
  if (!ENABLED || !action) return;
  const { reason, status, cause, context } = detail;
  const scope = {
    level: "warning",
    tags: { player_action: action },
    extra: { reason: trim(reason), status, ...context },
  };
  if (cause instanceof Error) {
    scope.tags.player_action_kind = "threw";
    Sentry.captureException(cause, scope);
    return;
  }
  scope.tags.player_action_kind = "rejected";
  Sentry.captureMessage(`player action rejected: ${action}`, scope);
}

// Kun til test — lader unit-tests verificere trim-adfærden uden Sentry-runtime.
export const __testing__ = { trim };
