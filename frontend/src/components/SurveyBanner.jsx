import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { logEvent } from "../lib/logEvent";

const DISMISS_KEY = "cz_survey_banner_dismissed_at";
const CLICK_KEY = "cz_survey_banner_clicked_at";
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dage

async function hashUserId(userId) {
  if (!userId || !globalThis.crypto?.subtle) return "anon";
  const bytes = new TextEncoder().encode(userId);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readLocalTimestamp(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? Number(v) || 0 : 0;
  } catch {
    return 0;
  }
}

function isDismissActive() {
  const at = readLocalTimestamp(DISMISS_KEY);
  return at > 0 && Date.now() - at < DISMISS_TTL_MS;
}

function hasClicked() {
  return readLocalTimestamp(CLICK_KEY) > 0;
}

export default function SurveyBanner() {
  const { t } = useTranslation("banners");
  const [visible, setVisible] = useState(false);
  const [isAdminPreview, setIsAdminPreview] = useState(false);
  const [surveyUrl, setSurveyUrl] = useState("");
  const [hashedId, setHashedId] = useState("anon");

  useEffect(() => {
    let cancelled = false;

    async function evaluate() {
      if (hasClicked() || isDismissActive()) return;

      const [{ data: configRows }, { data: { user } }, { data: isAdminRaw }] = await Promise.all([
        supabase.from("app_config").select("key,value").in("key", ["survey_banner_enabled", "survey_banner_url"]),
        supabase.auth.getUser(),
        supabase.rpc("is_admin"),
      ]);
      if (cancelled) return;

      const config = (configRows || []).reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {});
      const enabled = config.survey_banner_enabled === true;
      const url = typeof config.survey_banner_url === "string" ? config.survey_banner_url : "";
      const admin = isAdminRaw === true;

      if (!url || url.includes("PLACEHOLDER")) {
        // Ingen rigtig Tally-URL endnu — vis kun for admins som preview, og kun
        // hvis flaggen IKKE er ON (så vi aldrig sender brugere mod placeholder).
        if (!admin) return;
      }

      const shouldShow = enabled || admin;
      if (!shouldShow) return;

      const hashed = await hashUserId(user?.id);
      if (cancelled) return;

      setHashedId(hashed);
      setSurveyUrl(url);
      setIsAdminPreview(!enabled && admin);
      setVisible(true);
      logEvent("survey_banner_shown", { admin_preview: !enabled && admin });
    }

    evaluate();
    return () => { cancelled = true; };
  }, []);

  function buildTallyUrl() {
    if (!surveyUrl) return "#";
    try {
      const u = new URL(surveyUrl);
      u.searchParams.set("utm_source", "app");
      u.searchParams.set("utm_campaign", "sprint_validation_w2");
      u.searchParams.set("user_id", hashedId);
      return u.toString();
    } catch {
      return surveyUrl;
    }
  }

  function handleClick() {
    try { localStorage.setItem(CLICK_KEY, String(Date.now())); } catch { /* noop */ }
    logEvent("survey_banner_clicked", { admin_preview: isAdminPreview });
    setVisible(false);
  }

  function handleDismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* noop */ }
    logEvent("survey_banner_dismissed", { admin_preview: isAdminPreview });
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label={t("survey.regionAriaLabel")}
      className="mb-4 rounded-xl border border-cz-accent/40 bg-cz-accent/10 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 min-w-0 text-sm text-cz-1">
          <span className="me-1" aria-hidden="true">📋</span>
          {t("survey.message")}
          {isAdminPreview && (
            <span className="ms-2 text-xs text-cz-3 italic">{t("survey.adminPreviewHint")}</span>
          )}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={buildTallyUrl()}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleClick}
            className="inline-flex items-center gap-1 rounded-lg bg-cz-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition"
          >
            {t("survey.cta")} <span aria-hidden="true">→</span>
          </a>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t("survey.dismissAriaLabel")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-cz-3 hover:bg-cz-subtle hover:text-cz-1 transition"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
    </div>
  );
}
