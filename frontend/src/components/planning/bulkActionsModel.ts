// #7535 · DESIGN-SPOR (merges ikke): model bag de tre handlinger paa planlaegningssiden
// ("Lad assistenten udtage", "Fjern udtagelser", "Afmeld") over et valgt omfang af loeb.
//
// Kun preview-mocken bruger den (?actions=a|b|c). Alt lander som en KLADDE: intet sendes til en
// server, og intet gemmes foer spilleren trykker Gem i bjaelken. Rene funktioner, testet med node --test.
import {
  entriesAfterClear,
  isRacePast,
  raceReadiness,
  sharesRaceDays,
  pickedCounts,
  type SeasonEntry,
  type SeasonRace,
  type TrainNowLocks,
} from "../../lib/planningWorkbench.ts";

export type ActionsVariant = "a" | "b" | "c";
export type BulkScope = "next" | "checked" | "shown" | "season";
export type BulkKind = "auto" | "clear" | "withdraw";

export const BULK_SCOPES: BulkScope[] = ["next", "checked", "shown", "season"];
export const BULK_KINDS: BulkKind[] = ["auto", "clear", "withdraw"];

/** ?actions=a|b|c, men kun naar preview-mocken koerer (aldrig i et prod-build). */
export function parseActionsVariant(value: string | null, previewMock: boolean): ActionsVariant | null {
  if (!previewMock) return null;
  return value === "a" || value === "b" || value === "c" ? value : null;
}

/** Kladden: hvad hver handling goer ved hvert loeb (sidste handling paa et loeb vinder). */
export interface BulkDraft {
  kinds: Map<string, BulkKind>;
  /** Assistentens trup pr. loeb, regnet ud i det oejeblik handlingen blev valgt. */
  auto: Map<string, SeasonEntry[]>;
}

export const EMPTY_DRAFT: BulkDraft = { kinds: new Map(), auto: new Map() };

/** Entries som kladden viser dem: ryddede loeb uden ryttere (Train now-laaste bliver), afmeldte tomme, assistentens trupper sat ind. */
export function entriesWithDraft(entries: SeasonEntry[], draft: BulkDraft, locks: TrainNowLocks = {}): SeasonEntry[] {
  if (!draft.kinds.size) return entries;
  const cleared = new Set([...draft.kinds].filter(([, k]) => k === "clear").map(([id]) => id));
  const out = new Set([...draft.kinds].filter(([, k]) => k !== "clear").map(([id]) => id));
  const kept = entriesAfterClear(entries, cleared, locks).filter((e) => !out.has(e.raceId));
  const added = [...draft.kinds].filter(([, k]) => k === "auto").flatMap(([id]) => draft.auto.get(id) ?? []);
  return [...kept, ...added];
}

export function withdrawnWithDraft(withdrawn: Set<string>, draft: BulkDraft): Set<string> {
  const ids = [...draft.kinds].filter(([, k]) => k === "withdraw").map(([id]) => id);
  return ids.length ? new Set([...withdrawn, ...ids]) : withdrawn;
}

/** De loeb et omfang daekker, i kalenderens raekkefoelge. */
export function scopeRaces(
  scope: BulkScope,
  ctx: { allRaces: SeasonRace[]; listRaces: SeasonRace[]; checked: Set<string>; withdrawn: Set<string> },
): SeasonRace[] {
  const open = ctx.allRaces.filter((r) => !isRacePast(r));
  const byDay = (a: SeasonRace, b: SeasonRace) => a.gameDayStart - b.gameDayStart || a.name.localeCompare(b.name);
  if (scope === "season") return [...open].sort(byDay);
  if (scope === "shown") return ctx.listRaces.filter((r) => !isRacePast(r));
  if (scope === "checked") return open.filter((r) => ctx.checked.has(r.id)).sort(byDay);
  // "Naeste loeb": det foerste kommende loeb, holdet stadig kan aendre i.
  const next = [...open].sort(byDay).find((r) => !r.lineupLocked && !ctx.withdrawn.has(r.id));
  return next ? [next] : [];
}

/** De loeb i omfanget, som handlingen faktisk aendrer (taelleren ved knappen). */
export function actionTargets(
  kind: BulkKind,
  races: SeasonRace[],
  ctx: { entries: SeasonEntry[]; withdrawn: Set<string>; locks?: TrainNowLocks },
): SeasonRace[] {
  const counts = pickedCounts(ctx.entries);
  return races.filter((race) => {
    if (isRacePast(race) || race.lineupLocked || ctx.withdrawn.has(race.id)) return false;
    if (kind === "withdraw") return true;
    if (kind === "auto") return raceReadiness(race, counts.get(race.id) ?? 0, ctx.withdrawn).missing > 0;
    const locked = new Set(ctx.locks?.[race.id]?.riderIds ?? []);
    return ctx.entries.some((e) => e.raceId === race.id && !locked.has(e.riderId));
  });
}

export interface PreviewRider {
  id: string;
  abilities?: Record<string, number> | null;
  injured?: boolean;
}

