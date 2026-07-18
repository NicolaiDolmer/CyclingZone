# Postmortem · 2026-07-18 · Generations-tidspunkt-guard var ikke nok — tilføjede et view-tidspunkt-lag

## Hvad skete der?
Opfølgning på `.claude/learnings/2026-07-17-scouting-report-unsearchable-riders.md`
(#2581/#2611): den PR ekskluderede skjulte ryttere fra kandidat-poolen VED
GENERERING af en mission-shortlist. Read-only prod-audit i dag (#2623) viste at
16/50 historisk shortlistede ryttere STADIG er usøgbare — fordi synligheden kan
ændre sig EFTER en rapport er genereret, men FØR spilleren rent faktisk åbner
Scouting-siden og læser den. En genererings-tidspunkt-guard alene kan derfor
aldrig lukke klassen fuldstændigt: en rytter kan gå fra søgbar til skjult (nyt
`academy_intake`-tilbud, ny `pending_team_id`) i tidsrummet imellem.

## Root cause
`GET /api/scouting/central` (`scoutAssignmentService.getScoutState`) serverede
`scout_assignments.result` råt, som det stod ved generering — ingen re-kontrol
af rytterens NUVÆRENDE tilstand ved selve visningen.

## Fix
Nyt lag: `backend/lib/scoutReportVisibility.js` (`hydrateCompletedVisibility`)
kører ved HVER `getScoutState`-kald, EFTER generering — genkontrollerer hver
rider-id i `completed`-assignments (mission-shortlist + target-rytter) mod
NUVÆRENDE `riders.team_id`/`pending_team_id`/`is_academy` +
`academy_intake.status='offered'`, filtrerer skjulte ryttere ud af
`shortlist`/`top_rider_id` (target: nuller `rider_id`), og attacherer en
`riderStatus`-map (`free_agent` / `{team, teamName}`) til frontend-visning.
Samtidig strammer `scoutSweep.js`s `defaultLoadCandidates` kandidat-poolen til
KUN kontraktfrie ryttere (`team_id`+`pending_team_id` begge NULL) — #2644
ejer-beslutning om at droppe "andre managers hold"-targeting for nu, hvilket
også fjerner en hel klasse af fremtidige "denne rytter er ikke min at target'e"-
rapporter.

## Forhindret-fremover
De to lag er UAFHÆNGIGE med vilje: genererings-tidspunkt-filteret reducerer
STØJ i kandidat-poolen (bedre missioner), view-tidspunkt-guarden er selve
KORREKTHEDS-garantien (aldrig en usøgbar rytter i en vist rapport), og fungerer
uanset om generering-laget nogensinde får et hul igen. Tests i
`scoutAssignmentService.test.js` låser klassen direkte på `getScoutState`
(ikke kun på de rene helper-funktioner) med fire scenarier: åbent intake-tilbud,
`pending_team_id`, rytter der har fået hold siden (forbliver synlig, status
opdateres), og en target-rapport hvor selve `rider_id` skal skjules.

## Læring
"Filtrér ved generering" og "filtrér ved visning" er IKKE det samme garanti-
niveau for data der kan ændre synlighed over tid (RLS-gates, transfer-flows,
udløbs-sweeps). Et system der viser en cachet/gemt reference til en entitet
hvis synlighed kan ændre sig SKAL genkontrollere ved visning, ikke kun stole på
tilstanden ved oprettelsestidspunktet — ellers driver "rapport" og "virkelighed"
fra hinanden igen, næste gang en ny skjulnings-kilde dukker op (i dag var det
`pending_team_id`, i morgen kan det være noget andet). Samme princip som
`riderEligibility.js`s ét-sted-gate, nu anvendt på et LÆSE-tidspunkts-problem i
stedet for et skrive-tidspunkts-problem.
