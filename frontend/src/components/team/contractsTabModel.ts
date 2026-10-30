// #6855: ren model bag Kontrakter-fanen (ContractsTab.tsx). Ingen JSX, så
// node --test kan køre den direkte (contractsTabModel.test.ts).
//
// Fanen regner INGEN nye tal ud. Løn nu, ny løn, hvor mange sæsoner hver
// rytter kan forlænges og den aktuelle sæson kommer alle fra backendens quote
// (POST /api/riders/extend-contracts/quote, contractBatchExtension.js). Her
// bor kun gruppering, sortering, URL-parametre og summering af de tal.

export const MAX_SEASONS_AHEAD = 3; // spejler CONTRACT.MAX_EXTENSION_SEASONS_AHEAD (backend afgør)
// #7138: loftet er indeværende sæson + 1 (gulv S6), så højst 2 i ét hug.
export const SEASON_CHOICES = [1, 2] as const;

export type ContractsSortKey = "name" | "ovr" | "potential" | "age" | "contract" | "salary" | "value";
export type SortDir = "asc" | "desc";
export interface SortState { sort: ContractsSortKey; dir: SortDir }

export const CONTRACTS_SORT_KEYS: readonly ContractsSortKey[] = ["name", "ovr", "potential", "age", "contract", "salary", "value"];
export const DEFAULT_CONTRACTS_SORT: SortState = { sort: "ovr", dir: "desc" };

// URL-parametre. Fanen selv står i `tab`; truppens sortering i `sort`/`dir`
// (TeamPage), Kontrakter-fanens i `csort`/`cdir`, så de to aldrig overskriver
// hinanden. Ligger sorteringen i URL'en, overlever den et klik ind på en
// rytter og tilbage (browserens historik genskaber URL'en).
export const CONTRACTS_SORT_PARAM = "csort";
export const CONTRACTS_DIR_PARAM = "cdir";

export interface ContractRow {
  id: string;
  squad?: "senior" | "u23" | "junior" | "academy";
  name: string;
  ovr: number | null;
  potential: number | null;
  age: number | null;
  endSeason: number | null;
  salary: number;
  newSalary: number | null;
  value: number | null;
  maxSeasons: number;
}

type ParamsLike = { get(name: string): string | null };

export function readSortParams<K extends string>(
  params: ParamsLike,
  sortParam: string,
  dirParam: string,
  allowed: readonly K[],
  fallback: { sort: K; dir: SortDir },
): { sort: K; dir: SortDir } {
  const rawSort = params.get(sortParam);
  const rawDir = params.get(dirParam);
  const sort = (allowed as readonly string[]).includes(rawSort ?? "") ? (rawSort as K) : fallback.sort;
  const dir: SortDir = rawDir === "asc" || rawDir === "desc" ? rawDir : (sort === fallback.sort ? fallback.dir : defaultDir(sort));
  return { sort, dir };
}

/** Ny URLSearchParams med sorteringen sat; alle andre parametre (fx `tab`) bevares. */
export function writeSortParams(
  params: URLSearchParams,
  sortParam: string,
  dirParam: string,
  state: { sort: string; dir: SortDir },
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(sortParam, state.sort);
  next.set(dirParam, state.dir);
  return next;
}

export function readContractsSort(params: ParamsLike): SortState {
  return readSortParams(params, CONTRACTS_SORT_PARAM, CONTRACTS_DIR_PARAM, CONTRACTS_SORT_KEYS, DEFAULT_CONTRACTS_SORT);
}

// Truplistens sortering (TeamPage, cycleSortState) i `sort`/`dir`. Nøglerne er
// truppens egne kolonne-sortKeys; en ukendt/forvansket værdi giver null, så
// truppen falder tilbage til sin standard-sortering.
export const SQUAD_SORT_PARAM = "sort";
export const SQUAD_DIR_PARAM = "dir";
const SQUAD_SORT_KEY_RE = /^[A-Za-z_]{1,40}$/;

export function readSquadSort(params: ParamsLike): { sort: string; sort_dir: SortDir } | null {
  const sort = params.get(SQUAD_SORT_PARAM);
  const dir = params.get(SQUAD_DIR_PARAM);
  if (!sort || !SQUAD_SORT_KEY_RE.test(sort)) return null;
  if (dir !== "asc" && dir !== "desc") return null;
  return { sort, sort_dir: dir };
}

function defaultDir(key: string): SortDir {
  return key === "name" || key === "contract" ? "asc" : "desc";
}

/** Samme cyklus som de øvrige rytter-tabeller: samme kolonne vender retning, ny kolonne starter i sin naturlige retning. */
export function cycleSort(current: SortState, key: ContractsSortKey): SortState {
  if (current.sort === key) return { sort: key, dir: current.dir === "desc" ? "asc" : "desc" };
  return { sort: key, dir: defaultDir(key) };
}

function sortValue(row: ContractRow, key: ContractsSortKey): number | string | null {
  switch (key) {
    case "name": return row.name.toLocaleLowerCase();
    case "ovr": return row.ovr;
    case "potential": return row.potential;
    case "age": return row.age;
    case "contract": return row.endSeason;
    case "salary": return row.salary;
    case "value": return row.value;
    default: return null;
  }
}

