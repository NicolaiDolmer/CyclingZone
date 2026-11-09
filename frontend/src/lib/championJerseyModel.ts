// #7824 · Mestertrøjernes model: rækkefølgen af titlerne og hvilken trøje en
// titel får. Ren, uden React og uden klient, så node --test kan læse den.
//
// Titlerne regnes af backenden (backend/lib/championTitles7824.js) og ligger i
// rider_champion_titles, én række pr. titel og område pr. sæson.

export const CHAMPION_JERSEYS_FLAG_KEY = "champion_jerseys_7824";

export type ChampionTitleKind = "world" | "u23_world" | "continent" | "national";

export interface ChampionTitleRow {
  rider_id: string;
  title: ChampionTitleKind;
  /** "" for verden og U23, countries.continent for kontinent, iso2 for national. */
  scope: string;
  season_number: number;
}

/** Fra højeste til laveste. Samme rækkefølge som backendens CHAMPION_TITLE_ORDER. */
export const CHAMPION_TITLE_ORDER: readonly ChampionTitleKind[] = ["world", "u23_world", "continent", "national"];

export function isChampionTitleRow(row: unknown): row is ChampionTitleRow {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return typeof r.rider_id === "string"
    && typeof r.scope === "string"
    && typeof r.title === "string"
    && (CHAMPION_TITLE_ORDER as readonly string[]).includes(r.title);
}

/** En rytters titler fra højeste til laveste. Profilen viser dem alle. */
export function sortTitles(rows: readonly ChampionTitleRow[]): ChampionTitleRow[] {
  return [...rows].sort((a, b) => CHAMPION_TITLE_ORDER.indexOf(a.title) - CHAMPION_TITLE_ORDER.indexOf(b.title));
}

/** Den højeste titel. Tabeller viser kun den. */
export function highestTitle(rows: readonly ChampionTitleRow[] | null | undefined): ChampionTitleRow | null {
  if (!rows || rows.length === 0) return null;
  return sortTitles(rows)[0] ?? null;
}

/** Rækkerne fra den nyeste sæson, grupperet pr. rytter og sorteret. */
export function groupLatestSeason(rows: readonly unknown[]): Map<string, ChampionTitleRow[]> {
  const valid = rows.filter(isChampionTitleRow);
  let latest = -Infinity;
  for (const r of valid) if (Number.isFinite(r.season_number) && r.season_number > latest) latest = r.season_number;
  const out = new Map<string, ChampionTitleRow[]>();
  for (const r of valid) {
    if (r.season_number !== latest) continue;
    const list = out.get(r.rider_id) ?? [];
    list.push(r);
    out.set(r.rider_id, list);
  }
  for (const [id, list] of out) out.set(id, sortTitles(list));
  return out;
}

// ── Trøjerne ─────────────────────────────────────────────────────────────────
// Egne trøjer, ikke UCI's: ingen regnbuebånd (UCI har dem registreret som
// varemærke). Farverne er trøjens identitet og skifter ikke med tema (TASTE P7-
// undtagelsen). Kontinenttrøjerne er én stil: ensfarvet trøje med tre prikker i
// en trekant, store nok til at kunne ses ved 16 px.

export type ContinentKey = "Europe" | "Asia" | "Americas" | "Africa" | "Oceania";

export interface ContinentJerseySpec {
  body: string;
  dots: string;
}

export const CONTINENT_JERSEYS: Readonly<Record<ContinentKey, ContinentJerseySpec>> = {
  Europe: { body: "rgb(0 61 165)", dots: "rgb(255 204 0)" },
  Asia: { body: "rgb(200 32 47)", dots: "rgb(255 204 0)" },
  Americas: { body: "rgb(232 108 30)", dots: "rgb(255 255 255)" },
  Africa: { body: "rgb(20 132 70)", dots: "rgb(255 204 0)" },
  Oceania: { body: "rgb(0 133 140)", dots: "rgb(255 255 255)" },
};

export function continentJersey(scope: string): ContinentJerseySpec | null {
  return (CONTINENT_JERSEYS as Record<string, ContinentJerseySpec>)[scope] ?? null;
}

/** i18n-nøglen for et kontinents mestertitel, eller null for et ukendt kontinent. */
export function continentKey(scope: string): string | null {
  return continentJersey(scope) ? scope.toLowerCase() : null;
}

/** iso2 som flag-icons forstår det, eller null. */
export function nationCode(scope: string): string | null {
  const code = scope.trim().toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : null;
}
