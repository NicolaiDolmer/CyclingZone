// backend/lib/assistantFilledSquadNotification.js
// #4759 (roadbook-loefte, opfoelger til #4201): manageren skal have besked
// naar assistenten udtog HELE hans hold for et loeb, fordi han ikke naaede
// det selv. Delt af de to skrivestier der rent faktisk kan fylde en HELT tom
// (loeb, hold)-enhed for et MENNESKE-hold:
//   - raceRunner.fillMissingTeamEntries — sen redning ved etape 1 (kodevej C,
//     docs/ASSISTANT_RULES.md §6), kun grenen med 0 eksisterende entries
//     (eksisterende 1-5 er en REDNING af managerens egen delvise trup og
//     udloeser ALDRIG denne notifikation, jf. §10 "manageren vinder").
//   - raceEntryGenerator.runRaceEntryGenerator — late_fill- og opt_in-
//     tilstanden (§1b). Den proaktive tilstand naar aldrig hertil: begge
//     filers eligibleTeams-filter udelukker allerede menneske-hold der ikke
//     har bedt om det (§1/§4217).
//
// "Aldrig naar manageren selv havde en udtagelse" (issue #4759 punkt 2)
// haandhaeves af KALDESTEDERNE (begge tjekker at enheden var HELT tom - hverken
// manuel eller tidligere auto-raekke - foer de kalder denne funktion), ikke
// her: denne fil bygger og afsender bare EEN besked naar den bliver bedt om
// det. notifyTeamOwner/notifyUser's (type, title, message, related_id)-dedup
// (24t, notificationService.js) er et defensivt andet lag mod dubletter ved
// en race-tids-retry — den primaere idempotens er at kaldestedet naturligt
// ikke naar hertil igen, naar enheden foerst har faaet sine entries.
import { notifyTeamOwner } from "./notificationService.js";

export const ASSISTANT_FILLED_SQUAD_TYPE = "assistant_filled_squad";

/**
 * Byg payloaden. EN foerst (fallback-tekst + dedup-noegle), DA under via
 * metadata.titleCode/messageCode (#666, rendret af frontend i modtagerens
 * users.language). Samme moenster som alle andre builders i
 * notificationService.js (fx buildContractExpiringNotification).
 *
 * @param {{ raceId: string, raceName?: string|null }} args
 */
export function buildAssistantFilledSquadNotification({ raceId, raceName }) {
  const name = raceName || "your race";
  return {
    type: ASSISTANT_FILLED_SQUAD_TYPE,
    title: "Assistant filled your squad",
    message: `Your assistant picked your squad for ${name}. You had no selection in. Take a look and change it if you want.`,
    relatedId: raceId ?? null,
    metadata: {
      raceId: raceId ?? null,
      titleCode: "notif.assistantFilledSquad.title",
      titleParams: {},
      messageCode: "notif.assistantFilledSquad.message",
      messageParams: { race: name },
    },
  };
}

/**
 * Notificér holdejeren. Kaldes EFTER den faktiske race_entries-skrivning er
 * bekræftet af kaldestedet — en fejlet notifikation må ALDRIG kunne vælte
 * selve udtagelsen (samme A2-isolerings-mønster som resten af
 * notificationService.js, #2389). Kalderen isolerer selv fejl (try/catch +
 * captureException), som resten af de fire-and-forget notifikations-kald i
 * raceRunner.js (#1995/#4423-mønstret).
 *
 * `notify` injicérbar for test.
 *
 * @param {{ supabase: object, teamId: string, raceId: string,
 *           raceName?: string|null, notify?: typeof notifyTeamOwner, now?: Date }} args
 */
export async function notifyAssistantFilledSquad({
  supabase, teamId, raceId, raceName, notify = notifyTeamOwner, now = new Date(),
}) {
  if (!teamId || !raceId) return { delivered: false, deduped: false, reason: "missing_target" };
  const payload = buildAssistantFilledSquadNotification({ raceId, raceName });
  return notify({ supabase, teamId, now, ...payload });
}
