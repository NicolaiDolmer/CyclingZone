// backend/lib/engine/v4/adapters/teamRosterAdapter.ts
// Race Engine v4, M13 (#3463, #2412, #3855): startliste -> holdopstillinger.
//
// HVORFOR DEN FINDES: mechanics/teamTimeTrial.ts blev bygget med 17 groenne
// tests, men kunne ikke kobles ind — den kraever en `TeamRoster[]` (holdene
// allerede grupperet), og den frosne `Entrant` baerede intet hold-id. Filens
// egen wiring-note beskrev praecis denne adapter som den manglende brik:
// "en ny adapter under adapters/ (fx teamRosterAdapter.ts) ... ELLER StageInput
// udvides med et `team_id`-felt paa Entrant". M16 (#4246) valgte den anden vej
// og gav `Entrant.team_id` 6/9 — saa denne fil er blevet ren gruppering af en
// startliste der ALLEREDE baerer hold-id, uden et eneste DB-opslag.
//
// REN — ingen import fra oevrigt backend, ingen IO, ingen rng, ingen Date.

import type { Entrant } from "../types.ts";
import type { TeamRoster } from "../mechanics/teamTimeTrial.ts";

/**
 * Praefiks paa den syntetiske hold-noegle en rytter UDEN hold-id faar.
 *
 * En TTT-startliste kan i praksis vaere blandet: broen laeser `team_id` fra
 * `race_entries`, og en raekke uden hold (fx en rytter hvis hold er slettet
 * midt i saesonen) ville ellers enten falde ud af resultatlisten — et brud paa
 * invariant 6 (resultatet er en komplet permutation 1..N af startlisten) —
 * eller blive foldet sammen med ALLE andre hold-loese ryttere til ét fantomhold
 * der koerte sammen hele dagen. Ingen af delene er sande. Hver hold-loes rytter
 * bliver derfor sit EGET hold paa én mand: han koerer etapen solo, faar sin
 * egen tid, og paavirker ingen andres.
 */
const UNASSIGNED_TEAM_PREFIX = "unassigned:";

/** Tomt/whitespace-only hold-id taeller som "intet hold" (samme regel som mechanics/teamPlay.ts). */
function normalizedTeamId(entrant: Entrant): string | null {
  const raw = entrant.team_id;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Grupperer en startliste i holdopstillinger til mechanics/teamTimeTrial.ts.
 *
 * Returnerer `null` naar INGEN rytter paa startlisten baerer et hold-id. Det er
 * den bevidste fallback-doer: de fire golden fixtures og enhver haandbygget
 * testliste er skrevet uden feltet, og en TTT-rute uden hold er ikke en
 * holdtidskoersel — den skal koere den almindelige vejetape-vej, bit-uaendret.
 * `null` (og ikke et tomt array) goer forskellen paa "ingen hold" og "hold, men
 * tomme" umulig at forveksle paa kaldsstedet.
 *
 * Determinisme (§3 invariant 1): holdene sorteres paa hold-id og rytterne paa
 * rider_id, saa den samme startliste altid giver den samme opstilling —
 * uafhaengigt af hvilken raekkefoelge databasen leverede raekkerne i.
 */
export function teamRostersFromStartlist(startlist: readonly Entrant[]): TeamRoster[] | null {
  const withTeam = startlist.some((e) => normalizedTeamId(e) !== null);
  if (!withTeam) return null;

  const byTeam = new Map<string, Entrant[]>();
  for (const entrant of startlist) {
    const teamId = normalizedTeamId(entrant) ?? `${UNASSIGNED_TEAM_PREFIX}${entrant.rider_id}`;
    const bucket = byTeam.get(teamId);
    if (bucket) bucket.push(entrant);
    else byTeam.set(teamId, [entrant]);
  }

  return [...byTeam.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([team_id, riders]) => ({
      team_id,
      riders: [...riders].sort((a, b) => a.rider_id.localeCompare(b.rider_id)),
    }));
}
