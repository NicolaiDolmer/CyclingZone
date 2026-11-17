// #7860 · Resultater i v6: søgning og "Mit hold" over den fulde resultatliste.
// Ren model (ingen React), så filtreringen kan prøves uden at rendere tabellen.
// Søgningen matcher rytterens navn og holdets navn. #7862 (ejer 16/11): også nationen, og et nationsfilter.

/** Den del af en race_results- eller DNF-række modellen læser. */
export interface ResultsControlsRow {
  rider_id?: string | null;
  rider_name?: string | null;
  name?: string | null;
  team_id?: string | number | null;
  team_name?: string | null;
  rider?: {
    firstname?: string | null;
    lastname?: string | null;
    nationality_code?: string | null;
    team?: { id?: string | number | null; name?: string | null } | null;
  } | null;
  team?: { id?: string | number | null; name?: string | null } | null;
}

export interface ResultsControlsState {
  query: string;
  mineOnly: boolean;
  /** #7862: "all"/udeladt = alle nationer, ellers en landekode. */
  nation?: string;
}

/** #7862: navnene en nation kan søges på (fx brugerens sprog og engelsk). */
export type NationNames = (code: string) => string[];

/** #7862: rytterens landekode med små bogstaver, eller null (holdrækker har ingen). */
export function rowNation(row: ResultsControlsRow): string | null {
  const code = row.rider?.nationality_code;
  return code ? String(code).trim().toLowerCase() || null : null;
}

function nationChosen(state: ResultsControlsState): string | null {
  return state.nation && state.nation !== "all" ? state.nation.toLowerCase() : null;
}

export const EMPTY_RESULTS_CONTROLS: ResultsControlsState = Object.freeze({ query: "", mineOnly: false });

/** Små bogstaver uden accenter, så "Pogacar" finder "Pogačar" og "zoe" finder "Zoë". */
export function normalizeSearchText(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ø/gi, "o")
    .replace(/æ/gi, "ae")
    .replace(/å/gi, "a")
    .replace(/ß/g, "ss")
    .replace(/ł/gi, "l")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Holdets id på en række: holdklassementets egen team_id, ellers rytterens hold. */
export function rowTeamId(row: ResultsControlsRow): string | null {
  const id = row.team_id ?? row.rider?.team?.id ?? row.team?.id ?? null;
  return id == null ? null : String(id);
}

function searchableText(row: ResultsControlsRow, nationNames?: NationNames): string {
  const riderFull = [row.rider?.firstname, row.rider?.lastname].filter(Boolean).join(" ");
  const nation = rowNation(row);
  return normalizeSearchText([
    nation,
    ...(nation && nationNames ? nationNames(nation) : []),
    riderFull,
    row.rider_name,
    row.name,
    row.rider?.team?.name,
    row.team_name,
    row.team?.name,
  ].filter(Boolean).join(" | "));
}

/** Alle ord i søgningen skal findes i rytter- eller holdnavnet (rækkefølge er ligegyldig). */
export function rowMatchesQuery(row: ResultsControlsRow, query: string, nationNames?: NationNames): boolean {
  const words = normalizeSearchText(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const haystack = searchableText(row, nationNames);
  return words.every((w) => haystack.includes(w));
}

export function isFiltering(state: ResultsControlsState): boolean {
  return state.mineOnly || normalizeSearchText(state.query) !== "" || nationChosen(state) !== null;
}

/**
 * #7865: "Mit hold" er ÉT valg under v6. Holdvælgerens "My team" og knappen
 * "My team" viser altid det samme, fordi knappen læser og skriver holdvælgerens
 * værdi ("all" | "mine" | hold-id). Knappen slået til = "mine"; slået fra = alle hold.
 */
export function mineOnlyFromTeamFilter(teamFilter: string | null | undefined): boolean {
  return teamFilter === "mine";
}

export function teamFilterAfterMineToggle(teamFilter: string | null | undefined, on: boolean): string {
  if (on) return "mine";
  return teamFilter === "mine" ? "all" : (teamFilter ?? "all");
}

/**
 * Kontrollernes tilstand, når "Mit hold" ejes udefra (holdvælgeren). Knappen viser det
 * delte valg; selve filtreringen på hold sker allerede i holdvælgeren, så tabellens egen
 * filtrering er kun søgningen. Uden delt valg: tabellens egen tilstand, som før.
 */
export function sharedMineControls(
  local: ResultsControlsState,
  shared: { on: boolean; set: (on: boolean) => void } | null | undefined,
): { shown: ResultsControlsState; filter: ResultsControlsState; change: (next: ResultsControlsState) => ResultsControlsState } {
  if (!shared) return { shown: local, filter: local, change: (next) => next };
  return {
    shown: { ...local, mineOnly: shared.on },
    filter: { ...local, mineOnly: false },
    change: (next) => {
      if (next.mineOnly !== shared.on) shared.set(next.mineOnly);
      return { ...next, mineOnly: false };
    },
  };
}

/**
 * Filtrér rækkerne. "Mit hold" uden et eget hold filtrerer intet (knappen vises ikke da).
 * Rækkefølgen bevares, så placeringerne står som i motorens liste.
 */
export function filterResultRows<T extends ResultsControlsRow>(
  rows: readonly T[] | null | undefined,
  state: ResultsControlsState,
  myTeamId: string | number | null | undefined,
  nationNames?: NationNames,
): T[] {
  const list = rows ? [...rows] : [];
  const mine = state.mineOnly && myTeamId != null ? String(myTeamId) : null;
  const nation = nationChosen(state);
  if (!mine && !nation && !normalizeSearchText(state.query)) return list;
  return list.filter((row) => (mine == null || rowTeamId(row) === mine) && (nation == null || rowNation(row) === nation) && rowMatchesQuery(row, state.query, nationNames));
}

/** #7862: nationerne i listen til nationsvælgeren (kode og vist navn), sorteret efter navnet. */
export function resultNations(rows: readonly ResultsControlsRow[] | null | undefined, nameOf: (code: string) => string): Array<{ code: string; name: string }> {
  const codes = new Set<string>();
  for (const row of rows || []) { const c = rowNation(row); if (c) codes.add(c); }
  return [...codes].map((code) => ({ code, name: nameOf(code) || code.toUpperCase() })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * #7862: det nationsvalg der gælder (og vises). Står vælgeren ikke (under to nationer), eller
 * er den valgte nation ikke længere i listen (fx efter et skift til Mit hold), gælder "all",
 * så et usynligt filter aldrig tømmer tabellen.
 */
export function effectiveNation(nation: string | null | undefined, nations: ReadonlyArray<{ code: string }>): string {
  const n = nation ?? "all";
  if (nations.length < 2 || n === "all") return "all";
  return nations.some((x) => x.code === n) ? n : "all";
}
