// trainingSort — delt standard-sortering for ryttere paa traeningssiderne (#5682).
//
// BAGGRUND: Traeningsrapporten (TrainingHistory) viste ryttere i den
// raekkefoelge de laa i i den gemte rapport (genererings-/DB-raekkefoelge),
// mens Daglig traening (TrainingPage) viser dem i den raekkefoelge riders-
// arrayet ankommer i naar ingen kolonne-sortering er aktiv — hvilket i praksis
// er `.order("lastname")` fra Supabase-forespoergslen. De to flader viste altsaa
// hver sin raekkefoelge for de SAMME ryttere. Denne fil samler standard-
// sorteringen eet sted, saa begge flader bruger praecis den samme funktion.
//
// VERIFICERET (ikke gaettet): Daglig traenings rytter-sortering
// (`rosterSort` i TrainingPage.jsx, useSortState fra useTableSort.js) har
// INGEN default sort-noegle (`initialSort` er ikke sat -> sort er `null` ved
// mount, og nulstilles hver gang siden genindlaeses - ingen persistens).
// Naar `sort` er `null`, returnerer `sortRows` rows UAENDRET, saa den synlige
// standard-raekkefoelge er alene query-raekkefoelgen (lastname, stigende).
// "My Team"s egen default (DEFAULT_FILTERS i RiderFilters.jsx: sort "value"
// desc) er en ANDEN sides standard og gaelder ikke her — antagelsen i
// issue-teksten om "samme som My Team: rating faldende" holder IKKE ved
// efterproevning og er derfor ikke brugt.
//
// KENDT BEGRAENSNING (dokumenteret, ikke gemt): Traeningsrapportens rytter-
// raekker (training_day_runs.report.riders, bygget i
// backend/lib/dailyTrainingEngine.js) gemmer KUN eet samlet navnefelt
// (`name: "${firstname} ${lastname}".trim()`), ikke separate firstname/
// lastname-felter. trainingReportRowName approksimerer derfor "efternavn
// foerst" ved at bruge det SIDSTE ord i navnet som efternavns-noegle. For
// ryttere med etordsefternavn matcher det Daglig traenings PRAECISE
// lastname-felt 1:1; for flerords-efternavne (fx "van Aert", "van der Poel")
// kan raekkefoelgen afvige en anelse, fordi kun sidste-ordet indgaar i
// noeglen. En fuld rettelse kraever at backend ogsaa persisterer lastname i
// rapport-raekken — uden for denne lanes ejerskab (frontend-only, #5682).
// Den hidtidige adfaerd (reelt tilfaeldig DB-raekkefoelge) er under alle
// omstaendigheder rettet.
//
// Ingen React, ingen DOM: rene funktioner, testes isoleret med `node --test`.

import { sortRows } from "./useTableSort.js";

export type TrainingRiderLike = {
  id?: string | number;
  firstname?: string | null;
  lastname?: string | null;
  [key: string]: unknown;
};

export type TrainingReportRowLike = {
  rider_id?: string | number;
  name?: string | null;
  [key: string]: unknown;
};

/**
 * Navn-noeglen for ryttere med separate firstname/lastname-felter (Daglig
 * traenings roster-raekker): "efternavn fornavn", trimmet. Dette ER
 * standard-sorteringen naar ingen anden kolonne-sortering er aktiv (se
 * fil-kommentaren ovenfor).
 */
export function trainingRiderName(rider: TrainingRiderLike): string {
  return `${rider.lastname ?? ""} ${rider.firstname ?? ""}`.trim();
}

/**
 * Navn-noeglen for traeningsrapportens raekker, som kun har eet samlet
 * `name`-felt ("fornavn efternavn"). Approksimerer "efternavn foerst" ved at
 * flytte det sidste ord forrest — se KENDT BEGRAENSNING ovenfor for hvornaar
 * dette afviger fra det praecise lastname-felt.
 */
export function trainingReportRowName(row: TrainingReportRowLike): string {
  const full = String(row?.name ?? "").trim();
  if (!full) return "";
  const parts = full.split(/\s+/);
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1).join(" ");
  return `${last} ${rest}`;
}

/**
 * Delt sortering for ryttere i traenings-kontekst: Daglig traening
 * (rosteret + mobil-tabellen, samme `rosterSort`-state) og Traeningsrapporten
 * skal vise PRAECIS samme raekkefoelge naar ingen sort-noegle er valgt.
 *
 * @param riders     Ryttere at sortere. Muteres aldrig (sortRows kopierer).
 * @param sort       Aktiv sort-noegle (fx "score"/"age"/"form"/...), eller
 *                   null/undefined for standard (navn).
 * @param sortDir    "asc" | "desc" — ignoreres for standard-sorteringen
 *                   (navn sorterer altid A->AA), samme adfaerd som i dag.
 * @param accessors  Sort-noegler, MINDST "name" boer gives af kaldestedet
 *                   (trainingRiderName for TrainingPage, trainingReportRowName
 *                   for TrainingHistory — de to rytter-former deler ikke felt-
 *                   navne, se KENDT BEGRAENSNING). Mangler "name", falder
 *                   funktionen tilbage paa trainingRiderName.
 */
export function sortTrainingRiders<T>(
  riders: T[],
  sort?: string | null,
  sortDir: "asc" | "desc" = "asc",
  accessors: Record<string, (row: T) => unknown> = {},
): T[] {
  const key = sort || "name";
  const nameAccessor = (accessors.name ?? trainingRiderName) as (row: T) => unknown;
  if (key === "name") {
    return sortRows(riders, nameAccessor, "asc");
  }
  const accessor = accessors[key];
  if (typeof accessor !== "function") {
    // Ukendt noegle: fald tilbage paa standarden i stedet for at vise en
    // tilfaeldig raekkefoelge (samme "harmloest ukendt" som sortRows selv).
    return sortRows(riders, nameAccessor, "asc");
  }
  return sortRows(riders, accessor, sortDir);
}
