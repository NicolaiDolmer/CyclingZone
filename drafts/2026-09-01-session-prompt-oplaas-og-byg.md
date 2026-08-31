# Session-prompt: Lås op, byg, ryd op (A → B → vedligehold)

> Skrevet 31/8 2026 som handoff til næste session. Kopiér alt under linjen ind som første besked.
> Kontekst bag valget: ejeren er flaskehals på en række beslutninger, 6 PR'er ligger klar, 17 `claude:done` står åbne.
> **Tallene er verificeret 31/8 ca. kl. 17.30.** En parallel session lukkede ud samme aften med 6 merges — genverificér i fase 0 før du bygger på dem.

---

Du er orkestrator for en bølge-session. **Brug workflows** — det er en eksplicit opt-in, og sessionen er bygget til multiagent fan-out. Du er arkitekten; udførende subagenter kører på **sonnet**, du selv holder overblikket. Svar på dansk.

Rammen er ejerens egen (MASTERPLAN, 28/8): **"Gør den kørende sæson god."** Fejl der rammer spillere nu går forrest. Grundregel-ændringer er udskudt til efter 27/9 — kun rene FEJL må rettes, ikke forbedringer.

Sessionen har fire faser. **Kør dem i rækkefølge. Fase B må ikke starte før ejeren har svaret på fase A.**

## Fase 0 — orientering (inline, ikke en workflow)

1. Læs `docs/NOW.md` og `docs/MASTERPLAN.md`. Er "🤖 Working agent" sat til en anden session → STOP og spørg.
2. **Genverificér listerne nedenfor.** Der kører parallelle sessioner, og issues lukkes hurtigt. Kør `gh issue view <N> --json state` på hvert issue i fase A og B, plus `gh pr list --state open` og `gh pr checks <N>`. Byg kun på det der stadig er åbent.
3. Skriv 5 linjer: hvad er ændret, og holder planen stadig?

## Fase A — måle-workflow: lås ejerens beslutningskø op

**Formål:** ejeren er blokeret på beslutninger, ikke på arbejdskraft. Denne fase producerer **ingen kode** — den producerer tal.

Kør én workflow med fan-out over de blokerede beslutninger nedenfor. Hver beslutning får en måle-agent (read-only: kode + prod via Supabase MCP + issue-tråden), og hvert måleresultat køres gennem en **adversarisk verify-agent** der aktivt forsøger at modbevise tallet. Brug `pipeline()`, ikke barriere — beslutningerne er uafhængige.

| # | Beslutningen der står stille | Hvad der skal måles |
|---|---|---|
| **#4479** | `/rules` lover lønfrys ved 6,7 % af markedsværdi; koden bruger 35 % af `current_production_value` (`contractSeed.js:38-42`) | Mål afvigelsen på **faktisk signerede kontrakter** i prod. Hvor mange hold er ramt, og hvor meget? Blokerer PR #4483 + en patch note |
| **#4356 + #4357** | 34 etaper kørte med to kaptajner; `loadEntrantsForRace` mangler ORDER BY (#4357, bevidst urørt til #4356 er afgjort) | Hvor meget flytter det resultaterne? Re-sim eller stå ved dem — giv tallet der afgør det |
| **#4103** | Kalender-audit S3: typefordeling + brosten. Højbjerg målt brudt i 3 af 4 divisioner 31/8 | Bekræft eller afkræft pr. division. Hænger sammen med præmier pr. division (#3719). **To regenereringer af samme kalender er forbudt** |
| **#4098** | Unge markeres færdige ca. 65 point under eget maks (ejer-frist var 31/8) | Hvor mange ryttere, hvor stort et tab, og er det en FEJL eller en grundregel? Kun en fejl må rettes i S3 |
| **#4485** | Ungdomsklassementet inkluderer 26-årige (wall-clock-år i stedet for sæson-referenceår) | Skal S3's allerede kørte `young`-rækker genberegnes? Hvor mange løb og hvilke klassementer flytter sig? |
| **#4376 / PR #4388** | BEKRÆFTET: `guaranteed_base` rebases ikke ved oprykning | Hvad ændrer PR'en for hvilke hold, i tal? Ejeren har eksplicit sagt PR'en ikke må merges uden hans gennemgang |
| **#4495** | 8 ryttere på 22-23 år sidder fast i akademiet på 6 hold | Bekræft antallet i prod. Hvad er den mindste reparation, og hvad rører den ikke? **Ejer-gated datareparation** |
| **#3494 → #4265** | `sponsor_income` er ens for alle hold; #3494 blokerer #4265 | Hvor stor er skævheden reelt, og er #4265 S3-bundet? Ejeren afgør, men han mangler tallet |

