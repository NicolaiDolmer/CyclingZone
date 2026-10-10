// #6060: "Copy to next N days" i Plan-kortets intensitets-gitter. Ren logik, ingen React.
// Kopien skriver kun i kladden via intensity.onSetDay; gem/fortryd er som foer.
export const MAX_COPY_DAYS = 6;

export type CopyTargetOptions = { todayWeekday?: string | null; todayLocked?: boolean };

// De n naeste ugedage efter kilden (wrap rundt om ugen), aldrig kilde-dagen, max 6.
// Er dagens felter laast (#6139), springes i dag over (og taeller ikke med i n).
export function copyTargets(
  sourceWeekday: string,
  n: number,
  weekdays: readonly string[],
  { todayWeekday = null, todayLocked = false }: CopyTargetOptions = {},
): string[] {
  const start = weekdays.indexOf(sourceWeekday);
  if (start < 0 || weekdays.length < 2) return [];
  const count = Math.max(0, Math.min(Math.floor(Number(n) || 0), MAX_COPY_DAYS, weekdays.length - 1));
  const targets: string[] = [];
  for (let step = 1; step <= count; step += 1) {
    const day = weekdays[(start + step) % weekdays.length];
    if (day === sourceWeekday) continue;
    if (todayLocked && day === todayWeekday) continue;
    targets.push(day);
  }
  return targets;
}

// Kopierer kildens intensitet til maaldagene via kladde-setteren. Returnerer maaldagene.
export function applyCopyDay(
  sourceWeekday: string,
  n: number,
  weekdays: readonly string[],
  intensityFor: (weekday: string) => string,
  onSetDay: (weekday: string, intensity: string) => void,
  opts: CopyTargetOptions = {},
): string[] {
  const value = intensityFor(sourceWeekday);
  const targets = copyTargets(sourceWeekday, n, weekdays, opts);
  for (const day of targets) onSetDay(day, value);
  return targets;
}
