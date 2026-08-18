import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  fetchActiveOpsNotices,
  pickNoticeCopy,
  SEVERITY_META,
  readOpsNoticeDismissed,
  writeOpsNoticeDismissed,
} from "../lib/opsNotices.js";
import { AlertTriangleIcon, InfoIcon, XIcon } from "./ui/icons";

const SEVERITY_ICON = { info: InfoIcon, warning: AlertTriangleIcon, incident: AlertTriangleIcon };

// #3941 — Race Control: live-ops-lag drevet af `ops_notices` (skrives af
// Claude/ejeren uden deploy, service-role only — se database/2026-08-18-3941-
// ops-notices.sql). Ikke-kritisk UI: en hente-fejl lader banneret forblive
// skjult i stedet for at vælte layoutet (samme princip som patch-notes-
// ulæst-prikken i Layout.jsx).
export default function RaceControlBanner() {
  const { t, i18n } = useTranslation("banners");
  const [notices, setNotices] = useState([]);
  // localStorage-læsningen i `visible` er ikke reaktiv i sig selv — dette
  // tælleren tvinger et re-render efter en dismiss-klik skriver nøglen.
  const [dismissTick, setDismissTick] = useState(0);

  useEffect(() => {
    let active = true;
    fetchActiveOpsNotices()
      .then((data) => { if (active) setNotices(data); })
      .catch(() => { /* ikke-kritisk: banneret forbliver skjult */ });
    return () => { active = false; };
  }, []);

  const visible = notices.filter(
    (n) => n.severity === "incident" || !readOpsNoticeDismissed(n.id)
  );
  void dismissTick;

  if (visible.length === 0) return null;

  function handleDismiss(id) {
    writeOpsNoticeDismissed(id);
    setDismissTick((v) => v + 1);
  }

  return (
    <div role="region" aria-label={t("opsNotice.regionAriaLabel")} className="flex flex-col">
      {visible.map((notice) => {
        const meta = SEVERITY_META[notice.severity] || SEVERITY_META.info;
        const Icon = SEVERITY_ICON[notice.severity] || InfoIcon;
        const { title, body } = pickNoticeCopy(notice, i18n.language);
        const dismissable = notice.severity !== "incident";
        return (
          <div
            key={notice.id}
            className={`flex items-start gap-3 border-b px-4 py-2.5 md:px-8 ${meta.classes}`}
          >
            <Icon size={16} aria-hidden="true" className="mt-0.5 flex-shrink-0" />
            <p className="min-w-0 flex-1 text-sm leading-snug">
              <span className="font-semibold">{title}</span>
              {body && <span> {body}</span>}
              <Link to="/help?section=knownIssues" className="ms-2 whitespace-nowrap underline hover:no-underline">
                {t("opsNotice.knownIssuesLink")}
              </Link>
            </p>
            {dismissable && (
              <button
                type="button"
                onClick={() => handleDismiss(notice.id)}
                aria-label={t("opsNotice.dismissAriaLabel")}
                className="flex-shrink-0 opacity-70 transition-opacity hover:opacity-100"
              >
                <XIcon size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
