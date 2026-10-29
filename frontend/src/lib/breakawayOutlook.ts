// frontend/src/lib/breakawayOutlook.ts
// #6912 B: motorens udbrudschance for løbets næste etape (GET /api/races/:raceId/breakaway-outlook)
// → i18n-nøgler til jæger-boksen. Ren helper, ingen React. Backend afgør om motoren
// kan stå inde for tallet; her vises kun et svar med `available: true` og en kendt form.

type Fraction = [number, number];

export type BreakawayOutlook = {
  available?: boolean;
  reason?: string;
  odds?: { about?: Fraction; under?: Fraction; over?: Fraction } | null;
  chase?: { kind?: string } | null;
  stageNumber?: number | null;
};

export type OutlookLine = {
  oddsKey: string;
  oddsParams: { k: number; n: number };
  reasonKey: string | null;
  stageNumber: number | null;
};

const REASONS = new Set(["nobodyChases", "fewChase", "manyChase"]);

function validFraction(f: unknown): f is Fraction {
  return Array.isArray(f) && f.length === 2 && f.every((x) => Number.isInteger(x) && x > 0) && f[0] < f[1];
}

/** Svar → nøgler, eller null når der intet tal er at vise. */
export function outlookLine(outlook: BreakawayOutlook | null | undefined): OutlookLine | null {
  if (!outlook || outlook.available !== true || !outlook.odds) return null;
  const { about, under, over } = outlook.odds;
  const pick = validFraction(about) ? { kind: "about", f: about }
    : validFraction(under) ? { kind: "under", f: under }
    : validFraction(over) ? { kind: "over", f: over }
    : null;
  if (!pick) return null;
  const kind = outlook.chase?.kind;
  const stage = Number.isInteger(outlook.stageNumber) ? (outlook.stageNumber as number) : null;
  return {
    oddsKey: `racehub.hunterExplainer.outlook.${pick.kind}`,
    oddsParams: { k: pick.f[0], n: pick.f[1] },
    reasonKey: kind && REASONS.has(kind) ? `racehub.hunterExplainer.outlook.reason.${kind}` : null,
    stageNumber: stage,
  };
}
