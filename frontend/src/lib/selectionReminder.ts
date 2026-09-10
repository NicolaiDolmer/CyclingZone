// #4983 — den synlige påmindelse før trup-udtagelsesfristen: rene funktioner
// bag nav-markeringen (Layout.jsx) og boksen på planlægningssiden
// (SelectionDeadlineReminder.tsx). Samme opskrift som navBadges.js/navDots:
// logikken bor i en test-bar fil, React-wiringen bliver i fladen.
//
// Kilden til tallene er backend (`GET /api/me/selection-reminder`,
// backend/lib/selectionDeadlineReminder.js). Klienten gen-beregner ALDRIG
// hverken fristen eller "trup mangler" — den ville uundgåeligt divergere fra
// #2180's sweep og #4038's optælling. Her oversættes serverens svar kun til
// tone-klasser og et tids-format.

export type SelectionReminderTone = "none" | "warning" | "urgent";

export interface SelectionReminderRace {
  id: string;
  name: string;
  race_class?: string | null;
  deadline_at: string;
  hours_until: number;
  entry_count: number;
  target_size: number;
  tone: SelectionReminderTone;
}

export interface SelectionReminder {
  enabled: boolean;
  tone: SelectionReminderTone;
  count: number;
  races: SelectionReminderRace[];
  window_hours: number | null;
  urgent_hours: number | null;
}

export const EMPTY_SELECTION_REMINDER: SelectionReminder = {
  enabled: true,
  tone: "none",
  count: 0,
  races: [],
  window_hours: null,
  urgent_hours: null,
};

const TONES = new Set<SelectionReminderTone>(["none", "warning", "urgent"]);

function toTone(value: unknown): SelectionReminderTone {
  return TONES.has(value as SelectionReminderTone) ? (value as SelectionReminderTone) : "none";
}

/**
 * Normaliserer serverens svar. Et ufuldstændigt eller uventet svar bliver til
 * "ingen påmindelse" — en markering der lyver er værre end ingen markering, og
 * Layout mounter dette på hver eneste side.
 */
export function normalizeSelectionReminder(payload: unknown): SelectionReminder {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const races = Array.isArray(raw.races) ? (raw.races as SelectionReminderRace[]) : [];
  const enabled = raw.enabled !== false;
  if (!enabled || !races.length) {
    return {
      ...EMPTY_SELECTION_REMINDER,
      enabled,
      window_hours: typeof raw.window_hours === "number" ? raw.window_hours : null,
      urgent_hours: typeof raw.urgent_hours === "number" ? raw.urgent_hours : null,
    };
  }
  return {
    enabled: true,
    tone: toTone(raw.tone),
    count: typeof raw.count === "number" ? raw.count : races.length,
    races: races.map((race) => ({ ...race, tone: toTone(race?.tone) })),
    window_hours: typeof raw.window_hours === "number" ? raw.window_hours : null,
    urgent_hours: typeof raw.urgent_hours === "number" ? raw.urgent_hours : null,
  };
}

/**
 * Tonen for nav-markeringen ved ét menupunkt. Samme item-specifikke opslags-
 * recipe som resolveNavBadgeCount/resolveNavDot: et punkt uden `dot: true`
 * markeres aldrig, uanset hvad kortet indeholder for den `to`.
 */
export function resolveNavDotTone(
  item: { to?: string; dot?: boolean } | null | undefined,
  dotTones: Record<string, SelectionReminderTone | undefined> | null | undefined,
): SelectionReminderTone {
  if (!item?.dot || !item.to) return "none";
  return toTone(dotTones?.[item.to]);
}

// Gul og rød er de eksisterende status-tokens (--warning/--danger), ikke nye
// farver. Ingen skygger, hairline-border — TASTE P3/P8.
export const NAV_DOT_TONE_CLASS: Record<Exclude<SelectionReminderTone, "none">, string> = {
  warning: "bg-cz-warning",
  urgent: "bg-cz-danger",
};

export const REMINDER_BOX_TONE_CLASS: Record<Exclude<SelectionReminderTone, "none">, string> = {
  warning: "border-cz-warning/40 bg-cz-warning-bg",
  urgent: "border-cz-danger/40 bg-cz-danger-bg",
};

export const REMINDER_TEXT_TONE_CLASS: Record<Exclude<SelectionReminderTone, "none">, string> = {
  warning: "text-cz-warning",
  urgent: "text-cz-danger",
};

export type DeadlineCountdown =
  | { unit: "past"; value: 0 }
  | { unit: "minutes" | "hours" | "days"; value: number };

/**
 * Tid til fristen som ét tal + én enhed, så fladen holder sig til én kort
 * streng ("in 6h") i stedet for en sætning. Under en time vises minutter,
 * under to døgn timer, derover hele dage. Nedrunding hele vejen: "in 1h" må
 * aldrig stå når der er 65 minutter tilbage — påmindelsen skal hellere haste
 * lidt for meget end for lidt.
 *
 * "past"-grenen er bevidst UOPNÅELIG i dag og bliver stående som værn:
 * serveren filtrerer allerede startede løb fra (`startMs <= nowMs → continue`,
 * selectionWarningSweep.js), så `hours_until` er altid positiv i et gyldigt
 * svar. Men tallet kommer fra netværket, og `normalizeSelectionReminder`
 * validerer det ikke — uden grenen ville et negativt eller NaN-felt (ændret
 * serverkontrakt, proxy der roder med JSON) rendere "in -3h" eller "in NaN h" i
 * navigationens vigtigste advarsel. i18n-nøglen `selectionReminder.deadlinePassed`
 * (en+da) findes udelukkende for denne gren og skal derfor blive.
 */
export function deadlineCountdown(hoursUntil: number): DeadlineCountdown {
  if (!Number.isFinite(hoursUntil) || hoursUntil <= 0) return { unit: "past", value: 0 };
  if (hoursUntil < 1) return { unit: "minutes", value: Math.max(1, Math.floor(hoursUntil * 60)) };
  if (hoursUntil < 48) return { unit: "hours", value: Math.floor(hoursUntil) };
  return { unit: "days", value: Math.floor(hoursUntil / 24) };
}
