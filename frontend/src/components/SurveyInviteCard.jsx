// Dashboard-indgang til det aktive spørgeskema (#4943).
//
// Vises kun når (1) et skema står som `open` (RLS gør at lukkede og kladder
// aldrig kommer med i svaret), (2) spilleren ikke allerede har gennemført det,
// og (3) kortet ikke er lukket inden for de sidste 3 dage. Kortet henter selv
// sine data, så DashboardPage ikke skal vokse med endnu en forespørgsel.
//
// CTA'en er SEKUNDÆR med vilje: dashboardets ene guld-primære element styres
// af computeDashboardGoldCta, og en guld-knap her ville være den anden
// (PAGE_TEMPLATES: ét guld-primært element pr. view).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { supabase } from "../lib/supabase";
import { inviteDismissKey, inviteDismissedUntil, isInviteDismissed } from "../lib/survey.js";
import { ClipboardIcon, XIcon } from "./ui";
import { buttonClass } from "./ui/buttonStyles.js";

export default function SurveyInviteCard() {
  const { t } = useTranslation("dashboard");
  const [survey, setSurvey] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: rows }, { data: auth }] = await Promise.all([
        supabase
          .from("surveys")
          .select("id, slug, status")
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(1),
        supabase.auth.getUser(),
      ]);
      const open = rows?.[0];
      const uid = auth?.user?.id ?? null;
      if (cancelled || !open || !uid) return;

      let dismissed;
      try {
        dismissed = isInviteDismissed(window.localStorage.getItem(inviteDismissKey(open.slug)));
      } catch {
        dismissed = false; // privat vindue / blokeret storage: vis kortet
      }
      if (dismissed) return;

      const { data: completion } = await supabase
        .from("survey_completions")
        .select("user_id")
        .eq("survey_id", open.id)
        .eq("user_id", uid)
        .maybeSingle();
      if (cancelled || completion) return;
      setSurvey(open);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!survey) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(inviteDismissKey(survey.slug), String(inviteDismissedUntil()));
    } catch {
      // Kan ikke huskes uden storage; kortet forsvinder stadig i denne session.
    }
    setSurvey(null);
  }

  return (
    <div className="mb-4 flex items-center gap-3 rounded-cz border border-cz-border bg-cz-card px-4 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-cz bg-cz-subtle text-cz-3">
        <ClipboardIcon size={16} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-cz-1">{t("surveyInvite.title")}</p>
        <p className="mt-0.5 text-xs text-cz-3">{t("surveyInvite.subtitle")}</p>
      </div>
      <Link
        to={`/survey/${survey.slug}`}
        className={`${buttonClass({ variant: "secondary", size: "sm" })} shrink-0`}
      >
        {t("surveyInvite.cta")}
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("surveyInvite.dismissAria")}
        className="shrink-0 px-1 leading-none text-cz-3 hover:text-cz-1"
      >
        <XIcon size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
