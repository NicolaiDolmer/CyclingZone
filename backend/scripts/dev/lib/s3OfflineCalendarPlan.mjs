// #4123 — ÉN fælles offline S3-kalender-genereringssti, delt af CI-invariant-testene,
// den gyldne kalender-snapshot og calendarScorecard4218.mjs's katalog-udvidelse.
//
// HVORFOR DEN FINDES. lib/__fixtures__/racePoolCatalog.prod.json (#4121) er et snapshot
// af race_pool taget FØR database/2026-08-25-4218-katalog-22-nye-loeb.sql blev applyet i
// prod. Genererer man kalenderen mod fixturen ALENE, mangler D3 særligt hårdt: målt
// under dette arbejde faldt division 3 fra 85/93 etaper (prod, med de 22 nye løb) til
// 49/93 (fixture alene) — og fik 13 kalenderdage uden løb, et brud på #4218's
// ejer-låste "løb hver dag"-regel. Det er IKKE en generator-fejl; det er katalog-
// fixturen der er forældet i forhold til prod. calendarScorecard4218.mjs løste det ved
// at lægge de 22 løb oveni IN-MEMORY (se scriptets egen kommentar); denne fil flytter
// den katalog-udvidelse hertil, så CI-invarianttestene (#4123) og scorecardet (#4215)
// deler ÉN definition i stedet for to kopier der kan drifte fra hinanden.
//
// Verificeret mod prod-tallene i docs/CALENDAR_RULES.md §1c/§3 (30/8): med denne
// udvidelse + de kanoniske S3-parametre (first-day 28/8, 31 kalenderdage) giver
// offline-genereringen D1 155 etaper med præcis de samme tre Grand Tours
// (Giro della Penisola / Tour de l'Hexagone / Vuelta Ibérica, alle 6-dages vinduer),
// og D3 84/93 etaper med nul tomme kalenderdage — samme størrelsesorden som de målte
// 85/93 i prod (den sidste etapes forskel er seed-/afrundingsstøj, ikke et brud).
//
// Refs #4123 #4218 #4215 #4121

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildTierMaterializationPlan, TIER_DENSITY } from "../../../lib/tierCalendarMaterializer.js";
import { offlineCalendarFrom } from "./devCalendarArgs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = join(__dirname, "..", "..", "..", "lib", "__fixtures__", "racePoolCatalog.prod.json");

// De 22 løb fra database/2026-08-25-4218-katalog-22-nye-loeb.sql. Anvendt i prod, men
// IKKE en del af lib/__fixtures__/racePoolCatalog.prod.json's snapshot (taget før
// migrationen). Flyttet uændret fra calendarScorecard4218.mjs (#4215) — samme 22 rækker,
// samme rækkefølge, samme felter.
export const S3_CATALOG_ADDITIONS = [
  ["cz4215-pro-alentejo",  "Volta ao Alentejo",            "ProSeries", "stage_race", 4, "sprinters_week",  "3/4 - 6/4"],
  ["cz4215-pro-limousin",  "Tour du Limousin Nouveau",     "ProSeries", "stage_race", 4, "hilly_tour",      "18/8 - 21/8"],
  ["cz4215-pro-lucania",   "Giro della Lucania",           "ProSeries", "stage_race", 5, "summit_tour",     "6/6 - 10/6"],
  ["cz4215-pro-rioja",     "Vuelta a La Rioja Nueva",      "ProSeries", "stage_race", 4, "balanced_week",   "21/4 - 24/4"],
  ["cz4215-pro-silesie",   "Tour de Silésie",              "ProSeries", "stage_race", 3, "mountain_tour",   "12/7 - 14/7"],
  ["cz4215-pro-zeeland",   "Ronde van Zeeland",            "ProSeries", "stage_race", 3, "cobbled_tour",    "8/5 - 10/5"],
  ["cz4215-pro-irpinia",   "Giro dell'Irpinia",            "ProSeries", "stage_race", 5, "hilly_tour",      "1/6 - 5/6"],
  ["cz4215-pro-yonne",     "Tour de l'Yonne",              "ProSeries", "stage_race", 5, "balanced_week",   "14/8 - 18/8"],
  ["cz4215-c1-fourmies",   "Grand Prix de Fourmies Neuf",  "Class1", "single",     1, "flat_sprint",     "13/9"],
  ["cz4215-c1-bretagne",   "Tour de Bretagne Sud",         "Class1", "stage_race", 3, "cobbled_tour",    "28/4 - 30/4"],
  ["cz4215-c1-euganei",    "Coppa dei Colli Euganei",      "Class1", "single",     1, "hilly_classic",   "11/5"],
  ["cz4215-c1-zamora",     "Gran Premio de Zamora",        "Class1", "single",     1, "itt_classic",     "27/6"],
  ["cz4215-c1-drenthe",    "Ronde van Drenthe Nieuw",      "Class1", "single",     1, "cobbled_classic", "15/3"],
  ["cz4215-c1-sibillini",  "Giro dei Monti Sibillini",     "Class1", "stage_race", 4, "hilly_tour",      "2/7 - 5/7"],
  ["cz4215-c1-castelli",   "Trofeo dei Castelli Romani",   "Class1", "single",     1, "hilly_classic",   "6/9"],
  ["cz4215-c1-valladolid", "Gran Premio de Valladolid",    "Class1", "single",     1, "flat_sprint",     "12/6"],
  ["cz4215-c2-vosges",     "Circuit des Vosges",           "Class2", "single",     1, "hilly_classic","23/5"],
  ["cz4215-c2-valdichiana","Trofeo Val di Chiana",         "Class2", "single",     1, "hilly_classic",   "7/3"],
  ["cz4215-c2-segovia",    "Vuelta a Segovia Menor",       "Class2", "stage_race", 3, "hilly_tour",      "16/9 - 18/9"],
  ["cz4215-c2-waasland",   "Omloop van het Waasland",      "Class2", "single",     1, "flat_sprint",     "4/4"],
  ["cz4215-c2-morbihan",   "Grand Prix du Morbihan Mineur","Class2", "single",     1, "puncheur",        "30/8"],
  ["cz4215-c2-perigord",   "Tour du Périgord",             "Class2", "stage_race", 2, "hilly_tour",      "20/6 - 21/6"],
].map(([external_id, name, race_class, race_type, stages, terrain_archetype, date_text]) => ({
  id: external_id, external_id, name, race_class, race_type, stages, terrain_archetype, date_text,
}));

