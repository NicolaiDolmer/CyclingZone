# Vagten der gik grøn uden at måle noget (anden gang)

**Dato:** 31/8-2026 · **Issues:** [#4463](https://github.com/NicolaiDolmer/CyclingZone/issues/4463), [#4465](https://github.com/NicolaiDolmer/CyclingZone/issues/4465) · **Forgænger:** `.claude/learnings/2026-08-28-groent-flueben-der-intet-verificerede.md`

## Hvad skete der

To fejl i samme nat-vagt, fundet i bølgen 30/8. Begge gjorde `calendar-invariant-audit.yml` ubrugelig, hver på sin måde: den ene gjorde den blind, den anden gjorde den til støj.

**(1) Blind, #4463.** Kørslen 30/8 09:28 UTC rapporterede success uden at have målt en eneste invariant:

1. `verify-invariants.js` døde på `rpc verify_race_result_duplicates: HTTP 500 statement timeout` (kendt langsom, #4204).
2. `|| true` lod bash fortsætte med en **tom** `invariants.json`.
3. Parseren kastede `SyntaxError: Unexpected end of JSON input`.
4. Parseren var skrevet `node ... | tee invariants.txt`. Under `bash -e` **uden `pipefail`** tæller kun sidste kommandos exit-kode, og `tee` returnerer 0 → steppet meldte **success**.
5. `kalender_brud` nåede aldrig `GITHUB_OUTPUT`, så både "Open or update tracking issue" og "Fail if calendar or constraint findings" blev **SKIPPED** — de betinger sig af et output der ikke fandtes.

**(2) Støj, #4465.** Invarianten `calendar_monument_exclusive_game_day` håndhævede stadig #4075's eksklusive monument-løbsdag. Ejeren ophævede den regel 26/8 (#4236). Gaten var rød 27/8, 28/8 og 29/8 på noget der er tilladt, og botten åbnede #4211 om "1 kalender-brud" der ikke var et brud. `docs/CALENDAR_RULES.md` modsagde sig selv: §4 beskrev ophævelsen udførligt, §9 listede invarianten som aktiv.

## Rod-årsag

**#4463:** exit-koden fra en måling kan maskeres af det den pipes til. `| tee` er den mest almindelige form, men `sed`, `wc`, `jq` og `grep` gør præcis det samme. Fejlen er usynlig i loggen — der står ingenting om at noget gik galt.

**#4465:** en regel blev ophævet i ét lag (SSOT §4) og blev stående i to andre (SSOT §9 + gaten). Hard rule 30 led (c) siger at regel, SSOT og gate skal ændres i SAMME PR. Da det ikke skete, vogtede gaten en regel der ikke længere fandtes.

Fælles for begge: **et grønt eller rødt flueben blev troet uden at nogen spurgte hvad det målte.** En vagt der ikke kan blive rød er ingen vagt; en vagt der altid er rød bliver slået fra, og så vogter den heller ingenting.

## Fix

- Parseren flyttet fra en inline heredoc til `scripts/summarize-invariant-report.mjs`, som **fejler hårdt** på tom, ugyldig eller måleløs `invariants.json`. Forskellen på "intet brud" og "intet målt" er nu synlig.
- `|| true` erstattet af en gemt exit-kode: verify-invariants exit 1'er både ved et ægte brud og ved sin egen død, og de to skelnes nu af om rapporten faktisk indeholder målinger.
- `set -o pipefail` tilføjet i 7 steps på tværs af 5 workflows (backwards-check).
- "Fail if"-steppet fejler nu også når `maalt` mangler — belt and braces, fordi 30/8 viste at et step kan melde success uden at have skrevet sine outputs.
- `calendar_monument_exclusive_game_day` fjernet fra gaten, og monument-logikken fjernet fra `calendarOverlapInvariant.js`, `calendarGameDayRepair.js` og `repairGameDayAxis4161.mjs` — sidstnævnte ville have lagt det eksklusive indskud ind igen ved en gen-kørsel.
- `CALENDAR_RULES.md` §9 rettet, og den regel der ER tilbage (monumenterne spredt over sæsonen) står nu som **IKKE FASTLAGT** med de målte mellemrum og det ene spørgsmål ejeren skal svare på, frem for at blive gættet på plads.

## Forward-guard

`scripts/lint-workflow-output-masking.mjs` (+ test, kørt i `ci.yml`) flagger ethvert step der skriver til `GITHUB_OUTPUT` og piper sin måling uden `pipefail`.

Testen der beviser den: den kører mod **præcis** den step-form 30/8-hændelsen havde. Første udgave af detektoren fangede den **ikke** — den ledte kun efter `$GITHUB_OUTPUT` i shell-form, mens hændelsens step skrev via `appendFileSync(process.env.GITHUB_OUTPUT, ...)` inde i en node-blok. Testen afslørede hullet med det samme.

## Læring

1. **En vagt skal kunne bevise at den målte noget.** Nul fund og nul målinger ser ens ud i et exit-flag. Rapporten skal derfor selv indeholde antallet af målinger, og et manglende antal skal være rødt.
2. **`| tee` i CI er en exit-kode-slugende konstruktion.** Skriv til fil og `cat` bagefter, eller slå `pipefail` til. Det gælder også `sed`, `wc`, `jq` og `grep`.
3. **Skriv forward-guardens test mod den ægte hændelse, ikke mod en pæn fixture.** Havde jeg kun testet den syntetiske form, var vagten shippet uden at kunne fange den fejl den blev bygget til.
4. **Ophæver du en regel, så ryd alle tre lag i samme PR:** SSOT, generator og gate. Ellers vogter en gate en regel ingen længere har vedtaget — og en permanent rød gate bliver ignoreret, præcis som en permanent grøn.
