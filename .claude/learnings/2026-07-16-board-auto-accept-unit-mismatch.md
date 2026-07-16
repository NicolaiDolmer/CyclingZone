# Postmortem · 2026-07-16 · Board auto-accept-ur målte i sæson-race-days, ikke kalenderdage

## Hvad skete der?
Bestyrelsens auto-accept-cron (`backend/lib/boardAutoAccept.js`) sammenlignede
`seasons.race_days_completed` mod tærskler 2/4/5 for T-3/T-1/auto-accept.
Designet (Q-C 2026-05-05) antog ~1 race-day pr. kalenderdag (~5-dages
forhandlingsvindue). I prod (16/7): `race_days_completed=524` mod
`race_days_total=60` — 218 auto-accepts (bulk 54 stk. dagen efter
sæsonstart), kun 25 T-3-reminders (ét kort vindue 29-30/6), 0 T-1-reminders
NOGENSINDE siden launch.

## Root cause
Enheds-mismatch. `race_days_completed` er `SUM(stages)` over ALLE completede
løb i sæsonen på tværs af ALLE divisioner (`backend/lib/seasonRaceDays.js`),
ikke "kalenderdage siden sæsonstart". Med flere divisioner der afvikler løb
parallelt vokser den ~20+/dag, ikke ~1/dag. Cronen brugte den alligevel som
en kalenderdags-proxy for "hvor længe har DENNE plan været til forhandling" —
et globalt sæson-ur brugt som stedfortræder for et per-plan forhandlings-ur.

## Fix
Erstattede race-day-uret med et kalenderdags-ur PR PLAN via en ny
`resolveNegotiationOpenedAt({ team, pendingBoard, realBoards })`
(`backend/lib/boardAutoAccept.js`): anker = pending-boardets `updated_at`,
med fallback til søster-planens `created_at` (sekventiel onboarding uden
egen række endnu) og til sidst `team.created_at`. Tærsklerne
(`AUTO_ACCEPT_THRESHOLDS`) beholdt navnesemantikken (T_MINUS_3=2,
T_MINUS_1=4, AUTO_ACCEPT=5) men måler nu dage, ikke race-days. Samme anker
genbruges i `GET /board/status` (routes/api.js, `auto_accept`-payload) så
UI-countdownen aldrig kan afvige fra cronens faktiske ur. Fjernede den
utilstrækkelige `NEW_TEAM_GRACE_DAYS`-skånefrist (#2104) — subsumeret, fordi
et nyt holds anker nu er `team.created_at` i sig selv, MED T-3/T-1-varsler
undervejs (som #2104 manglede).

## Forhindret-fremover
`backend/lib/boardAutoAccept.test.js` dækker nu dag 0/2/4/5-dispatch for et
nyt hold, renew-flip (frisk `updated_at` nulstiller uret uanset holdets
alder), manglende plan-række (anker = søster-planens `created_at`), og
#2469-regressionsguarden (select↔upsert-kontrakt) er opdateret til at
inkludere `created_at`/`updated_at`. `BOARD_AUTO_ACCEPT_SELECT`-guarden
fanger fremtidige felter der læses fra `existingBoard` uden at være selectet.

**Kendt følgearbejde (samme underliggende enheds-bug, IKKE fixet her):**
`getBoardRenegotiationLock` (`backend/lib/boardRequests.js`),
`boardMidSeason`-midpoint og `seasonRaceDays.js` selv bruger stadig
race_days_completed som en implicit kalenderdags-proxy. Kræver separat issue
— ikke rørt i denne PR (scope-disciplin, samme fejlklasse kan ramme dem
anderledes og fortjener egen verifikation).

## Læring
Et globalt sæson-tæller (`race_days_completed`, summeret på tværs af
divisioner) er IKKE en kalenderdags-proxy, selv når den historisk voksede
~1/dag under en tidligere, simplere sæson-struktur. Enhver tærskel-logik der
"lånte" den counter som stedfortræder for tid brød stille, da flere
divisioner blev tilføjet — uden fejl, uden crash, bare forkerte notifikations-
vinduer der først blev synlige ved at læse de faktiske notifikationstal i
prod. Se også: `.claude/learnings/2026-07-14-time-threshold-proxy-for-structural-problem-is-fragile.md`
(samme mønster — en global tæller brugt som tids-proxy).
