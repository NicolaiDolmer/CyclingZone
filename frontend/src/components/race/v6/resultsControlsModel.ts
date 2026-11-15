// #7860 · Resultater i v6: søgning og "Mit hold" over den fulde resultatliste.
// Ren model (ingen React), så filtreringen kan prøves uden at rendere tabellen.
// Søgningen matcher rytterens navn og holdets navn. Intet nationsfilter (spec S10).

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
    team?: { id?: string | number | null; name?: string | null } | null;
  } | null;
  team?: { id?: string | number | null; name?: string | null } | null;
}

export interface ResultsControlsState {
  query: string;
  mineOnly: boolean;
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

function searchableText(row: ResultsControlsRow): string {
  const riderFull = [row.rider?.firstname, row.rider?.lastname].filter(Boolean).join(" ");
  return normalizeSearchText([
    riderFull,
    row.rider_name,
    row.name,
    row.rider?.team?.name,
    row.team_name,
    row.team?.name,
  ].filter(Boolean).join(" | "));
}

/** Alle ord i søgningen skal findes i rytter- eller holdnavnet (rækkefølge er ligegyldig). */
export function rowMatchesQuery(row: ResultsControlsRow, query: string): boolean {
  const words = normalizeSearchText(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const haystack = searchableText(row);
  return words.every((w) => haystack.includes(w));
}

export function isFiltering(state: ResultsControlsState): boolean {
  return state.mineOnly || normalizeSearchText(state.query) !== "";
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
): T[] {
  const list = rows ? [...rows] : [];
  const mine = state.mineOnly && myTeamId != null ? String(myTeamId) : null;
  if (!mine && !normalizeSearchText(state.query)) return list;
  return list.filter((row) => (mine == null || rowTeamId(row) === mine) && rowMatchesQuery(row, state.query));
}
