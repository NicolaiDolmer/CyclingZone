// backend/lib/selectionDeadlineReminder.js
// #4983 — den SYNLIGE del af D-034: en påmindelse i UI'et om at en trup mangler
// før udtagelsesfristen. Gul markering ved "Planlægning" i navigationen, en boks
// øverst på planlægningssiden, og en rød eskalering tæt på fristen.
//
// INGEN NY FRIST OG INGEN NY DEFINITION. Alt her genbruger de kilder der
// allerede findes:
//
//   "frist"          = første etapes `scheduled_at` (race_stage_schedule), præcis
//                      som `racesNeedingSelectionWarning` i selectionWarningSweep.js
//                      måler den. ASSISTANT_RULES §1b egenskab 2: horisonten måles
//                      på wall-clock mod første etape, ikke på binding-vinduet.
//   "trup mangler"   = antal race_entries (manuelle OG auto-udfyldte) <
//                      `selectionSizeForRace(race).max` — samme optælling som
//                      getSelectionContext/isSquadSelectionMissing og som #4038
//                      rettede sweepet til at bruge. En fuldt AUTO-udfyldt trup
//                      "mangler" altså IKKE.
//   gul-vinduet      = SELECTION_WARNING_HOURS (36) fra #2180 — samme vindue som
//                      indbakke-varslet allerede bruger. Påmindelsen er den
//                      synlige tvilling til den besked, ikke et nyt varsel.
//   rød-vinduet      = app_config.assistant_late_fill_hours (default 24) fra
//                      #4201/D-034 — assistentens egen horisont. Under den er
//                      det sidste chance for at rette truppen selv.
//   rød-GULVET       = MIN_RACE_ENTRIES (6) fra #4295 — samme flade gulv som
//                      raceRunner bruger når den smider hold ud af startfeltet,
//                      og som løbskortet siger "Under 6 ryttere. Stiller ikke
//                      op." på (raceSelectionLogic.partialSquadOutlook).
//
// EJER-BESLUTNING 10/9: rød betyder "truppen STILLER IKKE OP", ikke "fristen er
// tæt på". En trup under gulvet (fx 5/8 eller 0/8) bliver rød inde i late
// fill-horisonten; en trup over gulvet men under klassens max (fx 6/8) bliver
// ALDRIG rød — den starter, bare ikke i fuld styrke. Målingen i prod viste at
// den gamle regel (rød = alt der ikke er fuldt, tæt på fristen) ville farve ~108
// managere røde for trupper der starter helt fint. Gul-definitionen er uændret.
//
// Eskaleringstrinnene er nedskrevet i docs/ASSISTANT_RULES.md §1b ("Påmindelsen
// (#4983)") — ændres et af tallene her, skal §1b opdateres i SAMME PR.
//
// Ingen tilstands-flip: modulet LÆSER kun. Det rører hverken
// assistant_selection_mode, late_fill eller race_entries, og sender ingen
// notifikation (issue-accept #4983: dette er UI-tilstand, ikke ny indbakke-støj).

import { racesNeedingSelectionWarning, SELECTION_WARNING_HOURS } from "./selectionWarningSweep.js";
import { selectionSizeForRace, MIN_RACE_ENTRIES } from "./raceAutopick.js";
import { teamInRacePool } from "./raceBinding.js";

/** Gul: hvor længe før første etape påmindelsen overhovedet vises. #2180's vindue. */
export const SELECTION_REMINDER_WINDOW_HOURS = SELECTION_WARNING_HOURS;

/**
 * Rød: deltagelses-gulvet. Genbrugt, ikke nyt — samme konstant som
 * raceRunner/raceFieldIntegrity smider hold ud på, og samme tal som
 * "Under 6 ryttere. Stiller ikke op." på løbskortet. Re-eksporteret her så
 * kaldere kan læse gulvet uden at kende raceAutopick.
 */
export const SELECTION_REMINDER_FLOOR = MIN_RACE_ENTRIES;

export const SELECTION_REMINDER_TONES = Object.freeze({
  NONE: "none",
  WARNING: "warning",
  URGENT: "urgent",
});

const MS_PER_HOUR = 3600 * 1000;

/**
 * TIDS-halvdelen af det røde trin: er fristen inde i late fill-horisonten?
 * <= urgentHours → urgent (rød), ellers warning (gul). Negativ/NaN behandles som
 * urgent: er fristen passeret i samme tick som svaret bygges, er det ikke tiden
 * til at nedtone.
 *
 * Bruges ikke alene til at farve et løb — se reminderToneForRace, som lægger
 * gulv-halvdelen oveni (ejer-beslutning 10/9).
 */
export function reminderToneForHours(hoursUntilDeadline, urgentHours) {
  if (!Number.isFinite(hoursUntilDeadline)) return SELECTION_REMINDER_TONES.URGENT;
  const limit = Number.isFinite(urgentHours) ? urgentHours : 0;
  return hoursUntilDeadline <= limit
    ? SELECTION_REMINDER_TONES.URGENT
    : SELECTION_REMINDER_TONES.WARNING;
}

