import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useLanguage } from "../lib/language";
import { useDocumentHead } from "../hooks/useDocumentHead.js";
import { mapSupabaseAuthError, isEmailNotConfirmedError } from "../lib/authErrors";
import { suggestEmailFix } from "../lib/emailDomainSuggestion.js";
import { cooldownSecondsLeft, cooldownUntil, parseRateLimitSeconds } from "../lib/resendCooldown.js";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { Wordmark } from "../components/Brand";
import DiscordJoinLink from "../components/DiscordJoinLink";
import { Card, Button, Input, CheckIcon, InboxIcon } from "../components/ui";
import { labelClass, helperClass } from "../components/ui/fieldStyles.js";
import { getAttribution } from "../lib/attribution";
import { markPendingSignup } from "../lib/logEvent";
import { safeNextPath } from "../lib/safeNextPath.js";

const API = import.meta.env.VITE_API_URL;

const PUBLIC_APP_URL =
  import.meta.env.VITE_PUBLIC_APP_URL || "https://cyclingzone.org";

function getPasswordResetRedirectUrl() {
  return new URL("/reset-password", PUBLIC_APP_URL).toString();
}

/**
 * "Send bekræftelsesmail igen" med nedtælling. Refs #2826.
 *
 * Resend kan trigges tre steder (udløbet-link-banner, signup-succes-skærmen og
 * "email not confirmed"-login-fejlen), men rate-limitten er den SAMME på
 * serveren. Før #2826 havde hvert sted sin egen kopi af knappen uden cooldown,
 * så et klik nummer to inden for et minut gav en rå rate-limit-fejl i stedet
 * for hjælp — og knappen forsvandt helt efter første succesfulde send, så en
 * spiller der stadig ikke havde fået mailen stod uden vej videre.
 *
 * Her er alle tre steder samlet: nedtælling mens man venter, og knappen kommer
 * TILBAGE når cooldownen er ovre.
 */
function ResendConfirmation({ t, state, error, cooldownLeft, onResend, disabled = false, prompt = null, cta }) {
  const waiting = cooldownLeft > 0;

  return (
    <>
      {state === "sent" && <span className="block text-cz-success">{t("auth:success.resendSent")}</span>}
      {error && <span className="block text-cz-danger">{error}</span>}
      {waiting ? (
        <span className="block">{t("auth:success.resendCooldown", { seconds: cooldownLeft })}</span>
      ) : (
        <>
          {prompt ? `${prompt} ` : null}
          <button
            type="button"
            disabled={disabled || state === "sending"}
            onClick={onResend}
            className="underline hover:text-cz-1 disabled:opacity-60"
          >
            {state === "sending" ? t("auth:success.resendSending") : cta}
          </button>
        </>
      )}
    </>
  );
}

