# 2026-08-05 — #3009 scorecard exit-code: verificeret allerede fixet, dækning udvidet

## Hvad skete der

Natbølge-opgaven bad om at finde og rette exit-code-fejlen i #3009 ("balance-
scorecards exiter grønt selvom de indeholder FAIL"). Ved verifikation (repo-
root, `gh issue view 3009`) viste issuet sig at være **CLOSED**, fixet af PR
#3248 (merged 2026-08-03 20:43, én dag før denne session). Roden var præcis
som beskrevet: `moneySupplyScorecard.js` og `inflationScorecard.js` printede
`HEADLINE: ... ❌ FAIL` men satte aldrig en non-zero exit-kode — en bevidst
"report-pattern"-kommentar fra før launch der aldrig blev revideret. Samme
fejlklasse blev fundet i `scripts/sponsorChoiceScorecard.js` under #3009's
eget backwards-check og fixet i samme PR.

Fixet: en delt hjælper `backend/scripts/lib/scorecardExitCode.js`
(`gateExitCode(pass, {advisory})`) wired ind i alle tre scripts, plus et
`--advisory`-flag til report-only-brug, plus en runtime-forward-guard-test
(`scorecardExitCodeWiring.test.js`) der spawner scripts og sammenligner
printet HEADLINE-verdikt mod faktisk exit-kode.

## Hvad denne session gjorde i stedet

Da selve #3009-bugget allerede var rettet, drejede sessionen om tre ting:

1. **Verifikation** — læste diffen i commit `2b765525`, læste de tre filers
   nuværende kildekode, bekræftede at `gateExitCode(` er korrekt wired i alle
   tre.
2. **Bredere tjek** (eksplicit efterspurgt i opgaven) — gennemgik ~25
   scorecard/gate/audit/monitor-scripts i `backend/scripts/` + `scripts/` for
   samme mønster. Fandt INGEN nye instanser af "beregner FAIL, exiter 0" —
   se PR-body for fuld inventarliste. Ét falsk spor undersøgt grundigt:
   `raceCompetitionScorecard.js`'s `--enforce`-flag er default OFF i koden,
   men npm-scriptet `race:competitions` sender allerede `--enforce` — korrekt
   wired ved den tiltænkte entrypoint, ikke en bug.
3. **Lukkede en reel dækningsgabet** — de tre "søster"-scorecards fra PR #3006
   (`facilityInvestmentScorecard.js`, `scoutTravelScorecard.js`,
   `relegationParachuteScorecard.js`) var korrekt fixet men UDEN et kørende
   regressionstjek — kun kode-gennemgang bekræftede kontrakten. Alle tre er
   100% DB-frie (eller graceful uden creds), så jeg udvidede
   `scorecardExitCodeWiring.test.js` til at spawne og verificere dem samme
   vej som de to oprindelige.

## Root cause (uændret fra #3009, dokumenteret her for eftertiden)

Et scorecard der **beregner** en pass/fail-verdikt og **printer** den, men
aldrig lader beregningen nå `process.exitCode`/`process.exit()`, er en gate
der lyver over for alt automatiseret (`$?`, CI, npm-run) mens den fortæller
sandheden til et menneske der læser konsollen direkte. Det gør bugget
lumsk: manuel QA ser rødt og tror det er fanget; CI/automatisering ser grønt.

## Hvor længe løj gaten, og hvilke rapporter er mistænkelige

`moneySupplyScorecard.js`/`inflationScorecard.js`'s "report-pattern" var en
FØR-launch-beslutning, aldrig revideret efter launch (2026-05-08) — altså
løj den automatiserede gate reelt i hele den periode, indtil PR #3248
(2026-08-03).

**Konkret fund, ikke kun teoretisk:** `docs/audits/2026-06-21-economy-fase2-
calibration.md` erklærer eksplicit `moneySupplyScorecard --synthetic-only`
grøn — "D1 +3.6k · D2 +13.6k · D3 +8.6k, alle ✅... Ingen regression at
undgå her — fresh-gaten er allerede sund og skal forblive det." Genkørt i
DENNE session (2026-08-05, samme `--synthetic-only`-flag) giver scriptet
**D1 net 318.712 · D2 328.712 · D3 323.712 — alle ❌ FAIL** (mål: |net| ≤
30.000). Det er ~90× drift fra den dokumenterede baseline. `--config=
scripts/.cal-recommended.json` (samme override-fil som 6/21-auditen
refererer) ændrer intet ved dette — den fil styrer kun præmie-kurven
(`prizePerPoint`/`flatten`), ikke upkeep, som er den reelle driver af
net-tallet. De reelle upkeep-konstanter er altså ændret siden 6/21 UDEN at
nogen genkørte fresh-gaten for at opdage det — præcis den blinde vinkel
#3009 beskriver. Auditens "grøn"-erklæring er nu falsificeret og bør
IKKE bruges som reference før en ny kørsel er dokumenteret.

Den underliggende øknomi-beslutning (er tærsklerne forkerte, eller er
økonomien forkert — #3009's punkt "hvad der skal besluttes") er stadig
åben og hører til balance-sporet, ikke denne exit-code-fix.

## Læring til fremtidige gates

- Et script der printer et HEADLINE-verdikt uden at røre exit-koden er en
  stille fælde — søg altid efter `HEADLINE`/`❌ FAIL` OG bekræft at samme
  boolean rammer `process.exitCode`/`process.exit()` FØR du stoler på et
  grønt npm-run.
- `--enforce`-lignende flag der er OFF by default er IKKE i sig selv en bug
  — tjek altid om npm-scriptet/CI-jobbet der reelt kalder scriptet allerede
  sender flaget (som `race:competitions --enforce` gør). Bug-signaturen er
  "printer FAIL, ingen vej til non-zero exit uden dokumenteret opt-in", ikke
  "har et flag".
- En "grøn" audit-doc har en holdbarhedsdato. Hvis den citerer et scorecards
  output, og scorecardet afhænger af konstanter der kan ændres senere
  (upkeep, sponsor, presis), er auditens tal kun sande indtil næste
  konstant-ændring — ingen automatisk alarm fanger drift i en committet
  markdown-fil.
