// backend/lib/planningDidNotStart.ts
// #7518 - planlaegningens "stillede ikke op" for et startet loeb.
//
// Et hold kan kun "ikke stille op" til et loeb, det havde mulighed for at stille op til.
// Et hold oprettet EFTER loebets foerste etape hoerer ikke til loebet: det skal ikke have
// "stillede ikke op, for faa raske ryttere" for et loeb der startede foer det fandtes.
// Den eksplicitte DNS-registrering (race_withdrawals "did_not_start") er uaendret.
//
// Ren funktion, ingen I/O. Kaster aldrig.

type TimeLike = string | number | Date | null | undefined;

function toMs(value: TimeLike): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Fandtes holdet inden loebets foerste etape? Ukendt tidspunkt (hold eller loeb) svarer ja,
 * saa den hidtidige adfaerd bevares naar vi ikke kan afgoere det.
 */
export function teamExistedAtRaceStart({ teamCreatedAt, raceStart }: { teamCreatedAt?: TimeLike; raceStart?: TimeLike }): boolean {
  const created = toMs(teamCreatedAt);
  const start = toMs(raceStart);
  if (created == null || start == null) return true;
  return created < start;
}

/**
 * Skal planlaegningskolonnen vise "stillede ikke op"?
 * - kun et startet loeb uden frivillig afmelding,
 * - eksplicit DNS tael altid,
 * - "ikke i det faktiske startfelt" (inField === false) taeller kun hvis holdet fandtes ved start.
 */
export function planningDidNotStart({ started, voluntaryWithdrawn, explicitDidNotStart, inField, teamCreatedAt, raceStart }: {
  started: boolean;
  voluntaryWithdrawn: boolean;
  explicitDidNotStart: boolean;
  inField?: boolean | null;
  teamCreatedAt?: TimeLike;
  raceStart?: TimeLike;
}): boolean {
  if (!started || voluntaryWithdrawn) return false;
  if (explicitDidNotStart) return true;
  return inField === false && teamExistedAtRaceStart({ teamCreatedAt, raceStart });
}
