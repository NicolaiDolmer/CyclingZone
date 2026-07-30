import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useSubscription } from "../lib/useSubscription";
import { useDocumentHead } from "../hooks/useDocumentHead.js";
import {
  PageHeader,
  PageLoader,
  ErrorState,
  Section,
  SectionStack,
  SectionHeader,
  Button,
  CrownIcon,
  CheckIcon,
} from "../components/ui";

const API = import.meta.env.VITE_API_URL;

// #2849 bølge 4 — kanonisk T1 (docs/design/PAGE_TEMPLATES.md). Købs-/checkout-
// logikken (startCheckout, Stripe-redirect, founder-seat-fetch) er UÆNDRET —
// kun sidehoved, container, states og pris-/feature-chrome er migreret.
const PLANS = [
  { key: "monthly", priceKey: "monthlyPrice", noteKey: null },
  { key: "semiannual", priceKey: "semiannualPrice", noteKey: "semiannualNote" },
];

// #2813: køb er pauset indtil handelsbetingelser + accept-flow er live.
// Backend afviser også (503 checkout_paused i billingCheckout.js) — dette flag
// styrer kun visningen og skal holdes i sync med CHECKOUT_PAUSED dér.
const CHECKOUT_PAUSED = true;

export default function ProUpgradePage() {
  const { t } = useTranslation("pro");
  const [teamId, setTeamId] = useState(null);
  // Full-page load-gate (#2849 bølge 4): siden havde INGEN loading-state før —
  // team-opslaget kunne fejle stille og efterlade en "ikke-Pro"-flig af siden
  // synlig et øjeblik før subscription-status var kendt (en købsside uden
  // loading-gate). teamLoading dækker selve team-opslaget herunder;
  // useSubscription leverer sin egen `loading` for subscription-opslaget —
  // begge kombineres til `initializing` nedenfor. Rører IKKE checkout-kaldet.
  const [teamLoading, setTeamLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [seats, setSeats] = useState(null);
  const [interval, setInterval_] = useState("semiannual"); // forudvalgt: samme plan der tidligere havde accent-fremhævning

  useDocumentHead({ title: t("metaTitle") });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { if (alive) setTeamLoading(false); return; }
        const { data: team, error } = await supabase
          .from("teams").select("id").eq("user_id", session.user.id).single();
        if (error) throw error;
        if (alive) { setTeamId(team?.id ?? null); setTeamLoading(false); }
      } catch (e) {
        console.error("ProUpgradePage: team load failed", e);
        if (alive) { setLoadError(true); setTeamLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, [retryToken]);

  // Live seat-counter (#1903) — offentligt, ikke-sensitivt endpoint. Fejler den
  // stille (progressive enhancement, ikke kritisk for checkout-flowet).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API}/api/billing/founder-seats`);
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setSeats(data);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, []);

  const { isPro, isFounder, loading: subLoading } = useSubscription(teamId);
  const initializing = teamLoading || subLoading;
  const seatsLeft = seats ? Math.max(seats.cap - seats.taken, 0) : null;

  async function startCheckout(selectedInterval) {
    setBusy(true);
    setErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API}/api/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ interval: selectedInterval }),
      });
      if (!res.ok) throw new Error("checkout failed");
      const { checkout_url } = await res.json();
      // Navigér ALDRIG til en tom/undefined URL — det bliver en relativ SPA-route
      // (/undefined -> dashboard-redirect) og ligner "der skete ingenting" (#1903).
      if (!checkout_url || !/^https:\/\//.test(checkout_url)) throw new Error("missing checkout_url");
      window.location.href = checkout_url; // redirect til Aluntas hostede betalingsside
    } catch {
      setErr(t("error"));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {initializing ? (
        <PageLoader label={t("metaTitle")} />
      ) : loadError ? (
        <ErrorState
          description={t("loadError.message")}
          action={
            <Button variant="secondary" size="sm" onClick={() => setRetryToken(n => n + 1)}>
              {t("loadError.retry")}
            </Button>
          }
        />
      ) : (
        <SectionStack>
          {seats && (
            <Section>
              <SectionHeader title={t("founderHeading")} />
              <div className="font-data text-2xl text-cz-1 tabular-nums">
                {seatsLeft > 0 ? t("founderSeatsTaken", { taken: seats.taken, cap: seats.cap }) : t("founderSeatsFull")}
              </div>
              {seatsLeft > 0 && (
                <p className="mt-0.5 text-2xs text-cz-3">{t("founderSeatsRemaining", { remaining: seatsLeft })}</p>
              )}
              <p className="mt-3 text-sm leading-relaxed text-cz-2">{t("founderExplainer")}</p>
            </Section>
          )}

          {isPro ? (
            <Section>
              <div className="flex items-center gap-2.5 text-cz-1">
                {isFounder ? (
                  <CrownIcon size={18} aria-hidden="true" className="flex-shrink-0 text-cz-accent-t" />
                ) : (
                  <CheckIcon size={18} aria-hidden="true" className="flex-shrink-0 text-cz-accent-t" />
                )}
                <p className="text-[13.5px] leading-relaxed">{isFounder ? t("alreadyFounder") : t("alreadyPro")}</p>
              </div>
            </Section>
          ) : (
            <Section>
              <SectionHeader title={t("choosePlan")} />

              {CHECKOUT_PAUSED ? (
                <p className="text-sm leading-relaxed text-cz-2">{t("checkoutPaused")}</p>
              ) : (
                <>
              {err && <p className="mb-4 text-sm text-cz-danger">{err}</p>}

              <div role="radiogroup" aria-label={t("choosePlan")} className="grid gap-3 sm:grid-cols-2">
                {PLANS.map(plan => {
                  const selected = interval === plan.key;
                  return (
                    <button
                      key={plan.key}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={busy}
                      onClick={() => setInterval_(plan.key)}
                      className={`rounded-cz border p-4 text-left transition-colors disabled:opacity-50 ${
                        selected ? "border-cz-accent bg-cz-accent/5" : "border-cz-border hover:bg-cz-subtle"
                      }`}
                    >
                      <div className="font-data text-xs uppercase tracking-wider text-cz-3">{t(plan.key)}</div>
                      <div className="font-data mt-1 text-2xl tabular-nums text-cz-1">{t(plan.priceKey)}</div>
                      {plan.noteKey && <div className="mt-0.5 text-2xs text-cz-3">{t(plan.noteKey)}</div>}
                    </button>
                  );
                })}
              </div>

              <Button
                variant="primary"
                size="md"
                fullWidth
                loading={busy}
                disabled={busy}
                onClick={() => startCheckout(interval)}
                className="mt-5"
              >
                {t("cta")}
              </Button>
                </>
              )}
            </Section>
          )}
        </SectionStack>
      )}

      <p className="mt-6 text-xs leading-relaxed text-cz-3">{t("fairnessNote")}</p>
    </div>
  );
}
