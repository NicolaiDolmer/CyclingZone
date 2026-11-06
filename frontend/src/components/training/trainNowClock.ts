import { formatClock24, intlLocale } from "../../lib/intlLocale.ts";

const GAME_TZ = "Europe/Copenhagen";

/**
 * #6139: HH:MM in game time (Europe/Copenhagen) for "locked since"; null when unknown.
 * Its own module (not TrainNowState.ts) so the race selection panel does not pull the
 * training state module into a shared chunk (bundle budget, #6372).
 */
export function trainNowClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return formatClock24(date, GAME_TZ);
}

// Copenhagen calendar day as a UTC day number, so two instants compare by game day (not by 24h).
function copenhagenDayNumber(date: Date): number | null {
  const parts = new Intl.DateTimeFormat(intlLocale("en"), {
    timeZone: GAME_TZ, year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const y = pick("year"), m = pick("month"), d = pick("day");
  if (![y, m, d].every(Number.isFinite)) return null;
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * #7558: the game day the Train now press belongs to, relative to now, for a lock that
 * covers a whole race. A stage race that started yesterday still shows the lock from
 * yesterday's press on today's board, so "today" may not be claimed from the lock alone.
 * Returns null when the press was today OR the time is unknown (the wording is unchanged
 * then); otherwise a short label for the earlier day ("yesterday" / "5 Nov").
 */
export function trainNowEarlierDay(
  pressedAt: string | null | undefined,
  language: string,
  now: Date = new Date(),
): string | null {
  if (!pressedAt) return null;
  const pressed = new Date(pressedAt);
  if (Number.isNaN(pressed.getTime())) return null;
  const pressedDay = copenhagenDayNumber(pressed);
  const today = copenhagenDayNumber(now);
  if (pressedDay == null || today == null || pressedDay >= today) return null;
  const locale = intlLocale(language);
  if (today - pressedDay === 1) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day");
  }
  return new Intl.DateTimeFormat(locale, { timeZone: GAME_TZ, day: "numeric", month: "short" }).format(pressed);
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * #7558: the three Train now lock texts (banner title, banner body, rider badge), worded for
 * the day the press actually happened. Same texts as before when the press was today.
 */
export function trainNowLockCopy(
  t: Translate,
  pressedAt: string | null | undefined,
  language: string,
  now: Date = new Date(),
): { title: string; body: string; rider: string; earlier: boolean } {
  const day = trainNowEarlierDay(pressedAt, language, now);
  const time = trainNowClock(pressedAt);
  if (day) {
    return {
      title: t("selection.trainNowLock.titleEarlier"),
      body: time
        ? t("selection.trainNowLock.bodyEarlierAt", { day, time })
        : t("selection.trainNowLock.bodyEarlier"),
      rider: t("selection.trainNowLock.riderEarlier"),
      earlier: true,
    };
  }
  return {
    title: t("selection.trainNowLock.title"),
    body: time ? t("selection.trainNowLock.bodyAt", { time }) : t("selection.trainNowLock.body"),
    rider: t("selection.trainNowLock.rider"),
    earlier: false,
  };
}
