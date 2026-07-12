import { createAluntaClient } from "./alunta.js";
import { captureException } from "./sentry.js";

// Plan-id'er kommer fra Infisical (oprettes i Alunta). Læses ved modul-load;
// hvis de mangler (endnu ikke sat), fejler checkout pænt med 400.
export const PLAN_IDS = {
  monthly: process.env.ALUNTA_CZ_PRO_PLAN_ID_MONTHLY,
  semiannual: process.env.ALUNTA_CZ_PRO_PLAN_ID_SEMIANNUAL,
};

export function createCheckoutHandler({
  client = createAluntaClient(),
  planIds = PLAN_IDS,
  appBaseUrl = process.env.FRONTEND_URL ?? "https://cyclingzone.org",
} = {}) {
  return async function checkout(req, res) {
    if (!req.team) return res.status(400).json({ error: "No team found" });
    const interval = req.body?.interval;
    const planId = planIds[interval];
    if (!planId) return res.status(400).json({ error: "Unknown plan interval", errorCode: "unknown_interval" });

    try {
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
