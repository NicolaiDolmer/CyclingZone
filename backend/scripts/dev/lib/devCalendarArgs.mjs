// #4239 — fælles `--first-day`/`--now`-parsing for kalender-dev-scriptene.
//
// Baggrund: fire dev-scripts hardkodede `firstRaceDate: "2026-08-25"` uden at sende
// `now`. resolveCalendarFrom afviser (helt korrekt) en første løbsdag der ikke er
// strengt i fremtiden, så alle fire døde på selve datoen 25/8 — netop som kalender-
// fejlsøgningen havde brug for dem. Samme fejlklasse som #4222.
//
// At rykke datoen frem løser ingenting; det udskyder bare fejlen til en ny dato.
// Løsningen er todelt, og delingen er bevidst:
//
//   OFFLINE-scripts (fixture-baserede, rører ingen database) fryser BÅDE first-day
//   og `now`. De skal give præcis samme resultat i dag og om et år — ellers kan en
//   gylden kalender-diff ikke bruges som sammenligningsgrundlag (#4123). En frossen
//   `now` er ufarlig her, fordi der ikke skrives noget nogen steder.
//
//   PROD-scripts sender IKKE `now`. Dér er guarden i resolveCalendarFrom et ægte
//   værn — det er den der forhindrer 27/6-blitzen i at gentage sig — og at fryse
//   tiden ville slå værnet fra på præcis den sti hvor det betyder noget. De får
//   kun et overstyrbart `--first-day`.

import { resolveCalendarFrom } from "../../../lib/calendarStartDate.js";

// Ejer-beslutning 25/8 (#4218): sæson 3's første løbsdag er fredag 28/8.
export const S3_FIRST_RACE_DAY = "2026-08-28";

// Frossen "i dag" for de offline scripts. Skal være strengt FØR S3_FIRST_RACE_DAY,
// ellers kaster guarden. Ændres kun sammen med S3_FIRST_RACE_DAY.
export const FROZEN_NOW = "2026-08-25";

// Accepterer både `--first-day=X` og `--first-day X`, så scripts der før brugte det
// ene mønster (regenSeason3Calendar) og det andet (calendarScorecard4218) opfører sig ens.
export function arg(argv, name, fallback) {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  return fallback;
}

// Offline/fixture-sti: tidsuafhængig. Kan ikke rådne, fordi `now` også er injiceret.
export function offlineCalendarFrom(argv = process.argv.slice(2)) {
  const firstDay = arg(argv, "first-day", S3_FIRST_RACE_DAY);
  const nowDay = arg(argv, "now", FROZEN_NOW);
  const now = new Date(`${nowDay}T12:00:00Z`);
  return { from: resolveCalendarFrom({ firstRaceDate: firstDay, now }), firstDay, nowDay };
}

// Prod-sti: ægte `now`, så anti-blitz-guarden er i kraft. Kaster bevidst hvis
// `--first-day` er passeret — dét ER det rigtige svar, når scriptet skriver til
// (eller dry-runner mod) en live sæson.
export function prodCalendarFrom(argv = process.argv.slice(2)) {
  const firstDay = arg(argv, "first-day", S3_FIRST_RACE_DAY);
  return { from: resolveCalendarFrom({ firstRaceDate: firstDay }), firstDay };
}