// Preview-mockens grove rute-match: hvilke evner en etapetype spoerger efter. Kun til at
// tegne en troværdig kladde i designet; den rigtige assistent er serverens.
const STAGE_ABILITIES: Record<string, string[]> = {
  flat: ["sprint", "flat"],
  rolling: ["flat", "punch"],
  hilly: ["punch", "climbing"],
  mountain: ["climbing", "endurance"],
  high_mountain: ["climbing", "endurance", "recovery"],
  itt: ["time_trial", "tempo"],
  ttt: ["time_trial", "tempo"],
  cobbles: ["cobblestone", "flat"],
};

function fitFor(rider: PreviewRider, types: string[]): number {
  const ab = rider.abilities ?? {};
  const list = types.length ? types : ["flat"];
  const per = list.map((t) => {
    const keys = STAGE_ABILITIES[t] ?? ["flat"];
    return keys.reduce((s, k) => s + (ab[k] ?? 0), 0) / keys.length;
  });
  return per.reduce((s, v) => s + v, 0) / per.length;
}

/**
 * "Lad assistenten udtage": fylder de tomme pladser i hvert loeb med de bedst egnede ledige ryttere.
 * Spillerens egne valg bliver staaende; skadede og ryttere i et loeb paa samme loebsdage springes over.
 * Mangler loebet en kaptajn, faar den bedst egnede rolle. Loebene tages i kalenderens raekkefoelge,
 * saa et tidligt loeb faar foerst.
 */
export function assistantFill(args: {
  races: SeasonRace[];
  allRaces: SeasonRace[];
  entries: SeasonEntry[];
  withdrawn: Set<string>;
  riders: PreviewRider[];
  terrain: Map<string, string[]>;
}): Map<string, SeasonEntry[]> {
  const byId = new Map(args.allRaces.map((r) => [r.id, r]));
  const result = new Map<string, SeasonEntry[]>();
  let work = [...args.entries];
  const ordered = [...args.races].sort((a, b) => a.gameDayStart - b.gameDayStart || a.name.localeCompare(b.name));
  for (const race of ordered) {
    const own = work.filter((e) => e.raceId === race.id);
    const need = Math.max(0, (Number(race.sizeMax) || 0) - own.length);
    if (need === 0) continue;
    const types = args.terrain.get(race.id) ?? [];
    const busy = new Set(
      work
        .filter((e) => {
          const other = byId.get(e.raceId);
          return e.raceId !== race.id && !!other && !isRacePast(other) && !args.withdrawn.has(other.id) && sharesRaceDays(race, other);
        })
        .map((e) => e.riderId),
    );
    const mine = new Set(own.map((e) => e.riderId));
    const pool = args.riders
      .filter((r) => !r.injured && !mine.has(r.id) && !busy.has(r.id))
      .map((r) => ({ id: r.id, fit: fitFor(r, types) }))
      .sort((a, b) => b.fit - a.fit || a.id.localeCompare(b.id))
      .slice(0, need);
    if (!pool.length) continue;
    let next: SeasonEntry[] = [...own, ...pool.map((p) => ({ raceId: race.id, riderId: p.id, raceRole: null }))];
    if (!next.some((e) => e.raceRole === "captain")) {
      const fits = new Map(args.riders.map((r) => [r.id, fitFor(r, types)]));
      const captain = [...next].sort((a, b) => (fits.get(b.riderId) ?? 0) - (fits.get(a.riderId) ?? 0))[0];
      next = next.map((e) => (e.riderId === captain.riderId ? { ...e, raceRole: "captain" } : e));
    }
    result.set(race.id, next);
    work = [...work.filter((e) => e.raceId !== race.id), ...next];
  }
  return result;
}

/** Laegger en handling oven i kladden for de givne loeb. */
export function addToDraft(draft: BulkDraft, kind: BulkKind, raceIds: string[], auto?: Map<string, SeasonEntry[]>): BulkDraft {
  const kinds = new Map(draft.kinds);
  const nextAuto = new Map(draft.auto);
  for (const id of raceIds) {
    if (kind === "auto" && !auto?.has(id)) continue;
    kinds.set(id, kind);
    if (kind === "auto") nextAuto.set(id, auto!.get(id)!);
    else nextAuto.delete(id);
  }
  return { kinds, auto: nextAuto };
}

/** Bjaelkens resume: antal loeb pr. handling og hvor mange ryttere assistenten satte ind. */
export function draftSummary(draft: BulkDraft, entries: SeasonEntry[]): { auto: number; added: number; clear: number; withdraw: number } {
  let auto = 0;
  let clear = 0;
  let withdraw = 0;
  let added = 0;
  for (const [id, kind] of draft.kinds) {
    if (kind === "auto") {
      auto += 1;
      const before = new Set(entries.filter((e) => e.raceId === id).map((e) => e.riderId));
      added += (draft.auto.get(id) ?? []).filter((e) => !before.has(e.riderId)).length;
    } else if (kind === "clear") clear += 1;
    else withdraw += 1;
  }
  return { auto, added, clear, withdraw };
}
