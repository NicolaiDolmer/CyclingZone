// #7664: "Opdateret kl." paa rytterranglisten. Rene hjaelpere (ingen React,
// ingen Supabase), saa `node --test` kan proeve dem direkte.
//
// Reglen: tidspunktet maa aldrig love mere end tallene indeholder.
//  - Backenden saetter kun current_as_of, naar ranglisterne laeser de nye
//    tabeller (kontakten ranking_shadow_decoupled_6765 taendt).
//  - Opslaget startes FOER tallene laeses og bruges kun, hvis svaret er
//    kommet, naar tallene er hentet. Saa beskriver tidspunktet en tilstand,
//    tallene mindst er lige saa nye som. Ellers vises ingen linje.
//  - Klokkeslaettet vises i spillets tid (Europe/Copenhagen), som etapeplanen.
import { RACE_TIMEZONE } from "./stageScheduleConfig.js";

/** Tidsstemplet linjen skal vise, eller null naar der ingen linje skal vaere. */
export function updatedAtFromFreshness(body: unknown): string | null {
  const value = (body as { current_as_of?: unknown } | null | undefined)?.current_as_of;
  if (typeof value !== "string") return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

/** Klokkeslaet (tt:mm) i spillets tidszone, "" hvis tidspunktet er ugyldigt. */
export function formatUpdatedAtTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale || "en", { timeZone: RACE_TIMEZONE, hour: "2-digit", minute: "2-digit" }).format(date);
  } catch {
    return "";
  }
}

/**
 * Starter opslaget nu. `settled()` giver tidspunktet, hvis svaret allerede er
 * kommet, ellers null. Fejl og manglende svar giver null (ingen linje).
 */
export function startFreshnessProbe(load: () => Promise<unknown>): { settled: () => string | null } {
  let value: string | null = null;
  void Promise.resolve().then(load).then((body) => { value = updatedAtFromFreshness(body); }, () => {});
  return { settled: () => value };
}
