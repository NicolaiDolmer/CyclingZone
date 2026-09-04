// [epic #4592 del 3] "Tilmeld dig næste sæson"-knap (#452) — dashboard-kort.
//
// Vises KUN når backend siger enabled (app_config season_signup_enabled,
// default off — seasonSignupFlag.js) OG eligible (parkeret ELLER inaktiv-
// kandidat, SAMME definition som parkerings-sweepen bruger til selve
// udvælgelsen, managerParking.selectTeamsToPark — 30 dage uden login).
//
// PRESENTATIONAL ONLY (props-in, no fetch) — samme princip som
// SeasonWrapNudgeCard/TeamSelectionCtaCard: DashboardPage.jsx henter
// GET /api/season/signup-status og POST'er /api/season/signup, best-effort
// (forsvinder stille ved fejl, docs/DASHBOARD_RULES.md §3).
//
// Placering: blandt de betingede engangskort (DASHBOARD_RULES.md §4/§5),
// mellem SeasonWrapNudgeCard og SeasonStartGuideCard — ny placering, ikke en
// af de historisk ejer-låste rækker i §2. Bygges som Card, ikke banner (§3:
// "maks én nudge-banner ad gangen" gælder kun banner-formen).
//
// `signedUp` erstatter knappen med en bekræftelse i stedet for at skjule
// kortet — P11 (TASTE.md): siden skal altid vise den sande nuværende
// tilstand, aldrig et transient "tak"-flueben der kan komme ud af sync med
// serveren ved næste load.
import { useTranslation } from "react-i18next";
import { Card, Button, CheckIcon, RefreshIcon } from "./ui";

export default function SeasonSignupCard({
  nextSeasonNumber,
  parked = false,
  signedUp = false,
  submitting = false,
  primary = true,
  onSignUp,
}) {
  const { t } = useTranslation("dashboard");

  return (
    <Card className="mb-4 p-5 flex flex-col sm:flex-row sm:items-center gap-4" data-testid="season-signup-card">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <span className="flex-shrink-0 mt-0.5 text-cz-accent-t" aria-hidden="true">
          {signedUp ? <CheckIcon size={20} /> : <RefreshIcon size={20} />}
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-cz-1 text-sm">
            {t(parked ? "seasonSignup.titleParked" : "seasonSignup.titleDormant", { number: nextSeasonNumber })}
          </h2>
          <p className="text-cz-3 text-xs mt-0.5">
            {signedUp
              ? t("seasonSignup.confirmed", { number: nextSeasonNumber })
              : t(parked ? "seasonSignup.bodyParked" : "seasonSignup.bodyDormant", { number: nextSeasonNumber })}
          </p>
        </div>
      </div>
      {!signedUp && (
        <Button
          variant={primary ? "primary" : "secondary"}
          size="sm"
          onClick={onSignUp}
          loading={submitting}
          className="flex-shrink-0 self-start sm:self-auto"
        >
          {t("seasonSignup.cta")}
        </Button>
      )}
    </Card>
  );
}
