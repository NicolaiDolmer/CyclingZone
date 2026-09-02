import { createAluntaClient } from "./alunta.js";
import { captureException } from "./sentry.js";

// #2816: statusser hvor et hold allerede HAR et løbende abonnement — spejler
// entitlement.js's SUBSCRIPTION_ACTIVE_STATUSES minus 'cancelled' (en opsagt
// kunde må gerne genkøbe: 'cancelled' æres kun til periodeslut, det er ikke
// et løbende Alunta-abonnement der ville kollidere med et nyt).
const ALREADY_SUBSCRIBED_STATUSES = new Set(["active", "past_due"]);

// Plan-id'er kommer fra Infisical (oprettes i Alunta). Læses ved modul-load;
// hvis de mangler (endnu ikke sat), fejler checkout pænt med 400.
export const PLAN_IDS = {
  monthly: process.env.ALUNTA_CZ_PRO_PLAN_ID_MONTHLY,
  semiannual: process.env.ALUNTA_CZ_PRO_PLAN_ID_SEMIANNUAL,
};

// #2813: ejer-beslutning 2/9 ("åbn nu, ret bagefter") flipper checkout åben.
// Vilkårs-sider, accept-flow og opsigelsessti er bygget siden 30/7; resterende
// punkter (EU-moms #4511, udløb uden fornyelsessti #4512, EUR/DKK #4074) rettes
// som opfølgning, ikke som gate for selve flippet.
// Skal holdes i sync med CHECKOUT_PAUSED i ProUpgradePage.jsx.
export const CHECKOUT_PAUSED = false;

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

    // #2816: dobbeltkøb-guard. Uden dette kunne et hold købe et andet abonnement
    // oveni et løbende, hvilket overskriver alunta_subscription_id ved næste
    // webhook/reconcile-kørsel — den gamle betaling bliver umulig at spore, og
    // Aluntas kunde har nu to aktive abonnementer, kun ét kendt lokalt. Kun
    // 'active'/'past_due' MED et sat alunta_subscription_id tæller — en række
    // der kun bærer terms-accept (endnu ikke betalt, se BILLING_STACK.md §5
    // "en række er ikke en kunde") skal stadig kunne fuldføre checkout.
    if (supabase) {
      try {
        const { data: existingSub, error: subErr } = await supabase
          .from("subscriptions")
          .select("status, alunta_subscription_id")
          .eq("team_id", req.team.id)
          .maybeSingle();
        if (subErr) throw new Error(subErr.message);
        if (existingSub?.alunta_subscription_id && ALREADY_SUBSCRIBED_STATUSES.has(existingSub.status)) {
          return res.status(409).json({ error: "Team already has an active subscription", errorCode: "already_subscribed" });
        }
      } catch (guardErr) {
        // Fail-open: en fejlende dobbeltkøbs-tjek (transient DB-fejl, uventet
        // supabase-double i en test) skal ikke blokere et legitimt køb. Alarmeres
        // i stedet — samme afvejning som resten af billing-stakken (fail mod ikke
        // at genere kunden, alarmér ops).
        captureException(new Error(`already-subscribed-tjek fejlede: ${guardErr.message}`), {
          tags: { flow: "billing", stage: "checkout-guard" },
          teamId: req.team.id,
        });
      }
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

      // #4646: funnel-event — server-side write, samme skema som frontend/src/
      // lib/logEvent.js. Modparten (checkout_completed) skrives i aluntaWebhook.js
      // på selve betalingen. Fire-and-forget: instrumentering må ALDRIG vælte et
      // ellers vellykket køb — kunden har allerede en gyldig checkout_url.
      try {
        if (supabase && req.user?.id) {
          supabase
            .from("player_events")
            .insert({ team_id: req.team.id, user_id: req.user.id, event_name: "checkout_started", event_data: { interval, currency: null } })
            .then(({ error: evErr }) => {
              if (evErr) {
                captureException(new Error(`player_events checkout_started insert fejlede: ${evErr.message}`), {
                  tags: { flow: "billing", stage: "checkout-player-event" },
                  teamId: req.team.id,
                });
              }
            })
            .catch((err) => {
              // best-effort: kun en afvist promise (netværk/DB-drop) rammer her —
              // en almindelig supabase-js-fejl kommer tilbage som {error} ovenfor,
              // ikke som en rejection. Samme capture-mønster, ikke fatalt for købet.
              captureException(err, { tags: { flow: "billing", stage: "checkout-player-event" }, teamId: req.team.id });
            });
        }
      } catch {
        // best-effort — se kommentaren ovenfor.
      }

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
