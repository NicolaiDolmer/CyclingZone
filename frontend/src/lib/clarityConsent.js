// #2041/#3189 root cause: Clarity was only ever loaded after our own
// analytics-consent gate was true, but we never told *Clarity itself* about
// consent via its consentv2 API. Per Microsoft's docs, without an explicit
// consent signal Clarity treats EEA/UK/CH traffic (the large majority of our
// players) as unconsented and assigns a brand-new identity PER PAGE VIEW
// instead of persisting one across a visit/session — exactly the symptom
// verified in #2041/#3189: sessions ~= users (1:1), ~1 page/session, and
// "returning users" ~0, even though identify() (#1797) fires correctly with
// a stable id every time. Sending this signal is the actual stitching fix;
// identify() was investigated and confirmed NOT the cause (#3189, 2026-08-03)
// and is left untouched.
//
// ad_Storage stays "denied" — Clarity is behavioural analytics only here, we
// don't use it for ad targeting. analytics_Storage is always "granted"
// because Clarity is only ever initialized once our own analytics consent
// gate is already true (see clarityIntegration.jsx) — this payload is never
// sent without consent having been given first.
//
// Kept in its own leaf module (no react/supabase imports) so it can be
// imported directly in node --test, mirroring trafficBeacon.js's pattern.
export const CLARITY_CONSENT_V2_PAYLOAD = Object.freeze({
  ad_Storage: "denied",
  analytics_Storage: "granted",
});
