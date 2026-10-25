// #6853 / #5764 (løsning B, ejer-go 24/10): potentialet som ét tal overalt.
//
// Mit hold, akademiet, rytterprofilen og Scouting-fanen viste hver sin
// potentiale-visning for samme rytter. Serveren vælger nu ÉN rolle for alle
// flader (backend/lib/potentialDisplayBand.js): med flaget
// `potential_single_number` tændt er det rollen med det højeste potentiale, og
// svaret bærer et mærke (`bestRole` / `displayKey`), så klienten viser en lille
// typeboks ved tallet. Slukket er alt som i dag: den naturlige rolle, ingen boks.
//
// Denne fil er klientens ENE oversættelse af de tre svar-former til det samme
// { lo, hi, role, showRole }. Klienten regner aldrig selv hvilken rolle der er
// bedst; den læser kun serverens valg.

export type PotentialDisplay = {
  lo: number;
  hi: number;
  /** Rollen tallet gælder (riderTypes-nøgle), eller null hvis ukendt. */
  role: string | null;
  /** Vis typeboksen ved tallet (kun når serveren har valgt bedste rolle). */
  showRole: boolean;
};

type Band = { lo?: number | null; hi?: number | null } | null | undefined;

type Estimate = {
  hidden?: boolean;
  prog?: Band;
  ceil?: Band;
  role?: string | null;
  bestRole?: boolean;
  academyPrognosis?: AcademyPrognosisLike | null;
} | null | undefined;

type AcademyPrognosisLike = {
  band?: { lo?: number | null; hi?: number | null; role?: string | null; bestRole?: boolean } | null;
} | null | undefined;

export type ReportRow = {
  key: string;
  progLo?: number | null;
  progHi?: number | null;
  ceilLo?: number | null;
  ceilHi?: number | null;
  loft?: number | null;
  now?: number | null;
};

type ReportLike = {
  types?: ReportRow[] | null;
  primaryKey?: string | null;
  displayKey?: string | null;
} | null | undefined;

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function build(lo: unknown, hi: unknown, role: string | null | undefined, showRole: boolean): PotentialDisplay | null {
  if (!finite(lo) || !finite(hi)) return null;
  return { lo, hi, role: role ?? null, showRole: showRole && Boolean(role) };
}

/** POST /scouting/estimates-svaret for én rytter (tabeller, hero, trupper). */
export function potentialFromEstimate(estimate: Estimate): PotentialDisplay | null {
  if (!estimate || estimate.hidden) return null;
  if (estimate.academyPrognosis) return potentialFromAcademy(estimate.academyPrognosis);
  const band = estimate.prog ?? estimate.ceil;
  return build(band?.lo, band?.hi, estimate.role, estimate.bestRole === true);
}

/** Akademiets prognose (GET /academy/me og estimates for egne akademiryttere). */
export function potentialFromAcademy(prognosis: AcademyPrognosisLike): PotentialDisplay | null {
  const band = prognosis?.band;
  return build(band?.lo, band?.hi, band?.role, band?.bestRole === true);
}

/** Rækken Scouting-fanens store tal står på: serverens valg, ellers den naturlige rolle. */
export function potentialRowFromReport(report: ReportLike): ReportRow | null {
  const key = report?.displayKey ?? report?.primaryKey ?? null;
  if (!key) return null;
  return (report?.types ?? []).find((row) => row?.key === key) ?? null;
}

/** GET /riders/:id/scouting-report → samme visning som tabellerne. */
export function potentialFromReport(report: ReportLike): PotentialDisplay | null {
  const row = potentialRowFromReport(report);
  if (!row) return null;
  return build(row.progLo ?? row.ceilLo, row.progHi ?? row.ceilHi, row.key, Boolean(report?.displayKey));
}
