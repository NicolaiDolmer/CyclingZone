// Version af handelsbetingelserne (#2813). Bumpes når vilkårsteksten ændres
// substantielt — accept-loggen på subscriptions gemmer denne værdi, og backenden
// afviser checkout hvis klientens version ikke matcher CURRENT_TERMS_VERSION i
// backend/lib/billingCheckout.js (hold de to i sync).
export const TERMS_VERSION = "2026-07-30";