export default function LoginPage() {
  const { t } = useTranslation(["auth", "errors"]);
  const { language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  // #2078: App fanger en udløbet/ugyldig confirm-link (#error=...&error_code=otp_expired)
  // og sender hertil med fejlkoden i router-state. Vis en klar besked øverst, så
  // brugeren ved hvorfor linket ikke virkede og kan få en frisk mail (log ind med
  // en ubekræftet konto → resend-knappen dukker op, jf. #2068).
  // Engangs-flash: fang fejlkoden i state ÉN gang ved mount. react-router gemmer
  // location.state i window.history.state, så uden clearing ville banneret
  // genopstå ved hvert reload af /login i samme session. Vi rydder derfor
  // router-state (nedenfor), mens den lokale kopi holder beskeden synlig.
  const [authLinkError] = useState(() => location.state?.authLinkError || null);
  // #672: landing kan deep-linke til signup-mode via ?mode=signup (Opret bruger-CTA).
  const [searchParams] = useSearchParams();
  // #2042: cold deep-link-trafik ankommer med ?next= → default til signup-mode
  // (de har sjældent en konto endnu), så CTA'en matcher intentionen.
  const nextPath = safeNextPath(searchParams.get("next"));
  const [mode, setMode] = useState(() => {
    const requested = searchParams.get("mode");
    if (requested === "signup" || requested === "forgot" || requested === "login") return requested;
    return nextPath ? "signup" : "login";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teamName, setTeamName] = useState("");
  const [managerName, setManagerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);
  // #2068: "send bekræftelsesmail igen" — dækker både signup-succes-skærmen
  // (kind: "confirm") og login-forsøg der rammer Supabases "email not
  // confirmed"-fejl (bruger er stadig ubekræftet men prøver at logge ind).
  const [resendState, setResendState] = useState("idle"); // idle | sending | sent
  const [showResend, setShowResend] = useState(false);
  // Eget fejl-state (ikke den delte `error`) — resend kan trigges fra
  // success-skærmen, som ikke renderer #auth-error-blokken (den ligger kun i
  // login-formularen).
  const [resendError, setResendError] = useState("");
  // #2826: cooldown på resend. Supabase afviser to resends inden for ~60s, så
  // uden nedtælling blev det andet klik til en fejlbesked i stedet for hjælp.
  // `until` er epoch-ms (sandheden), `cooldownLeft` er det tikkende display.
  const [resendCooldownUntil, setResendCooldownUntil] = useState(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  // #2826: sæt fokus i email-feltet når spilleren vender tilbage for at rette
  // en forkert adresse, så rettelsen kan laves uden at lede efter feltet.
  const [focusEmailOnReturn, setFocusEmailOnReturn] = useState(false);

  // Per-route head for den public /login-rute (#1404/#1301).
  useDocumentHead({
    title: t("auth:meta.title"),
    description: t("auth:meta.description"),
    canonical: "https://cyclingzone.org/login",
    lang: language === "da" ? "da" : "en",
  });

  // #2078: ryd fejl-koden ud af router-state efter mount, så den ikke lever
  // videre i window.history.state og gen-viser banneret ved reload. authLinkError
  // (useState ovenfor) holder beskeden synlig i denne mount. No-op når state
  // allerede er tom (fx normalt /login-besøg).
  useEffect(() => {
    if (location.state?.authLinkError) {
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
  }, [location, navigate]);

  // #2826: tik nedtællingen ned mens en cooldown er aktiv. Intervallet rydder
  // sig selv når der ikke er mere tilbage, så vi ikke holder en timer i live på
  // en side spilleren typisk forlader.
  useEffect(() => {
    if (!resendCooldownUntil) {
      setCooldownLeft(0);
      return undefined;
    }
    setCooldownLeft(cooldownSecondsLeft(resendCooldownUntil, Date.now()));
    const id = setInterval(() => {
      const left = cooldownSecondsLeft(resendCooldownUntil, Date.now());
      setCooldownLeft(left);
      if (left <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [resendCooldownUntil]);

  const isLoginMode = mode === "login";
  const isSignupMode = mode === "signup";
  const isForgotMode = mode === "forgot";

  // #2826: en af de ubekræftede konti i prod var oprettet på "gmal.com" — den
  // mail kunne aldrig ankomme. Vi foreslår en rettelse mens de stadig kan nå at
  // fange den, men blokerer aldrig indsendelsen: adressen kan være ægte.
  const emailSuggestion = useMemo(
    () => (isSignupMode ? suggestEmailFix(email) : null),
    [isSignupMode, email],
  );

  // #2826: fokus tilbage i email-feltet efter "ret din email". Input er en delt
  // primitiv uden ref-forwarding, så vi bruger den id vi selv ejer på siden
  // frem for at ændre en komponent hele appen deler.
  useEffect(() => {
    if (!focusEmailOnReturn || success) return;
    document.getElementById("auth-email")?.focus();
    setFocusEmailOnReturn(false);
  }, [focusEmailOnReturn, success]);

  function resetMessages() {
    setError("");
    setSuccess(null);
    setShowResend(false);
    setResendState("idle");
    setResendError("");
  }

  // #2068: "send bekræftelsesmail igen". Bruges både fra signup-succes-skærmen
  // og fra login-fejlen "email not confirmed" — begge kender allerede emailen.
  async function handleResendConfirmation(targetEmail) {
    if (!targetEmail || resendState === "sending") return;
    // #2826: respektér cooldownen frem for at sende et kald vi ved bliver afvist.
    if (cooldownSecondsLeft(resendCooldownUntil, Date.now()) > 0) return;
    setResendState("sending");
    setResendError("");
    const { error: err } = await supabase.auth.resend({
      type: "signup",
      email: targetEmail,
    });
    if (err) {
      setResendState("idle");
      setResendError(mapSupabaseAuthError(err, t));
      // #2826: ramte vi alligevel rate-limitten (fx mailen blev sendt fra en
      // anden fane), så brug serverens EGET sekundtal til nedtællingen i stedet
      // for vores default, så den viste ventetid er sand.
      const retryAfter = parseRateLimitSeconds(err);
      if (retryAfter) setResendCooldownUntil(cooldownUntil(Date.now(), retryAfter));
    } else {
      setResendState("sent");
      setResendCooldownUntil(cooldownUntil(Date.now()));
    }
  }

  // #2826: vejen tilbage i flowet uden at starte forfra. Holdnavn, managernavn
  // og adgangskode bliver stående i state, så en spiller der har tastet
  // emailen forkert kun skal rette adressen og sende igen. Uden den her sad de
  // fast på en succes-skærm for en mail der aldrig kunne ankomme.
  function handleFixEmail() {
    setSuccess(null);
    setMode("signup");
    setError("");
    setResendState("idle");
    setResendError("");
    setFocusEmailOnReturn(true);
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    resetMessages();

    if (nextMode !== "signup") {
      setTeamName("");
      setManagerName("");
    }
  }

  async function getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    };
  }

  // #446: signup-bootstrap fejlede stille på langsomt netværk fordi fixed 1s
  // setTimeout ikke var nok til at Supabase-session blev tilgængelig.
  // Vi venter nu op til 5s med 250ms polling og logger udfaldet.
  async function waitForAuthHeaders(maxMs = 5000) {
    const intervalMs = 250;
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const headers = await getAuthHeaders();
      if (headers) return headers;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    resetMessages();
    setLoading(true);

    try {
      if (isLoginMode) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        // #1570: map Supabase-fejlen i stedet for en hårdkodet "forkert kodeord".
        // Vigtigst: "Email not confirmed" får sin egen besked, så en ny spiller
        // der prøver at logge ind før de har klikket bekræftelseslinket forstår
        // hvorfor — frem for fejlagtigt at tro deres adgangskode er forkert.
        if (error) {
          setError(mapSupabaseAuthError(error, t));
          // #2068: samme fejl er også hvor "send igen"-knappen skal dukke op —
          // brugeren står med en ubekræftet konto og ellers ingen vej videre.
          // #2172: detektér via code ELLER message (isEmailNotConfirmedError), så
          // resend-knappen ikke tavst forsvinder hvis Supabase ændrer ordlyden.
          setShowResend(isEmailNotConfirmedError(error));
          setResendState("idle");
        }
        return;
      }

      if (isForgotMode) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: getPasswordResetRedirectUrl(),
        });

        if (error) {
          setError(mapSupabaseAuthError(error, t));
          return;
        }

        setSuccess({
          kind: "forgot",
          message: t("auth:success.forgotTitle"),
        });
        setPassword("");
        return;
      }

      if (!teamName.trim() || teamName.trim().length < 3) {
        setError(t("auth:error.teamNameTooShort"));
        return;
      }

      if (!managerName.trim() || managerName.trim().length < 2) {
        setError(t("auth:error.managerNameTooShort"));
        return;
      }

      const { data: existing } = await supabase
        .from("teams")
        .select("id")
        .ilike("name", teamName.trim())
        .single();

      if (existing) {
        setError(t("auth:error.teamNameTaken"));
        return;
      }

      // #2078: bevidst INGEN emailRedirectTo her. En custom redirect-URL skal stå
      // i Supabases "Redirect URLs"-allowlist (dashboard) for at blive respekteret,
      // ellers afvises den — og det er en dashboard-config-ændring uden for denne
      // opgaves scope. Confirm-links går derfor fortsat til Site URL ("/"), og
      // App fanger nu et evt. udløbet-link-fejl-hash der (parseAuthErrorHash).
      // #2079: attribution-snapshottet lever kun i localStorage på DENNE enhed/
      // browser — bekræfter brugeren mailen på en anden (mobil-mailapp, andet
      // device), er snapshottet væk når bootstrappen kører. Gem det derfor også
      // i auth-metadata ved signUp, så confirm-stien kan falde tilbage til det.
      const attribution = getAttribution();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          // #2068: manager_name gemmes nu også i metadata (var kun team_name) —
          // Layout auto-opretter holdet fra denne metadata efter email-bekræftelse,
          // så en confirm-on-bruger ikke skal genindtaste navnene i SetupWizard.
          data: {
            team_name: teamName.trim(),
            manager_name: managerName.trim(),
            language,
            ...(attribution ? { attribution } : {}),
          },
        },
      });

      if (signUpError) {
        setError(mapSupabaseAuthError(signUpError, t));
        return;
      }

      if (!data?.user) return;

      // #1583: markér en ventende signup til aktiverings-funnellen. Selve
      // player_events-eventet flushes når brugeren er authenticated (confirm-off:
      // straks efter bootstrap nedenfor; confirm-on: ved første dashboard-load
      // efter email-bekræftelse — se DashboardPage). Markøren sættes kun ved en
      // ægte signUp(), så eksisterende brugere aldrig tæller med i funnellen.
      markPendingSignup();

      // #1570: Email-bekræftelse slået TIL → Supabase returnerer user men ingen
      // session. Vis ÉN entydig "bekræft din email"-besked med adressen, i stedet
      // for at vente 5s og vise en modstridende "dit hold er klar / log ind"-kombi.
      if (!data.session) {
        setSuccess({ kind: "confirm", email: email.trim() });
        return;
      }

      // Session med det samme (bekræftelse slået fra) → bootstrap holdet og send
      // spilleren direkte ind i spillet; de ER logget ind, så ingen login-omvej.
      const headers = await waitForAuthHeaders(5000);
      if (!headers) {
        console.warn("[signup] session ikke ready efter 5s — viser signupPartial");
        setSuccess({
          kind: "signup",
          message: t("auth:success.signupPartial"),
        });
        return;
      }

      const bootstrapRes = await fetch(`${API}/api/teams/my`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          name: teamName.trim(),
          manager_name: managerName.trim(),
          attribution: getAttribution(),
        }),
      });
      let bootstrapData = {};
      try {
        bootstrapData = await bootstrapRes.json();
      } catch {
        // Backend kan returnere tomt body på 502/503; behold tomt object.
      }

      if (!bootstrapRes.ok) {
        console.error("[signup] bootstrap fejlede", bootstrapRes.status, bootstrapData);
        setError(t("auth:error.bootstrapFailed", { detail: bootstrapData.error || `HTTP ${bootstrapRes.status}` }));
        return;
      }

      // #1570: holdet er oprettet og spilleren har en aktiv session → direkte ind
      // i spillet. SetupWizard/onboarding på dashboardet guider videre — ingen
      // selvmodsigende "dit hold er klar, men log ind igen"-success-skærm.
      navigate(nextPath || "/dashboard");
    } catch (err) {
      // #1348 — login/signup/forgot brugte try/finally uden catch: et rejected
      // Supabase-kald (offline/dropped connection) clearede loading men
      // efterlod formularen UDEN fejlbesked. Vi mapper nu fejlen til en
      // handlingsanvisende besked (netværk → connection-error-copy, ellers
      // den kendte Supabase-mapping) i stedet for at sluge den.
      console.error("[auth] submit fejlede", err);
      setError(mapSupabaseAuthError(err, t));
    } finally {
      setLoading(false);
    }
  }

  const subtitle = isLoginMode
    ? t("auth:page.subtitle.login")
    : isSignupMode
      ? t("auth:page.subtitle.signup")
      : t("auth:page.subtitle.forgot");

  const submitLabel = loading
    ? isSignupMode
      ? t("auth:submit.signup.loading")
      : isForgotMode
        ? t("auth:submit.forgot.loading")
        : t("auth:submit.login.loading")
    : isSignupMode
      ? t("auth:submit.signup.idle")
      : isForgotMode
        ? t("auth:submit.forgot.idle")
        : t("auth:submit.login.idle");

  return (
    // #2253: translate="no" — browser-oversættere (Google Translate) muterede
    // React's tekst-noder på denne flade og udløste NotFoundError-crashes i prod
    // (Sentry CYCLINGZONE-1D m.fl., url=/login). Målrettet i stedet for globalt
    // så statisk indhold stadig kan browser-oversættes (ejer-beslutning PR #2272).
    <div translate="no" className="relative flex min-h-screen items-center justify-center bg-cz-body p-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          {/* #671/#481: wordmark = the primary brand mark (BRAND_BRIEF: website
              header / marketing). The theme-aware logotype carries the brand name,
              so it doubles as the page heading — no redundant text title. */}
          <h1>
            <Wordmark className="mx-auto h-9 w-auto" />
          </h1>
          <p className="mt-4 text-sm text-cz-2">{subtitle}</p>
          {nextPath && (
            <div className="mt-5 rounded-cz border border-cz-border bg-cz-subtle px-4 py-3 text-left">
              <p className="text-sm font-semibold text-cz-1">{t("auth:context.title")}</p>
              <p className="mt-1 text-xs text-cz-2">{t("auth:context.body")}</p>
            </div>
          )}
        </div>

        <Card className="p-6">
          {authLinkError && !success && (
            <div
              role="status"
              className="mb-4 rounded-cz border border-cz-border bg-cz-subtle px-4 py-3 text-left"
            >
              <p className="text-sm font-semibold text-cz-1">{t("auth:linkError.title")}</p>
              <p className="mt-1 text-xs text-cz-2">{t("auth:linkError.body")}</p>
              {/* #2172: giv brugeren en direkte vej ud af loopet — et frisk link
                  uden at skulle gætte password og fejl-logge-ind først. Vi kender
                  ikke emailen fra fejl-hash'et, så knappen bruger email-feltet
                  nedenfor (deaktiveret til det er udfyldt). */}
              <div className="mt-2 text-xs text-cz-2">
                <ResendConfirmation
                  t={t}
                  state={resendState}
                  error={resendError}
                  cooldownLeft={cooldownLeft}
                  disabled={!email.trim()}
                  onResend={() => handleResendConfirmation(email.trim())}
                  cta={t("auth:linkError.resendCta")}
                />
              </div>
            </div>
          )}
          {success ? (
            <div className="py-4 text-center" role="status">
              <div className="mb-4 flex justify-center">
                {success.kind === "signup" ? (
                  <CheckIcon size={32} className="text-cz-success" />
                ) : (
                  <InboxIcon size={32} className="text-cz-accent" />
                )}
              </div>
              <p className="text-sm font-medium text-cz-success">
                {success.kind === "confirm" ? t("auth:success.confirmTitle") : success.message}
              </p>
              {success.kind !== "confirm" && (
                <p className="mt-3 text-xs text-cz-3">
                  {success.kind === "signup"
                    ? t("auth:success.signupBody")
                    : t("auth:success.forgotBody")}
                </p>
              )}
              {/* #2826: bekræftelses-skærmen er der hele frafaldet sker. Målingen
                  viste at INGEN af 148 bekræftelser skete efter mere end en time
                  — kommer spilleren ikke videre her, kommer de aldrig ind. Derfor
                  står adressen tydeligt (så en tastefejl kan opdages), spam-hintet
                  står med det samme (ikke først efter et resend), og der er en vej
                  tilbage til formularen uden at miste det udfyldte. */}
              {success.kind === "confirm" && (
                <>
                  <p className="mt-3 text-xs text-cz-3">{t("auth:success.confirmSentTo")}</p>
                  <p className="mt-1 break-all rounded-cz border border-cz-border bg-cz-subtle px-3 py-2 text-sm font-semibold text-cz-1">
                    {success.email}
                  </p>
                  <p className="mt-3 text-xs text-cz-3">{t("auth:success.confirmNext")}</p>
                  <p className="mt-2 text-xs text-cz-3">{t("auth:success.confirmSpam")}</p>
                  <div className="mt-3 text-xs text-cz-3">
                    <ResendConfirmation
                      t={t}
                      state={resendState}
                      error={resendError}
                      cooldownLeft={cooldownLeft}
                      onResend={() => handleResendConfirmation(success.email)}
                      prompt={t("auth:success.resendPrompt")}
                      cta={t("auth:success.resendCta")}
                    />
                  </div>
                  <div className="mt-4 border-t border-cz-border pt-4 text-xs text-cz-3">
                    {t("auth:success.wrongEmailPrompt")}{" "}
                    <button
                      type="button"
                      onClick={handleFixEmail}
                      className="underline hover:text-cz-1"
                    >
                      {t("auth:success.wrongEmailCta")}
                    </button>
                    <p className="mt-1">{t("auth:success.confirmKeepOpen")}</p>
                  </div>
                </>
              )}
              <Button
                type="button"
                variant="primary"
                fullWidth
                className="mt-4"
                onClick={() => {
                  setMode("login");
                  setSuccess(null);
                  setTeamName("");
                  setManagerName("");
                  setPassword("");
                }}
              >
                {t("auth:success.signupCta")}
              </Button>
              {(success.kind === "signup" || success.kind === "confirm") && (
                <div className="mt-4 border-t border-cz-border pt-4">
                  <p className="mb-2 text-xs text-cz-3">{t("auth:success.joinDiscord")}</p>
                  <DiscordJoinLink variant="button" label={t("auth:success.joinDiscordCta")} />
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {isSignupMode && (
                <>
                  <div>
                    <label htmlFor="auth-team-name" className={labelClass()}>
                      {t("auth:field.teamName.label")}
                    </label>
                    <Input
                      id="auth-team-name"
                      type="text"
                      value={teamName}
                      onChange={e => setTeamName(e.target.value)}
                      placeholder={t("auth:field.teamName.placeholder")}
                      required
                      minLength={3}
                      maxLength={30}
                      aria-describedby="auth-team-name-help"
                    />
                    <p id="auth-team-name-help" className={helperClass()}>{t("auth:field.teamName.help")}</p>
                  </div>
                  <div>
                    <label htmlFor="auth-manager-name" className={labelClass()}>
                      {t("auth:field.managerName.label")}
                    </label>
                    <Input
                      id="auth-manager-name"
                      type="text"
                      value={managerName}
                      onChange={e => setManagerName(e.target.value)}
                      placeholder={t("auth:field.managerName.placeholder")}
                      required
                      minLength={2}
                      maxLength={50}
                      aria-describedby="auth-manager-name-help"
                    />
                    <p id="auth-manager-name-help" className={helperClass()}>{t("auth:field.managerName.help")}</p>
                  </div>
                </>
              )}

              <div>
                <label htmlFor="auth-email" className={labelClass()}>
                  {t("auth:field.email.label")}
                </label>
                <Input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t("auth:field.email.placeholder")}
                  required
                  error={Boolean(error)}
                  aria-describedby={
                    [
                      isForgotMode ? "auth-email-help" : null,
                      isSignupMode ? "auth-email-signup-help" : null,
                      emailSuggestion ? "auth-email-suggestion" : null,
                      error ? "auth-error" : null,
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                />
                {isForgotMode && (
                  <p id="auth-email-help" className={helperClass()}>
                    {t("auth:field.email.forgotHelp")}
                  </p>
                )}
                {isSignupMode && (
                  <p id="auth-email-signup-help" className={helperClass()}>
                    {t("auth:field.email.signupHelp")}
                  </p>
                )}
                {/* #2826: en konto i prod blev oprettet på "gmal.com" og kunne
                    aldrig bekræftes. Hintet er et forslag, ikke en validering:
                    det blokerer ikke indsendelse, for adressen kan være ægte. */}
                {emailSuggestion && (
                  <p id="auth-email-suggestion" className="mt-1.5 text-xs text-cz-2">
                    <button
                      type="button"
                      onClick={() => setEmail(emailSuggestion.suggestion)}
                      className="underline hover:text-cz-1"
                    >
                      {t("auth:field.email.didYouMeanCta", { suggestion: emailSuggestion.suggestion })}
                    </button>
                  </p>
                )}
              </div>

              {!isForgotMode && (
                <div>
                  <label htmlFor="auth-password" className={labelClass()}>
                    {t("auth:field.password.label")}
                  </label>
                  <Input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    error={Boolean(error)}
                    aria-describedby={
                      [isSignupMode ? "auth-password-help" : null, error ? "auth-error" : null]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  />
                  {isSignupMode && (
                    <p id="auth-password-help" className={helperClass()}>{t("auth:field.password.help")}</p>
                  )}
                </div>
              )}

              {error && (
                <div
                  id="auth-error"
                  role="alert"
                  className="rounded-cz border border-cz-danger/30 bg-cz-danger-bg px-4 py-2.5 text-sm text-cz-danger"
                >
                  {error}
                  {showResend && (
                    <div className="mt-1.5">
                      <ResendConfirmation
                        t={t}
                        state={resendState}
                        error={resendError}
                        cooldownLeft={cooldownLeft}
                        onResend={() => handleResendConfirmation(email.trim())}
                        cta={t("auth:success.resendCta")}
                      />
                    </div>
                  )}
                </div>
              )}

              <Button type="submit" variant="primary" fullWidth loading={loading}>
                {submitLabel}
              </Button>
            </form>
          )}

          {!success && (
            <div className="mt-4 flex flex-col gap-2 text-center">
              {isLoginMode && (
                <>
                  <Button type="button" variant="ghost" size="sm" onClick={() => switchMode("forgot")}>
                    {t("auth:switch.forgot")}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => switchMode("signup")}>
                    {t("auth:switch.signup")}
                  </Button>
                </>
              )}

              {isSignupMode && (
                <Button type="button" variant="ghost" size="sm" onClick={() => switchMode("login")}>
                  {t("auth:switch.login")}
                </Button>
              )}

              {isForgotMode && (
                <Button type="button" variant="ghost" size="sm" onClick={() => switchMode("login")}>
                  {t("auth:switch.backToLogin")}
                </Button>
              )}
            </div>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-cz-3">
          {t("auth:page.tagline")}
        </p>
        <p className="mt-2 text-center text-xs text-cz-3">
          <Link to={language === "en" ? "/privacy-policy" : "/privatlivspolitik"} className="underline hover:text-cz-1">
            {t("auth:footer.privacyPolicy")}
          </Link>
          <span className="mx-2" aria-hidden="true">·</span>
          <Link to={language === "en" ? "/terms" : "/handelsbetingelser"} className="underline hover:text-cz-1">
            {t("auth:footer.terms")}
          </Link>
        </p>
      </div>
    </div>
  );
}
