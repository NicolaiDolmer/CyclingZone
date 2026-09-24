// [epic #4592 del 3] "Tilmeld dig næste sæson"-knap (#452) — dashboard-kort.
//
// Vises KUN når backend siger enabled (app_config season_signup_enabled,
// default off — seasonSignupFlag.js) OG eligible (parkeret ELLER inaktiv-
// kandidat, SAMME definition som parkerings-sweepen bruger til selve
// udvælgelsen, managerParking.selectTeamsToPark — 30 dage uden login).
//
// For et SOVENDE hold er kortet presentational (props-in, no fetch) — samme
// princip som SeasonWrapNudgeCard/TeamSelectionCtaCard: DashboardPage.jsx henter
// GET /api/season/signup-status og POST'er /api/season/signup, best-effort
// (forsvinder stille ved fejl, docs/DASHBOARD_RULES.md §3).
//
// #5643 (spor A4): for et PARKERET hold henter knappen holdet tilbage i ligaen
// med det samme (POST /api/season/comeback), placeret efter Global Rank, og
// kortet viser den nye division. Kaldet bor her i kortet og ikke i
// DashboardPage.jsx, fordi dashboard-siden er i gang i andre spor; tilstanden er
// lokal for kortet og overlever ikke et reload — det behøver den ikke: efter et
// comeback er holdet ikke længere parkeret, og kortet vises ikke igen.
//
// Placering (ejer-go 23/9, #452): øverst i indholdsflowet, lige under trup-/
// kontrakt-advarslerne og over dagens etaper — samme konto-risiko-klasse som
// dem (DASHBOARD_RULES.md §2). Før lå kortet blandt de betingede engangskort
// og endte under folden på telefonen. Bygges som Card, ikke banner (§3:
// "maks én nudge-banner ad gangen" gælder kun banner-formen).
//
// `signedUp` erstatter knappen med en bekræftelse i stedet for at skjule
// kortet — P11 (TASTE.md): siden skal altid vise den sande nuværende
// tilstand, aldrig et transient "tak"-flueben der kan komme ud af sync med
// serveren ved næste load. Comeback-bekræftelsen vises først, når serveren
// har svaret med den nye division.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, Button, CheckIcon, RefreshIcon } from "./ui";
import { supabase } from "../lib/supabase";
import { apiFetch } from "../lib/apiFetch.ts";

// POST /api/season/comeback. Returnerer den nye division, eller null ved fejl.
export async function requestSeasonComeback() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return null;
  const res = await apiFetch("/api/season/comeback", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }, { source: "season-comeback" });
  const division = Number(res.data?.division);
  if (!res.ok || !Number.isFinite(division)) return null;
  return { division };
}

export default function SeasonSignupCard({
  nextSeasonNumber,
  parked = false,
  signedUp = false,
  submitting = false,
  primary = true,
  onSignUp,
  requestComeback = requestSeasonComeback,
}) {
  const { t } = useTranslation("dashboard");
  const [comeback, setComeback] = useState(null);
  const [comebackSubmitting, setComebackSubmitting] = useState(false);
  const [comebackFailed, setComebackFailed] = useState(false);

  async function handleComeback() {
    setComebackSubmitting(true);
    setComebackFailed(false);
    try {
      const result = await requestComeback();
      if (result) setComeback(result);
      else setComebackFailed(true);
    } catch {
      setComebackFailed(true);
    } finally {
      setComebackSubmitting(false);
    }
  }

  const done = parked ? comeback != null : signedUp;
  let title;
  let body;
  if (parked) {
    title = done ? t("seasonSignup.comebackTitle") : t("seasonSignup.titleParked");
    body = done
      ? t("seasonSignup.comebackConfirmed", { division: comeback.division })
      : t("seasonSignup.bodyParkedComeback");
  } else {
    title = t("seasonSignup.titleDormant", { number: nextSeasonNumber });
    body = signedUp
      ? t("seasonSignup.confirmed", { number: nextSeasonNumber })
      : t("seasonSignup.bodyDormant", { number: nextSeasonNumber });
  }

  return (
    <Card className="mb-4 p-5 flex flex-col sm:flex-row sm:items-center gap-4" data-testid="season-signup-card">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <span className="flex-shrink-0 mt-0.5 text-cz-accent-t" aria-hidden="true">
          {done ? <CheckIcon size={20} /> : <RefreshIcon size={20} />}
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-cz-1 text-sm">{title}</h2>
          <p className="text-cz-3 text-xs mt-0.5" aria-live="polite">{body}</p>
          {parked && comebackFailed && !done && (
            <p className="text-cz-danger text-xs mt-1" role="alert">{t("seasonSignup.comebackError")}</p>
          )}
        </div>
      </div>
      {!done && (
        <Button
          variant={primary ? "primary" : "secondary"}
          size="sm"
          onClick={parked ? handleComeback : onSignUp}
          loading={parked ? comebackSubmitting : submitting}
          className="flex-shrink-0 self-start sm:self-auto"
        >
          {t(parked ? "seasonSignup.ctaComeback" : "seasonSignup.cta")}
        </Button>
      )}
    </Card>
  );
}