/**
 * Er truppen under deltagelses-gulvet, altså "stiller ikke op"? En tom trup er
 * trivielt under gulvet (gulvet er 6), men skrives eksplicit ud fordi det er
 * netop den tilstand ejer-beslutningen nævner.
 */
export function isBelowStartFloor(entryCount, floorSize = SELECTION_REMINDER_FLOOR) {
  const count = Number(entryCount);
  if (!Number.isFinite(count)) return true;
  const floor = Number.isFinite(floorSize) ? floorSize : SELECTION_REMINDER_FLOOR;
  return count === 0 || count < floor;
}

/**
 * Tonen for ÉT løb (ejer-beslutning 10/9).
 *
 *   RØD  = truppen stiller ikke op (under gulvet, tom trup medregnet) OG første
 *          etape starter inden for late fill-horisonten.
 *   GUL  = alt andet der overhovedet er med i påmindelsen, dvs. truppen er ikke
 *          fuld (under klassens max) inde i 36-timers vinduet. Et hold på 6/8 er
 *          gult hele vejen ned til start — det starter, bare ikke i fuld styrke.
 */
export function reminderToneForRace({
  hoursUntilDeadline,
  urgentHours,
  entryCount,
  floorSize = SELECTION_REMINDER_FLOOR,
}) {
  if (!isBelowStartFloor(entryCount, floorSize)) return SELECTION_REMINDER_TONES.WARNING;
  return reminderToneForHours(hoursUntilDeadline, urgentHours);
}

/**
 * Den samlede tone for hele påmindelsen: rød hvis MINDST ét løb er rødt, ellers
 * gul hvis der er noget, ellers ingen. Fladen viser én markering i navigationen,
 * så den skal bære det mest presserende af det spilleren mangler.
 */
export function aggregateReminderTone(races = []) {
  if (!races.length) return SELECTION_REMINDER_TONES.NONE;
  return races.some((r) => r.tone === SELECTION_REMINDER_TONES.URGENT)
    ? SELECTION_REMINDER_TONES.URGENT
    : SELECTION_REMINDER_TONES.WARNING;
}

/**
 * Bygger påmindelsen for ÉT hold. Pure + deterministisk (ingen I/O) — kalderen
 * har allerede hentet rækkerne.
 *
 * @param {object} args
 * @param {Array} args.races          løb i den aktive sæson med status='scheduled'
 * @param {Map}   args.scheduleByRace Map<race_id, Array<{scheduled_at}>>
 * @param {Map}   args.entryCountByRace Map<race_id, antal race_entries for HOLDET>
 * @param {Set}   args.withdrawnRaceIds løb holdet har meldt sig af
 * @param {object} args.team          {league_division_id}
 * @param {Date}  [args.now]
 * @param {number} [args.windowHours] gul-vinduet (default 36)
 * @param {number} [args.urgentHours] rød-vinduet (default = late fill-horisonten)
 * @param {number} [args.floorSize]   deltagelses-gulvet (default MIN_RACE_ENTRIES)
 * @returns {{tone: string, count: number, races: Array}}
 */
export function buildSelectionDeadlineReminder({
  races = [],
  scheduleByRace = new Map(),
  entryCountByRace = new Map(),
  withdrawnRaceIds = new Set(),
  team = null,
  now = new Date(),
  windowHours = SELECTION_REMINDER_WINDOW_HOURS,
  urgentHours,
  floorSize = SELECTION_REMINDER_FLOOR,
}) {
  const nowMs = now.getTime();
  const due = racesNeedingSelectionWarning({ races, scheduleByRace, now, windowHours });

  const items = [];
  for (const race of due) {
    // Bevidst fravalg er ikke "mangler" — samme udeladelse som sweepet (#2180).
    if (withdrawnRaceIds.has(race.id)) continue;
    // Holdet skal være i løbets pulje; ellers er løbet slet ikke dets at udtage til.
    if (!teamInRacePool({
      teamDivisionId: team?.league_division_id ?? null,
      racePoolId: race.league_division_id ?? null,
    })) continue;

    const targetSize = selectionSizeForRace(race).max;
    const entryCount = entryCountByRace.get(race.id) || 0;
    if (entryCount >= targetSize) continue; // fuld trup — også hvis assistenten fyldte den

    const hoursUntil = (race.startMs - nowMs) / MS_PER_HOUR;
    items.push({
      id: race.id,
      name: race.name,
      race_class: race.race_class ?? null,
      deadline_at: new Date(race.startMs).toISOString(),
      hours_until: Math.round(hoursUntil * 100) / 100,
      entry_count: entryCount,
      target_size: targetSize,
      // Gulvet med i svaret, så fladen kan sige HVORFOR et løb er rødt uden at
      // gen-beregne noget (klienten regner aldrig selv, jf. selectionReminder.ts).
      min_size: floorSize,
      will_not_start: isBelowStartFloor(entryCount, floorSize),
      tone: reminderToneForRace({
        hoursUntilDeadline: hoursUntil,
        urgentHours,
        entryCount,
        floorSize,
      }),
    });
  }

  // Nærmeste frist først — boksen læses oppefra, og det mest presserende løb
  // skal stå øverst.
  items.sort((a, b) => a.hours_until - b.hours_until);

  return { tone: aggregateReminderTone(items), count: items.length, races: items };
}