**Se også #4482:** valg A er truffet (ejer 31/8), men oprydningen af de **36** eksisterende bonustilbud er ikke kørt og kræver spillerbesked FØRST. Udkast + SQL ligger klar med et `[DATO]`-felt. Mind ejeren om det og få fristen fastsat — når beskeden er ude, har 36 hold grund til at indløse 200.000 CZ$ hver indenfor fristen.

**Output fra fase A:** ét beslutningsark, skrevet til `docs/audits/beslutningsark-<dato>.md` og præsenteret i chatten. Format pr. punkt:

- **Hvad står stille** (2 linjer i klart sprog — ejeren husker ikke et issue ud fra et tal)
- **Målt** (tal fra prod/kode med kilde — ikke gæt; skriv "formodet" når du gætter)
- **A / B** med konsekvens for hver
- **Din anbefaling** + 👍/👎

Stil beslutningerne **én ad gangen** i chatten, ikke som et mega-dossier. Tekniske valg træffer du selv — kom kun til ejeren med ægte gates.

**Gate:** vent på ejerens svar før fase B. Han kan svare på nogle og parkere andre; byg kun på dem han har låst.

## Fase B — bygge-workflow: spillerfejl der ikke er beslutnings-blokerede

Kør som separat workflow med `isolation: 'worktree'` pr. agent, så parallelle fixes ikke kolliderer.

