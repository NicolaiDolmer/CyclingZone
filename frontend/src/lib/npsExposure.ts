// #5306 — NPS-cooldownen må først starte når spilleren faktisk SER prompten.
//
// Før skrev useNpsPrompt `users.nps_last_prompted_at = NOW()` i det øjeblik
// gaten åbnede, uanset om cookie-banneret stod og skjulte baren. En spiller der
// ramte gaten med samtykke-banneret åbent, fik derfor brændt sine 90 dage uden
// nogensinde at se spørgsmålet. Med den delte bund-slot (#5440) findes der en
// tredje måde at være skjult på: release-banneret har kanten.
//
// Reglen er derfor "vist", ikke "berettiget": gaten har sagt ja, samtykke-
// banneret står IKKE, og NPS-baren har bundkanten. Samtykke-tjekket er med
// vilje dobbelt (slottet giver aldrig NPS kanten mens samtykke-banneret har
// den): skrivningen kan ikke fortrydes i 90 dage, så den læser også den direkte
// kilde og ikke kun afledningen.
//
// Ren logik uden Supabase- eller React-import, så den kan unit-testes med
// node --test. Selve skrivningen gives ind som en funktion.

export interface NpsExposureState {
  /** Gaten sagde ja (nok løbsdage, ikke svaret, cooldown udløbet) og baren er ikke lukket. */
  eligible: boolean;
  /** Cookie-/samtykke-banneret står åbent. */
  bannerOpen: boolean;
  /** NPS-baren har den delte bund-slot (#5440). */
  slotGranted: boolean;
}

/** Er NPS-baren synlig for spilleren lige nu? */
export function isNpsPromptShown({ eligible, bannerOpen, slotGranted }: NpsExposureState): boolean {
  return Boolean(eligible) && !bannerOpen && Boolean(slotGranted);
}

export type NpsExposureWrite = (userId: string, promptedAtIso: string) => void;

export interface NpsExposureMarker {
  /**
   * Kaldes ved hver tilstandsændring. Skriver cooldown-tidsstemplet HØJST én
   * gang pr. instans, og kun i det første øjeblik baren faktisk er synlig.
   * @returns sand hvis der blev skrevet nu.
   */
  observe(state: NpsExposureState & { userId: string | null | undefined }): boolean;
  readonly marked: boolean;
}

export function createNpsExposureMarker(
  write: NpsExposureWrite,
  now: () => Date = () => new Date(),
): NpsExposureMarker {
  let marked = false;
  return {
    observe({ userId, ...state }) {
      if (marked || !userId || !isNpsPromptShown(state)) return false;
      marked = true;
      try {
        write(userId, now().toISOString());
      } catch {
        // Best-effort: en fejlet skrivning må aldrig vælte UI'et. Prisen er at
        // prompten kan komme igen ved næste indlæsning — ikke en tabt spiller.
      }
      return true;
    },
    get marked() {
      return marked;
    },
  };
}
