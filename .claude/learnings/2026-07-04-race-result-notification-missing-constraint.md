# 2026-07-04 · race_result + emergency_loan_breach manglede i notifications_type_check

## Symptom
Prod postgres-error-log spammet: `new row for relation "notifications" violates check
constraint "notifications_type_check"` (23514) — 89 brud i ét 4-min burst
(10:09–10:13) + parallelle POST 400 på `/rest/v1/notifications`.

## Rod-årsag
`emitRaceResultNotifications` (#1952) dispatcher `type = "race_result"` for hver
deltagende manager, men typen var **aldrig** tilføjet `notifications_type_check`.
Hvert insert fejlede, men fejlen sluges tavst i `catch { failed++ }` →
notifikationen har aldrig virket i prod, og det viste sig kun som log-støj.
Burst-mønsteret (mange fejl på få minutter) = én løb-afvikling der notificerer hele
startfeltet. Samme bug-klasse fandtes en **anden** gang: `emergency_loan_breach`
(loanEngine.js:458).

## Fix
Additiv, idempotent migration (`database/2026-07-04-race-result-notification-type.sql`)
+ rettet `database/schema.sql`-drift (manglede også contract_expiring/academy_promoted/
academy_demoted som allerede kørte i prod).

## Læring / forward-guard
Den eksisterende `financeNotificationContract.test.js` havde en **håndholdt**
notifikations-typeliste der drev bagud — den fangede ikke race_result fordi ingen
huskede at tilføje den. Opgraderet til **auto-discovery** direkte fra kildekoden
(notifyUser/notifyTeamOwner/notifyManager-call sites + exporterede `*_TYPE`-konstanter),
så en ny type uden constraint-migration nu fejler i CI. Det var netop denne discovery
der afslørede `emergency_loan_breach`. Delvis levering af #1464 (finance-typer stadig
håndholdt — follow-up).

## Mønster at huske
- Tavse `catch`-blokke omkring DB-writes skjuler hele døde features. Når en insert-type
  er enum-styret af et CHECK-constraint, SKAL en forward-guard diffe kode-typer mod
  constraint'et — manuel liste driver altid bagud.
- Burst af samme constraint-fejl på få minutter = en batch-loop over mange entities,
  ikke en periodisk cron. Tæl distinkte minutter for at skelne.
