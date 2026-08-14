# Natbølge 2026-08-14

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 00:25 → 05:39 |
| Agenter launched / fuldført / døde | 24 / 24 / 0 |
| PR'er åbnet / merged | 13 / 0 (intet merges før ejer-go) |
| Issues → claude:done | ingen endnu (intet merged) |
| gh-401-retries (preflight-probe + bølge) | 0 synlige i orkestratorens egne kald; preflight-probe grøn på 1. forsøg |
| Recoveries (type) | 0 |
| Preflight | GO kl. 00:19 (`.codex.local/night-wave-preflight.json`) |

**Spor:** 12 planlagte, 12 leverede PR. 0 stoppet, 0 gættet. Plus 1 unblocker-PR fra orkestratoren.

## Struktur

To chunks, ikke tre. Gruppe B og C blev slået sammen til én sekventiel kæde, fordi `scripts/verify-affected.mjs` klassificerer **både i18n-locale-filer og `backend/**` som TIER FULL** — begge grupper krævede altså fuld lokal e2e-suite, og maskinen må kun køre én ad gangen. Kæden ejede e2e-slotten alene; ingen lås var nødvendig.

| Chunk | Spor | Varighed |
|---|---|---|
| A (5 parallelle) | #3586, #2511, #3654, #3559, #3681 | 45 min |
| Kæde C→B (7 sekventielle) | #3597, #3620, #3669 → #3621, #3651, #3548, #3628 | 5 t 14 min |

C kørte først, så de tre ægte spillerbugs var i hus tidligt hvis kæden døde sent. Den døde ikke.

## PR'er

| Issue | PR | Verify |
|---|---|---|
| #2511 perf-gate på main | #3689 | ok |
| #3559 balance-drift-guard | #3690 | concerns |
| #3654 stop-hook-støj | #3691 | concerns — **ejer-gate** |
| #3681 backwards-check | #3692 | concerns |
| #3586 skema-guard | #3693 | concerns |
| #3597 forlæng-kontrakt | #3694 | concerns |
| #3620 akademi-kontraktår | #3698 | concerns |
| #3669 afvis byttetilbud | #3699 | concerns — **ejer-gate** |
| #3621 sponsor-forecast | #3700 | concerns |
| #3651 limited upside | #3701 | concerns |
| #3548 scout-nedtælling | #3702 | concerns |
| #3628 loading-knapper | #3703 | concerns |
| bundle-loft (orkestrator) | #3704 | — |

Ingen `blocker`-verdikter. Ingen PR rørte `patchNotes.js`. Alle har `## Brugerverifikation` med mindst ét `[x]`.

## Afvigelser/læringer

**1. Main lå over bundle-loftet før bølgen — perf-gaten var rød på alt.** Målt på ren `origin/main`: 945,3 KB mod 945,0-loftet. Fire frontend-PR'er stod derfor røde uden at have gjort noget forkert. Da mønstret blev opdaget midt i bølgen, blev en note lagt på de fire endnu ikke startede B-issues (agenterne læser issuet som første skridt — det er en brugbar injektionskanal til en kørende kæde) med besked om ikke at røre `bundle-budget.json`. **Det virkede: alle syv frontend-branches merger rent, også i locale-filerne.** Uden noten var fire konkurrerende budget-hævninger i samme fil sandsynlige.

**2. Rod-årsagen bag 26 budget-hævninger havde aldrig et issue.** Den levede som en kommentar i `bundle-budget.json`, hvor formuleringen eskalerede fra "udestående" (16/7) over "presserende" (23/7) til "nu kritisk" (5/8) uden nogensinde at blive sporet. Nu #3697.

**3. Skema-guarden fandt en ægte bug ved sin første kørsel.** `driftMonitor.js` selecter `riders.name`, som ikke findes. Queryen 400'er og springes tavst over af sin egen `if (!orphanError)`-gren, så drift-monitoren har rapporteret nul forældreløse ryttere uanset virkeligheden. Sporet som #3695. Det er samme fejlklasse som en vagt der ikke kan skelne: den beskytter ikke.

**4. Stall-watchdoggen giver falske positiver på færdige agenter.** En afsluttet agents transcript holder op med at skrive, og watchdoggen læser det som "frossen >8 min". I en sekventiel kæde er præcis det den normale tilstand for alle færdige spor. Krydstjek mod worktree-fremdrift skelner korrekt, men flaget alene gør det ikke.

**5. Infisical-sessionen er udløbet på denne PC.** `#3597`-agenten kunne ikke læse Sentry-eventernes `reason`-felt og måtte fastslå rod-årsagen ad omvejen via telemetri-kodens fingerprint-logik plus prod-data. Det lykkedes, men det kostede tid og er en unødig blindhed for fremtidige natbølger.

**6. To spor afdækkede at en tidligere "fix" var korrekt da den blev merged.** #3620's #2881-fix virkede — en anden PR samme dag (#2933) udvidede en guard, så et felt der aldrig var blevet SELECT'et pludselig gjorde guarden permanent falsk. Det er ikke en fejlet fix, det er en fjern-virkning. Værd at huske næste gang noget "stadig" er i stykker efter en fix.

## Ejer-gates før merge

- **#3691 (#3654):** issuet skrev "Forslag (ejer vælger)" med anbefaling A. PR'en leverer et tredje design (aktivitets-gate). Begrundelsen for at fravælge A er efterprøvet korrekt, men designet er ikke set af ejeren.
- **#3699 (#3669):** withdraw sender nu en notifikation også på den hidtil tavse `pending`-sti — altså en ny besked spillere ikke fik før. Adfærdsudvidelse ud over issuets scope.
- **#3700 (#3621):** kun halvdelen af issuet er besvaret (hvilken sæson tallet gælder). Andet led — hvor man skifter sponsor — er udskudt. Ejer-kald om issuet lukkes eller kommenteres.

## Merge-rækkefølge

`#3704` (bundle-loft) **først** — de fire røde bliver grønne ved en re-run bagefter uden ændringer. Derefter backend/lav-konflikt, så frontend. `#3694` og `#3698` rører hver sin del af kontrakt-logikken og er verificeret uden fil-overlap.

---

_Refs #605. Se [`NIGHT_WAVE_RUNBOOK.md`](../NIGHT_WAVE_RUNBOOK.md)._
