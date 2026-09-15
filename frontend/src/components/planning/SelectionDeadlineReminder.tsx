import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangleIcon } from "../ui/icons";
import {
  deadlineCountdown,
  REMINDER_BOX_TONE_CLASS,
  REMINDER_TEXT_TONE_CLASS,
  type SelectionReminder,
} from "../../lib/selectionReminder.ts";

// #4983 — boksen øverst på planlægningssiden: hvilke trupper mangler, og hvor
// længe der er til fristen. Gul inde i #2180's 36-timers vindue; rød KUN når
// truppen er under deltagelses-gulvet (holdet stiller ikke op) inde i
// assistentens late fill-horisont (app_config.assistant_late_fill_hours,
// default 24) — ejer-beslutning 10/9. Et hold på 6/8 er gult hele vejen ned til
// start. Tallene og tonerne kommer FÆRDIGE fra serveren; komponenten regner intet.
//
// Kort på fladen (P9): titel, én linje kontekst, og så listen. Forklaringen af
// hvornår markeringen tændes bor i Hjælp, ikke her. Ingen guld — den primære
// guld-knap på siden er stadig boardets egen (P3, én pr. view), så løbene her
// er quiet links.

function CountdownLabel({ hoursUntil, tone }: { hoursUntil: number; tone: "warning" | "urgent" }) {
  const { t } = useTranslation("races");
  const { unit, value } = deadlineCountdown(hoursUntil);
  const label =
    unit === "past" ? t("selectionReminder.deadlinePassed") : t(`selectionReminder.in.${unit}`, { count: value });
  return (
    <span className={`text-xs font-semibold tabular-nums whitespace-nowrap ${REMINDER_TEXT_TONE_CLASS[tone]}`}>
      {label}
    </span>
  );
}

export default function SelectionDeadlineReminder({ reminder }: { reminder: SelectionReminder }) {
  const { t } = useTranslation("races");
  if (!reminder?.enabled || reminder.tone === "none" || !reminder.races.length) return null;
  const tone = reminder.tone as "warning" | "urgent";
  // Rød overskrift lover "stiller ikke op" — så teksten under skal tælle netop
  // DE løb, ikke alle i boksen. Et gult 6/8 ved siden af et rødt 5/8 må ikke
  // tælles med i "under grænsen".
  const urgentCount = reminder.races.filter((race) => race.tone === "urgent").length;

  return (
    <div
      role="status"
      className={`mb-5 rounded-cz border px-4 py-3 ${REMINDER_BOX_TONE_CLASS[tone]}`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangleIcon
          size={16}
          aria-hidden="true"
          className={`mt-0.5 flex-shrink-0 ${REMINDER_TEXT_TONE_CLASS[tone]}`}
        />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${REMINDER_TEXT_TONE_CLASS[tone]}`}>
            {tone === "urgent" ? t("selectionReminder.titleUrgent") : t("selectionReminder.title")}
          </p>
          <p className="text-cz-2 mt-0.5 text-xs leading-snug">
            {tone === "urgent"
              ? t("selectionReminder.bodyUrgent", { count: urgentCount })
              : t("selectionReminder.body", { count: reminder.races.length })}
          </p>

          <ul className="mt-3 space-y-px">
            {reminder.races.map((race) => (
              <li
                key={race.id}
                className="border-cz-border flex items-center justify-between gap-3 border-t py-1.5 first:border-t-0 first:pt-0"
              >
                <Link
                  to={`/races/${race.id}`}
                  className="text-cz-1 min-w-0 truncate text-sm hover:underline"
                >
                  {race.name}
                </Link>
                <span className="flex flex-shrink-0 items-center gap-3">
                  <span className="text-cz-3 text-xs tabular-nums whitespace-nowrap">
                    {t("selectionReminder.picked", {
                      picked: race.entry_count,
                      target: race.target_size,
                    })}
                  </span>
                  <CountdownLabel hoursUntil={race.hours_until} tone={race.tone as "warning" | "urgent"} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