/** Komparator; manglende værdier står altid sidst, uanset retning. Navn bryder uafgjort. */
export function compareRows(a: ContractRow, b: ContractRow, state: SortState): number {
  const va = sortValue(a, state.sort);
  const vb = sortValue(b, state.sort);
  const aMissing = va == null || (typeof va === "number" && !Number.isFinite(va));
  const bMissing = vb == null || (typeof vb === "number" && !Number.isFinite(vb));
  if (aMissing !== bMissing) return aMissing ? 1 : -1;
  let cmp = 0;
  if (!aMissing && !bMissing) {
    cmp = typeof va === "string" && typeof vb === "string" ? va.localeCompare(vb) : Number(va) - Number(vb);
    if (state.dir === "desc") cmp = -cmp;
  }
  return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
}

export type ContractGroupKind = "expiring" | "season" | "atCap";
export interface ContractGroup { key: string; kind: ContractGroupKind; season: number | null; rows: ContractRow[]; squad?: ContractRow["squad"] }

/**
 * Gruppér efter udløb (ejer-design 18/10): "Udløber denne sæson" øverst (inkl.
 * udløbne/kontraktløse), derefter én gruppe pr. udløbssæson stigende, og
 * ryttere ved loftet (ingen sæsoner tilbage) til sidst. Sorteringen gælder
 * inden for hver gruppe.
 */
export function groupByExpiry(rows: ContractRow[], currentSeason: number, sort: SortState): ContractGroup[] {
  const expiring: ContractRow[] = [];
  const atCap: ContractRow[] = [];
  const bySeason = new Map<number, ContractRow[]>();
  for (const row of rows) {
    if (row.maxSeasons <= 0) atCap.push(row);
    else if (row.endSeason == null || row.endSeason <= currentSeason) expiring.push(row);
    else {
      const list = bySeason.get(row.endSeason) ?? [];
      list.push(row);
      bySeason.set(row.endSeason, list);
    }
  }
  const cmp = (a: ContractRow, b: ContractRow) => compareRows(a, b, sort);
  const groups: ContractGroup[] = [];
  if (expiring.length) groups.push({ key: "expiring", kind: "expiring", season: null, rows: expiring.sort(cmp) });
  for (const season of [...bySeason.keys()].sort((a, b) => a - b)) {
    groups.push({ key: `s${season}`, kind: "season", season, rows: (bySeason.get(season) ?? []).sort(cmp) });
  }
  if (atCap.length) groups.push({ key: "atCap", kind: "atCap", season: null, rows: atCap.sort(cmp) });
  return groups;
}

/** Keep expiry urgency first, with a separate selectable group for each squad. */
export function groupBySquadAndExpiry(rows: ContractRow[], currentSeason: number, sort: SortState): ContractGroup[] {
  return groupByExpiry(rows, currentSeason, sort).flatMap((group) =>
    (["senior", "u23", "junior", "academy"] as const).flatMap((squad) => {
      const members = group.rows.filter((r) => (r.squad ?? "senior") === squad);
      return members.length ? [{ ...group, key: `${group.key}-${squad}`, squad, rows: members }] : [];
    }),
  );
}

/** Hvor mange sæsoner rytteren faktisk får: det valgte, men aldrig over hans loft. */
export function effectiveSeasons(requested: number, maxSeasons: number): number {
  return Math.max(0, Math.min(requested, maxSeasons));
}

/** Valgmuligheder pr. rytter: 1..loft. Loftet markeres "(maks)" når det er under 3. */
export function seasonOptions(maxSeasons: number): Array<{ value: number; atMax: boolean }> {
  const top = Math.min(maxSeasons, MAX_SEASONS_AHEAD);
  const out: Array<{ value: number; atMax: boolean }> = [];
  for (let n = 1; n <= top; n += 1) out.push({ value: n, atMax: n === top && top < MAX_SEASONS_AHEAD });
  return out;
}

export interface Selection { [riderId: string]: number | null } // null = følger det fælles valg

/** Det antal sæsoner der bedes om for rytteren (egen rettelse, ellers det fælles valg). */
export function requestedSeasons(selection: Selection, riderId: string, common: number): number {
  const own = selection[riderId];
  return own == null ? common : own;
}

/** Request-kroppen til quote/forlæng. Backenden clamper selv til loftet og melder `capped`. */
export function buildItems(selection: Selection, common: number): Array<{ riderId: string; seasons: number }> {
  return Object.keys(selection).map((riderId) => ({ riderId, seasons: requestedSeasons(selection, riderId, common) }));
}

/**
 * Bundlinjen: antal valgte + lønsum-ændring pr. sæson. Lønnen efter en
 * forlængelse afhænger ikke af antallet af sæsoner (samme genforhandling hver
 * gang), så summen er den samme uanset 1, 2 eller 3; tallene er quotens.
 */
export function selectionTotals(rows: ContractRow[], selection: Selection): { count: number; salaryDelta: number } {
  let count = 0;
  let salaryDelta = 0;
  for (const row of rows) {
    if (!(row.id in selection)) continue;
    count += 1;
    salaryDelta += Number(row.newSalary ?? row.salary) - Number(row.salary);
  }
  return { count, salaryDelta };
}