/**
 * Lægger S3_CATALOG_ADDITIONS oveni et base-katalog (typisk fixturens `catalog`).
 * Rapporterer navnekollisioner i stedet for at fejle, så kaldere selv kan afgøre om
 * det er en test-fejl (uventet dublet) eller forventet (samme løb tilføjet to gange).
 */
export function augmentWithS3Additions(baseCatalog) {
  const eksisterende = new Set(baseCatalog.map((c) => c.name));
  const kollisioner = S3_CATALOG_ADDITIONS.filter((n) => eksisterende.has(n.name)).map((n) => n.name);
  return { catalog: [...baseCatalog, ...S3_CATALOG_ADDITIONS], kollisioner };
}

// Vinduet for den offline plan. Ejer-beslutning 3/9 (#4270): 28 kalenderdage, saesonens
// eget S4-vindue (man 28/9 -> soen 25/10).
//
// HVORFOR DET FLYTTEDE FRA S3's 31: D4's tae­thed gik 2 -> 3 samme dag, saa D4's kvote i et
// 31-dages vindue ville vaere 3 x 31 = 93 mod et katalog-loft paa 96 i D4's klasse-vindue.
// Planen kunne ikke fyldes, og fixturen ville rapportere tomme kalenderdage der KUN findes
// fordi vi holdt et gammelt vindue fast. Se docs/CALENDAR_RULES.md §1 og §5b.
export const OFFLINE_REAL_DAYS = 28;
/** @deprecated brug OFFLINE_REAL_DAYS - navnet er en rest fra da vinduet var S3's. */
export const S3_REAL_DAYS = OFFLINE_REAL_DAYS;

/**
 * Bygger den fulde offline S3-kalenderplan: fixture + katalog-udvidelse + de
 * kanoniske S3-parametre (first-day, 31 dage, kvoter = density × 31). Deterministisk —
 * ingen DB, intet ur, ingen tilfældighed ud over `baseSeed`.
 *
 * @param {{baseSeed?: number}} [args]
 * @returns {{tierPlans: object[], firstDay: string, lastDay: string, realDays: number,
 *   quotas: Record<number, number>, kollisioner: string[]}}
 */
export function buildS3OfflineCalendarPlan({ baseSeed = 1 } = {}) {
  const { pools, catalog: baseCatalog } = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const { catalog, kollisioner } = augmentWithS3Additions(baseCatalog);
  const { from, firstDay } = offlineCalendarFrom([]);
  const lastDay = new Date(
    Date.parse(`${firstDay}T00:00:00Z`) + (OFFLINE_REAL_DAYS - 1) * 86_400_000
  ).toISOString().slice(0, 10);
  const quotas = Object.fromEntries(Object.entries(TIER_DENSITY).map(([t, d]) => [t, d * OFFLINE_REAL_DAYS]));
  const { tierPlans } = buildTierMaterializationPlan({
    pools, catalog, from, realDays: OFFLINE_REAL_DAYS, quotas, baseSeed,
  });
  return { tierPlans, firstDay, lastDay, realDays: OFFLINE_REAL_DAYS, quotas, kollisioner };
}
