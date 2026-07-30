import { createAluntaClient } from "./alunta.js";
import { captureException } from "./sentry.js";

// #2813: self-service opsigelse. Slår teamets subscription op, beder Alunta om
// et signeret auto-login-link til deres kundeportal (hvor opsigelse sker) og
// returnerer URL'en. Linket udløber efter 15 min og behandles som credential —
// det logges aldrig og gemmes ikke.
export function createPortalHandler({
  client = createAluntaClient(),
  supabase,
} = {}) {
  return async function portal(req, res) {
    if (!req.team) return res.status(400).json({ error: "No team found" });

    try {
      const { data: sub, error } = await supabase
        .from("subscriptions")
        .select("alunta_customer_id")
        .eq("team_id", req.team.id)
        .maybeSingle();
      if (error) throw new Error(`subscription-opslag fejlede: ${error.message}`);

      // Intet abonnement → ingenting at administrere. 404 (ikke 500): frontend
      // viser en rolig "intet abonnement"-besked.
      if (!sub) return res.status(404).json({ error: "No subscription", errorCode: "no_subscription" });

      // alunta_customer_id kan mangle på gamle/ufuldstændige rækker (fx accept-log
      // uden gennemført køb) — så falder vi tilbage til portalens login-side,
      // hvor kunden kan logge ind med magic link på sin e-mail.
      const portalUrl = await client.createPortalLink({ customerUuid: sub.alunta_customer_id || undefined });
      return res.status(200).json({ portal_url: portalUrl });
    } catch (err) {
      captureException(err, { tags: { flow: "billing", stage: "portal" }, teamId: req.team.id });
      return res.status(502).json({ error: "Portal link failed", detail: String(err.message || err) });
    }
  };
}

export default createPortalHandler;
