import { useTranslation } from "react-i18next";
import TooltipJs from "../../ui/Tooltip.jsx";
import { InfoIcon } from "../../ui/icons/index.jsx";
import { isDisplayCatalogV3 } from "../../../lib/training.js";
import { SESSION_INTENSITY_V3, SKILL_SESSIONS, RECOVERY_FOCUS, sessionI18nKey } from "../../../lib/trainingDayTypes.js";
import type { ComponentType, ReactNode } from "react";

// #8856 · The training report names the session the rider actually rode, the same name the
// day picker shows ("Klatreintervaller"), not only the ability family ("VO2max"), which covers
// three different sessions. Hover, keyboard focus or a tap (Android) opens a tooltip with the
// ability family, the session's level and its note, when it has one.

const Tooltip = TooltipJs as unknown as ComponentType<{ label: ReactNode; side?: "top" | "bottom" | "left" | "right"; children: ReactNode }>;

/** The i18n keys (namespace "training" unless noted) that describe one stored focus. */
export interface SessionTextKeys {
  /** The session's own name, as the day picker writes it. */
  name: string;
  /** The ability family in the rider namespace ("rider:training.focus_*"). */
  family: string;
  /** The level ("Hård") or the day type for a skill session; null when the focus has none. */
  level: string | null;
  /** The session's note; only some sessions have one, so the caller reads it with an empty default. */
  note: string;
}

export function sessionTextKeys(focus: string, catalogV3: boolean = isDisplayCatalogV3()): SessionTextKeys {
  const family = `rider:training.focus_${focus}`;
  if (focus === RECOVERY_FOCUS) return { name: "dayPanel.dayType_recovery", family, level: null, note: "dayPanel.noSession_recovery" };
  const intensity = (SESSION_INTENSITY_V3 as Record<string, string | undefined>)[focus];
  const level = SKILL_SESSIONS.includes(focus) ? "dayPanel.dayType_skill" : intensity ? `dayPanel.level_${intensity}` : null;
  return { name: sessionI18nKey("dayPanel.session", focus, catalogV3), family, level, note: sessionI18nKey("dayPanel.sessionNote", focus, catalogV3) };
}

/** The session's name with a tooltip. `className` styles the visible name. */
export default function SessionName({ focus, className = "", testId = "session-name" }: { focus: string; className?: string; testId?: string }) {
  const { t } = useTranslation(["training", "rider"]);
  const keys = sessionTextKeys(focus);
  const family = t(keys.family, { defaultValue: focus });
  const name = t(keys.name, { defaultValue: family });
  const level = keys.level ? t(keys.level) : null;
  const note = t(keys.note, { defaultValue: "" });
  // The family repeats the name for sessions whose family is the session itself ("Tempo").
  const facts = [family !== name ? family : null, level].filter(Boolean).join(" · ");
  const label = (
    <span className="block" data-testid={`${testId}-tip`}>
      <span className="block font-semibold">{name}</span>
      {facts && <span className="block text-cz-2">{facts}</span>}
      {note && <span className="mt-1 block">{note}</span>}
    </span>
  );
  return (
    <Tooltip label={label}>
      <button type="button" data-testid={testId} data-focus={focus}
        className={`inline-flex min-w-0 max-w-full items-start gap-1 text-left ${className}`}>
        <span className="min-w-0 wrap-break-word">{name}</span>
        <InfoIcon size={11} className="mt-0.5 shrink-0 text-cz-3" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