Kandidater (**genverificér at de stadig er åbne** — #4204, #4272 og #4317 blev lukket 31/8):

- **#4507** `verify_race_result_duplicates` timer ud mod prod og gør kalender-vagten rød HVER nat, nu hvor #4477 er merget
- **#4370** React #421 på alle prerenderede ruter (Suspense-boundary)
- **#4146** trup-loftet er 30 for alle divisioner mens et løb kræver mere
- **#4423** akademikontrakt midt i løb — del B, når PR #4422 (del A) er landet
- Alt ejeren netop har låst op i fase A

Plus de to friske ejer-direktiver fra 31/8, hvis der er slots tilbage:

- **#4521** SSOT for patch notes (site + Discord) + efterkontrol siden 28/8 — **må først skrives når PR-køen er live**, se fase C
- **#4522** "modtag forslag fra assistenten"-knap på træningssiden + start/styr-knapper generelt. Læs `docs/design/PAGE_TEMPLATES.md` FØR du rører en side, og byg en `show_widget`-mockup ejeren kan se, før du bygger fladen

**Verifikations-tier pr. worker tildeles i spawn-prompten** — orkestratoren ejer e2e-slottet, ingen worker kører fuld lokal suite på egen hånd, max 3 tunge samtidig. Krav til hver worker: commit pr. delfix, push hvert 30. minut. 45 minutters tavshed → kræv status; +15 → `TaskStop` og overtag worktree'et selv.

## Fase C — merge PR-køen

Ejeren har bedt om at få de klar-til-merge PR'er landet. Skeln skarpt:

**Merges frit, når checks er grønne** (aftalt problem + løsning på forhånd):

- PR #4508 (#4482 lag 6-bonustilbud) · PR #4494 (#4484 graduerings-sweep) · PR #4473 (#3818 fair play)

**Merges IKKE uden ejerens ord — fremlæg dem, spørg, vent:**

- PR #4388 (#4376) — ejeren har eksplicit parkeret den, og fase A måler den
- PR #4323 (#1146 sæsonmatrix) — UI, kræver spillertest og visuel godkendelse
- PR #4422 (#4423) — ejeren merger selv
- PR #4483 (#4479), hvis den stadig er åben — parkeret, afhænger af fase A-målingen

**Drafts — rør dem ikke uden at spørge:** PR #4362 (CodeRabbit-trigger) · PR #3512 (arketype-prior).

Efter hver merge: **flip `claude:todo` → `claude:done` med det samme**, PR for PR. Rører en merge en migration: apply den selv post-merge (idempotent + post-verify); destruktive klasser er ejer-gated.

Når PR-køen er live: skriv patch noterne. Udkastet ligger i `drafts/2026-08-31-patch-note-natboelge.md`. Kort, letlæseligt, kategorien synlig på et blik (ejer-krav 31/8, #4521). EN først, DA under, med æøå.

## Fase D — vedligehold (obligatorisk, ikke valgfrit)

1. **GitHub-hygiejne:** **17 issues står åbne med `claude:done`** (målt 31/8). Verificér hver mod runtime/kode — er den reelt leveret, luk den (`gh issue close N --reason completed`); er den ikke, flip labelen tilbage og skriv hvorfor. Søg dubletter før du opretter noget nyt. God fan-out-opgave: én agent pr. 4-5 issues.
2. **`docs/NOW.md`:** opdatér 🎯 Next action, nulstil 🤖 Working agent til "Ingen aktiv session". Budget **maks ~1.200 tok** — trim gamle close-out-blokke direkte, historikken ligger i git-log. Opret ALDRIG `docs/archive/NOW-*.md`.
3. **`docs/MASTERPLAN.md`:** opdatér hvis køen ændrede sig. Budget ≤1.500 tok. **Rækkefølgen er ejer-godkendt — spørg før omprioritering.**
4. **Den visuelle masterplan (artifact):** opdatér den så den matcher MASTERPLAN.md. Brug `Artifact` med `url: https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635` — samme URL, ikke en ny. Læs den først (`action: "read"`), så du opdaterer i stedet for at overskrive.
5. **`FEATURE_STATUS.md`** ved ændrede kontrakter · **`help.json`** (en+da) ved ny eller ændret spilmekanik · **postmortem** i `.claude/learnings/` ved hver bugfix.
6. Kør `pwsh -File scripts/check-agent-token-hygiene.ps1` — den `exit 1`'er hvis budgetterne er sprængt.

## Guardrails (ikke til forhandling)

- **Ingen prod-mutation uden ejer-GO på præcis det skridt.** "Vi tager den efter X" er ikke et go. Massesletning, omkørsel, præmie-reversering og regenerering kræver at ejeren har set tilstanden live.
- **Gen-tænd ALDRIG et pauset live-system** (race_engine_v2, stage_scheduler, auto_prize). At slukke for at stoppe er fint; at tænde er ejer-only.
- **Merge-gaten er forudgående enighed, ikke lav risiko.** Aftalte vi problem + løsning før det blev bygget? Nej → vis ejeren først. UI/layout altid.
- **Verificér FØR du kalder noget en bug.** Tjek git-log og merged PR'er — er afvigelsen tilsigtet? Bevidst ændring er SSOT-gæld, ikke en regression.
- **Verificér branch i selve commit-kæden**, også ved trivielle docs-commits. Commit kun bag `guard-commit-branch.sh`. Auto-push efter commit.
- **PR-preflight:** `pwsh -File scripts/preflight-pr.ps1` før push. Rørte du `frontend/`: også `npm run lint`. TIER FULL (backend, delte hooks, i18n, config eller >6 filer) → `scripts/verify-local.ps1`. Loop-guard: 2 CI-fejl på samme symptom → STOP og spørg.
- **Slå kolonnenavne op i `database/schema-snapshot.json`** før ad-hoc SQL. `riders` bruger `firstname`/`lastname`/`birthdate`.
- **Dump aldrig secret-values.** Ingen `railway variables`, `vercel env ls`, `env`, `cat .env*`.
- **Bash-tool:** ingen heredoc — skriv til fil med Write og brug `git commit -F`. Kald `gh`/`git` bart, aldrig bag `cd X &&`. `git log` kræver `--no-pager`.
- **Ejer-kommandoer er PowerShell 5.1:** `;` ikke `&&`, `C:\`-stier.
- **Vis visuelt undervejs.** UI-arbejde → preview-server eller `show_widget` FØR du beder om feedback, aldrig "test selv til sidst".
- Ingen chips til ejeren; du ejer opfølgningerne selv.

## Rapportering

Signalér 🟢/🟡/🔴/🆕 ved naturlige break-points. Afslut med "Næste session starter med #N ..." og en ærlig status: hvad blev leveret, hvad blev ikke, og hvorfor.
