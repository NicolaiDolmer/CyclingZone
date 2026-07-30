import { createAluntaClient } from "./alunta.js";
import { captureException } from "./sentry.js";

// Plan-id'er kommer fra Infisical (oprettes i Alunta). Læses ved modul-load;
// hvis de mangler (endnu ikke sat), fejler checkout pænt med 400.
export const PLAN_IDS = {
  monthly: process.env.ALUNTA_CZ_PRO_PLAN_ID_MONTHLY,
  semiannual: process.env.ALUNTA_CZ_PRO_PLAN_ID_SEMIANNUAL,
};

// #2813: køb er pauset indtil go-live-kravene er på plads (support-e-mail +
// moms/plan-konfiguration verificeret hos Alunta — se docs/legal/
// TERMS_DRAFT_2026-07-30.md "Åbne verifikationer"). Vilkårs-sider + accept-flow
// + opsigelsessti ER bygget; ejer flipper flaget når resten er verificeret.
// Skal holdes i sync med CHECKOUT_PAUSED i ProUpgradePage.jsx.
export const CHECKOUT_PAUSED = true;

// #2813: version af handelsbetingelserne kunden accepterer ved checkout.
// Skal matche TERMS_VERSION i frontend/src/lib/termsVersion.js — mismatch
// afvises med 400, så en klient med forældet vilkårstekst tvinges til reload
// og re-accept af den gældende version.
export const CURRENT_TERMS_VERSION = "2026-07-30";

export function createCheckoutHandler({
  client = createAluntaClient(),
  planIds = PLAN_IDS,
  appBaseUrl = process.env.FRONTEND_URL ?? "https://cyclingzone.org",
  paused = CHECKOUT_PAUSED,
  currentTermsVersion = CURRENT_TERMS_VERSION,
  supabase = null,
} = {}) {
  return async function checkout(req, res) {
    if (paused) return res.status(503).json({ error: "Checkout paused", errorCode: "checkout_paused" });
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const interval = req.body?.interval;
    const planId = planIds[interval];
    if (!planId) return res.status(400).json({ error: "Unknown plan interval", errorCode: "unknown_interval" });

    // #2813: eksplicit accept af handelsbetingelser + straks-leverings-waiver er
    // et lovkrav (forbrugeraftaleloven) — ingen accept, ingen checkout.
    if (req.body?.terms_accepted !== true) {
      return res.status(400).json({ error: "Terms not accepted", errorCode: "terms_not_accepted" });
    }
    if (req.body?.terms_version !== currentTermsVersion) {
      return res.status(400).json({ error: "Terms version mismatch", errorCode: "terms_version_mismatch" });
    }

    try {
      // Accept-loggen skrives FØR sessionen oprettes: beviset for accepten må
      // aldrig mangle for en gennemført betaling. Webhook-upserten (aluntaWebhook.js)
      // inkluderer ikke terms-kolonnerne, så de overlever aktivering.
      if (supabase) {
        const { error: termsErr } = await supabase.from("subscriptions").upsert(
          {
            team_id: req.team.id,
            terms_version: currentTermsVersion,
            terms_accepted_at: new Date().toISOString(),
          },
          { onConflict: "team_id" },
        );
        if (termsErr) throw new Error(`terms accept-log fejlede: ${termsErr.message}`);
      }

      await client.ensureCustomer({ externalCustomerId: req.team.id, name: req.team.name, email: req.user?.email });
      const checkoutUrl = await client.createCheckoutSession({
        externalCustomerId: req.team.id,
        planId,
        successUrl: `${appBaseUrl}/pro/success`,
        backUrl: `${appBaseUrl}/pro`,
      });
      return res.status(200).json({ checkout_url: checkoutUrl });
    } catch (err) {
      // #2389 A2: betalings-/omsætningskritisk flow — en fejlet checkout var kun
      // synlig som 502 hos klienten, aldrig i Sentry-triage.
      captureException(err, { tags: { flow: "billing", stage: "checkout" }, teamId: req.team.id, interval });
      return res.status(502).json({ error: "Checkout failed", detail: String(err.message || err) });
    }
  };
}

export default createCheckoutHandler;
