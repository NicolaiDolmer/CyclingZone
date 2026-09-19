# Branch-klassificering — 2026-09-19

> Read-only opfølgning på `docs/audits/2026-09-18-branch-opgoerelse.md` (#5391). Ingen branches slettet, ingen commits, ingen push. Formålet: afklare om "N commits foran main" reelt betyder unikt arbejde, eller om indholdet allerede er landet på main via squash-merge (bare under et andet PR-nummer eller i en omskrevet form).

**34 forældreløse branches undersøgt** (ud af 43 i alt — 7 har en åben PR og følger deres eget flow, 2 er dependabot-PR'er; begge grupper er sprunget over her).

## Antal pr. bunke

| Bunke | Antal |
|---|---|
| **A. Allerede på main** | 5 |
| **B. Erstattet af noget andet der er landet** | 20 |
| **C. Backup/wip af ufærdigt arbejde** | 9 |
| **D. Kan ikke afgøres read-only** | 0 |

Alle 34 kunne afgøres med konkret bevis (tomme diffs, grep-match af kernefunktioner, eller fund af den faktiske landede løsning i main's commit-log/issue-tråd) — ingen gæt.

---

## A. Allerede på main (sikker at slette, intet går tabt)

| Branch | Alder (dage) | Hvad det er | Bevis |
|---|---|---|---|
| `feat/4030-b1-climb` | 28 | Bjerg-selektions-mekanik (M2) til race engine v4 | `backend/lib/engine/v4/mechanics/climbSelection.ts` findes på main med samme eksporterede funktion `climbSeverity01`; kun 76 linjers diff (mindre senere tuning) |
| `feat/4030-b2-descent` | 28 | Nedkørsels-mekanik (M3) til race engine v4 | `backend/lib/engine/v4/mechanics/descent.ts` findes på main med alle samme eksporterede funktioner (`descentResultIsNoop`, `incidentProbability` m.fl.), videreudviklet siden |
| `fix/4223-alder-mellem-saesoner` | 24 | Rettede at rytter-alder forsvandt mellem to sæsoner | `useActiveSeasonYear.js` byte-identisk med main; `seasonReference.js`-logikken findes på main, blot refaktoreret siden. Patch note for #4223 findes i `patchNotes.js` |
| `feat/4030-h2h-scorecard` | 23 | Head-to-head observer/scorecard-helpers (v4 vs. v3) | Alle 4 ændrede filer byte-identiske med main. Landede via en ANDEN PR end branch-navnet antyder (#4132) |
| `wip/assistant-training-suggestions` | 1 | Assistent-panel med træningsforslag | Kernefilerne (`assistantTrainingSuggestions.js`, `AssistantSuggestionsPanel.jsx`) er byte-identiske med main (landet via #4526/#4522). Den resterende diff i `TrainingPage.jsx` er støj fra senere, urelateret arbejde — ikke uafsluttet funktionalitet |

---

## B. Erstattet af noget andet der er landet (sandsynligvis sikker, men ejeren bør vide hvad der erstattede den)

| Branch | Alder (dage) | Hvad det er | Erstattet af |
|---|---|---|---|
| `feat/3651-limited-upside-training` | 35 | Ville udvide "Limited upside"-chippen til trænings-fanen | Modsat designvalg: labelen blev helt FJERNET i stedet (Trin 7, commit `55032891c`, #3746/#3798) |
| `feat/3360-loenbasis-markedsvaerdi` | 30 | Løn baseret på markedsværdi i stedet for CPV | Anden model landet: "løn efter leverance", én global sats 0,35 (#3989/#3992). NB: det underliggende pengemængde-issue #3360 er stadig åbent — men netop denne tekniske tilgang er forladt |
| `fix/3997-spejder-tidspunkt` | 29 | Rettede frontend-tekst om spejder-rapportens modningstid | Rod-årsagsfix i backend i stedet (#4019): missioner modner nu præcist 24t×N efter afsendelse, så teksten aldrig behøvede rettes |
| `feat/4030-b3-finale` | 28 | Tidlig snapshot af engine v4's finale/fysiologi/gruppe-kerne | Erstattet af den færdigbyggede, langt mere udviklede version på main (samme issue #4030, commit `31ac479c2` + M5-M14-kæden) |
| `feat/4030-b4-timeline` | 28 | Tidligt timeline/adapter-lag + head-to-head-benchmark | Samme forklaring som b3 — main's `timeline.ts` har nyere events (#4971) branchen mangler |
| `claude/issue-4189-20260824-1737` | 25 | Docs-note der peger på en @claude-adgangs-analyse | Selve analysen findes allerede bevaret i issue #4189's egen kommentar-tråd (6/9) — branchens eneste indhold er en forældet pointer |
| `fix/4172-d4-spredning` | 25 | Script til at sprede D4-hold over 8 puljer | Samme problem løst på main via to andre scripts (`5f193467c` + `8752e8b41`), bekræftet afsluttet |
| `claude/issue-4241-20260825-1245` | 24 | Migreringsscript til ruleset-baseret collab-gate | Ejeren afviste eksplicit ændringen (issue-kommentar 4/9): den nuværende friktion er tilsigtet, "ingen ruleset-ændring" |
| `fix/3709-signaturfaktor-110` | 23 | Sænker signatur-tag-multiplikator fra 1,30× til 1,10× | Først rullet helt tilbage (PR #3791), derefter erstattet af strukturelt anderledes model (Trin 7, faste rolle-lofter, #3746/#3798) |
| `chore/4361-coderabbit-auto-trigger` | 21 | Workflow der auto-trigger'er CodeRabbit-review via PR-kommentar | Løst ad anden vej: CodeRabbit Pro-abonnement tegnet 1/9 (ejerens egen closing-kommentar) — hele workflow-tilgangen blev overflødig |
| `feat/4613-training-overview-first` | 15 | Stor omskrivning af træningssiden til overblik-først + faner | Bevidst parkeret (ejer-beslutning i PR #4736, 15/9): konceptet genbruges i kommende B6-redesign (#4849), men netop denne kode-diff skal ikke merges |
| `fix/4595-asset-404-immutable-cache` | 15 | Sænker cache-levetid for at undgå at 404'er caches som "immutable" | Løst via anden teknisk vej: retry/selfheal-mekanik (#5253) + Vite-fejlhåndteringsfix (#5097). NB: issue #4595 er siden genbrugt til et bredere emne (chunk-fejl-budget) end branch-navnet antyder |
| `ci/4404-auto-merge-label` | 13 | Ville fjerne hele auto-merge-workflowet (kunne aldrig opfylde code-owner-review på egne PR'er) | Repareret i stedet med admin-PAT (PR #4835, merged 6/9) — workflowet findes stadig på main |
| `feat/4632-intention-ui` | 12 | Løbsdagens intention-valg (grupetto→all-out) som UI-panel | **Delt dom:** kernelogikken (`raceIntention.js`) er byte-identisk med main — landet. Men selve UI-panelet (`RaceIntentionPanel.jsx`) blev samlet ind i og erstattet af den senere hero+faner-redesign (#4913) |
| `feat/v4-order-chain-ui` | 12 | Kobler taktik-kortet til den rigtige ordre-kæde, rolle som standardordre | **Delt dom:** backend/engine-laget (`teamOrderContract.ts`, `teamOrdersAdapter.ts`, migrationen) er identisk med main — landet. Men frontend-UI'et (`TacticsCard.jsx`) er erstattet af #4913-redesignet og siden videreudviklet yderligere (#5242) |
| `fix/5060-mobile-sticky-rider-column` | 8 | z-index-fix så rytternavn ikke forsvinder bag andre kolonner på mobil | Den erstattende PR (#5111) skriver eksplicit i sin egen body: "PR #5099 (denne branch) lukkes uden merge; intet er genbrugt derfra" — mobil-tabellen fik en helt anden løsning |
| `feat/5033-release-detect-reload` | 7 | Første udkast til at opdage ny release og genindlæse roligt | PR #5173's body siger eksplicit "Supersedes #5139" (denne branchs PR). Issue #5033 er stadig åbent fordi det bredere chunk-fejl-epic (#5162) stadig arbejdes på — ikke fordi denne branchs arbejde mangler |
| `fix/4860-4376-sponsor-base-s4` | 3 | Fastsætter S4-sponsorpriser ved aktivering (repricePendingContract-tilgang) | Erstattet af PR #5336 (`fbbc087b5`): nyere, anderledes løsning ("frossen default-pris" via `loadDefaultRenewTargetValue`) |
| `wip/4582-demote-inherits-contract` | 1 | Konsoliderer demote-kontraktarv (løn+længde+udløb) i én funktion | Erstattet af landet backend-fix under #4589 + frontend-PR #5378. Desuden forældet: fjerner #4619's squad-cap-logik som main aktivt bruger |
| `wip/v4-tuning-experiment-0109` | 1 | Tidligt, isoleret tuning-eksperiment på v4-motoren | Erstattet af omfattende senere motor-arbejde (mindst #4604, #4885, #4914, #4030, #4246, #2944, #3855, #4615, #4971) |

---

## C. Backup/wip af ufærdigt arbejde (unikt — slettes kun hvis ejeren opgiver arbejdet)

| Branch | Alder (dage) | Hvad det er | Begrundelse |
|---|---|---|---|
| `fix/5145-demote-age-gate-21` | 4 | Sænker aldersgrænsen for nedrykning til akademiet fra 22 til 21 | **BEVARES:** ejer parkerede den 14/9 til U23-/juniorsporet kommer — "branchen bevares til genoplivning" (verificeret direkte i PR #5197's sidste kommentar og issue #5145's kommentartråd, begge 14/9). Ikke en kandidat til sletning |
| `wip/4577-dotenv-scripts-cleanup` | 1 | Retter ~26 backend/scripts-filer til dotenv v17-kompatibel import | Matcher det åbne `claude:todo`-issue #4577 præcist, ikke påbegyndt endnu. Ingen erstatning fundet |
| `fix/4750-academy-intake-gain` | 13 | Fixer bug hvor nyt akademi-intake fik utilsigtet +2 træningsgevinst | Matcher det åbne `claude:todo`-issue #4750 1:1. Ingen erstatning fundet i main's commit-log |
| `feat/3448-level-anchor` | 27 | Tilføjer ejer-styret "niveau-anker" (a_floor_shift) til markedsværdimodellen | Hovedsweepen (blend/søndagskadence) ER landet (#3449), men selve anker-logikken mangler — kun et virkningsløst data-felt findes på main. Issue #3448 er stadig åbent |
| `feat/4535-matrix-calendar-strip` | 17 | Fjerner gentaget per-kolonne dato-visning i sæsonmatrixen, samler tidsvisning i ét bånd | Ægte unikt arbejde, matcher det åbne issue #4535 — men branchen er selv forældet og skal rebases mod senere main-ændringer (#5242, #5301, #4318) før den kan færdiggøres; uden rebase ville den regressere #4318's "Day N of M"-funktion |
| `measure/3337-specialisering` | 27 | Dev-harness-scripts til at måle om rytterspecialisering betaler sig over et etapeløb | Investigation-issue #3337 er stadig åbent og ubesvaret; måleværktøjet findes kun i denne branch |
| `claude/issue-2684-20260718-2316` | 61 (misvisende) | Gør drift-vagten mod uønskede plugin-IDs mere robust (præfiks-match) + advarer ved forældet harness-måling | **Vigtigt om de "2902 commits":** tallet er en artefakt af en orphan git-historik — branchen og main deler INGEN fælles forfader (`git merge-base` = tomt). Reelt indhold er kun topcommittens ~47 linjer. Matcher det åbne issue #2684, ikke landet på main |
| `claude/practical-lovelace-c12077` | 45 | Dokumenterer en gotcha: preview-serveren i et worktree kører fra hoved-checkoutet, ikke worktreet selv | Lille (19 linjer), ægte ufærdig dok-rettelse, ikke fundet på main. Bør tjekkes om problemet stadig består, da worktree-tooling er ændret meget siden |
| `codex/growth-plan-2026-09-16` | 2 | Vækst/indtjenings-beslutningsoplæg til ejer-gennemgang 17/9 | Ren research/planlægning, ingen kode — dokumentet siger selv eksplicit "ikke build-go, ingen PR oprettet". Review-datoen (17/9) er passeret; indholdet kan allerede være konsumeret mundtligt ind i MASTERPLAN uden at branchen blev merget — kunne ikke afgøres read-only om det stadig er relevant |

---

## D. Kan ikke afgøres read-only

(ingen — alle 34 branches kunne klassificeres med konkret bevis)

---

## Metode-note

- **MSYS_NO_PATHCONV-fælde:** på Windows/Git Bash konverterer shell'en automatisk sti-agtige argumenter — det gav falske "MISSING/does not exist"-resultater ved brug af kolon-syntaks som `origin/main:<fil>` (fx i `git show`). Løsning: præfiks disse kald med `MSYS_NO_PATHCONV=1`. Rene tekst-/streng-baserede checks (grep, diff --stat) uden kolon var upåvirkede.
- Alle konklusioner bygger på faktisk kørte read-only kommandoer (diff, grep, log --grep, `gh pr list`/`gh issue view`) — ingen er gættet ud fra branch-navn eller commit-count alene.
