// #4123 — ÉN fælles offline kalender-genereringssti, delt af CI-invariant-testene, den
// gyldne kalender-snapshot og calendarScorecard4218.mjs.
//
// HVORFOR DEN FINDES. lib/__fixtures__/racePoolCatalog.prod.json (#4121) er et snapshot af
// prods race_pool. Driver snapshottet fra prod, tester CI en kalender der ikke længere
// findes — det var præcis den fejl der gjorde at fixturen indtil 3/9 manglede de 22 løb
// fra database/2026-08-25-4218-katalog-22-nye-loeb.sql. Filen bar dem derfor som en
// IN-MEMORY katalog-udvidelse (S3_CATALOG_ADDITIONS), så CI-testene og scorecardet delte
// ÉN definition i stedet for to kopier der kunne drifte.
//
// UDVIDELSEN ER FJERNET 3/9 (#4203). Fixturen er genopfrisket fra prod med
// scripts/dev/dumpRacePoolFixture.mjs (214 aktive løb mod 140 før), og de 22 løb ligger nu
// i selve snapshottet sammen med #4708's katalog-udvidelse. At lægge dem oveni IGEN gav 22
// navnekollisioner og en kalender bygget af dubletter. dumpRacePoolFixture.mjs's egen
// header udpegede netop dette som det manuelle skridt der hører til en fixture-refresh.
//
// Konsekvensen for kalderne: `kollisioner` er nu altid tom fra denne fil. Den bliver ikke
// meningsløs af det — calendarScorecard4218.mjs's DB-sti og s4CatalogDryRun.mjs måler
// stadig kollisioner mod ægte katalog-tilføjelser.
//
// Refs #4123 #4218 #4215 #4121 #4203 #4708

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { buildTierMaterializationPlan, TIER_DENSITY } from "../../../lib/tierCalendarMaterializer.js";
import { offlineCalendarFrom } from "./devCalendarArgs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = join(__dirname, "..", "..", "..", "lib", "__fixtures__", "racePoolCatalog.prod.json");

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
 * Bygger den fulde offline kalenderplan: fixturens katalog + de kanoniske parametre
 * (first-day, OFFLINE_REAL_DAYS dage, kvoter = density × dage). Deterministisk — ingen
 * DB, intet ur, ingen tilfældighed ud over `baseSeed`.
 *
 * @param {{baseSeed?: number}} [args]
 * @returns {{tierPlans: object[], firstDay: string, lastDay: string, realDays: number,
 *   quotas: Record<number, number>, kollisioner: string[]}}
 */
export function buildS3OfflineCalendarPlan({ baseSeed = 1 } = {}) {
  const { pools, catalog } = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  // Ingen katalog-udvidelse laengere: fixturen ER prods katalog (se header).
  const kollisioner = [];
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
