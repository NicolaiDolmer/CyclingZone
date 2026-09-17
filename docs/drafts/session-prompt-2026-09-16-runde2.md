# Session-prompt til 16/9 runde 2 (skrevet efter Discord-sweep + #5288-fixet)

> Kopiér blokken under stregen som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`.
> Denne prompt afløser `session-prompt-2026-09-16.md` (punkt 0 dér er nu bygget og ligger i PR #5297).

---

Trin 0: Læs `docs/NOW.md`. Kør `pwsh -File scripts/close-out-cleanup.ps1` (dry-run) og tjek `.claude/run/wave-active.json`. Kør `npm run sync-deps` FØR du kører backend-tests: `zod` mangler lokalt, så `routes/api.test.js`, `routes/raceStrategy.contract.integration.test.js` og `routes/rankings.test.ts` fejler med `Cannot find package 'zod'` uanset hvad du laver. De tre fejl er IKKE en regression.

Du er orkestrator (Fable). Du udfører aldrig selv byggearbejde; workers bygger (model eksplicit: opus til motor/migration/undersøgelse, sonnet til afgrænsede fixes og UI). Ét delpunkt pr. kort, ét konkret eksempel med prod-tal, én anbefaling. Læs issuets seneste kommentarer FØR kortet. UI-PR = skærmbillede i samme tur som kortet. Merge kun på ordret "merge".

Dagens opgaver, i rækkefølge.

## 1. Luk fighter-sagen (#5288 / PR #5297) — HØJEST

Baggrund: udrulningen 15/9 (#5280) satte `aggression: 70` i `MENTAL_ABILITY_TAG_CEILING`. Aggression har caps-vægt i præcis én opskrift — `baroudeur`, vægt 3, hans SIGNATUREVNE — og er ikke en craft-evne, så alle andre typer lå på 55/45 i forvejen. Loftet skar altså kun baroudeuren, 23 point ned til håndværks-niveau, hvilket kostede 8,4 ratingpoint på hans forventede loft. Fire spillere meldte det inden for et døgn. Ejer valgte 16/9 variant A: aggression ud af tabellen, tilbage på 93.

PR #5297 er bygget, pushet og var ved sidste tjek 47 pass / 0 fail / 3 e2e-shards pending.

a) Tjek `gh pr checks 5297`. Webkit-flake `seo-public-routes.spec` (#4925) → rerun, ikke fix. Max 2 CI-cyklusser pr. symptom.
b) Vis ejeren ÉT kort med før/efter i tal: baroudeurens signatur-loft 70 → 93, og hvad det gør ved det forventede rating-loft (−8,4 point bliver til 0). Brug thelambas rigtige tal (77-78 → 70 → tilbage) og friisisch' (80 → 72 → tilbage).
c) Ved ordret "merge": `scripts/merge-queue.ps1 -Pr "5297"`. Ingen migration i PR'en.
d) **Post-verify, og vær ærlig om timingen:** lofterne ligger persisteret i `ability_caps` og genberegnes af `dailyTrainingEngine` ved næste tick (`dailyTrainingEngine.js:378`, skriver ved `capsChanged`). Spillerne ser derfor stadig det sænkede tal indtil deres rytters næste træningspas. Spørg ejeren om han vil vente på det naturlige tick eller have et målrettet recompute-kort (prod-mutation = eget go-kort).
e) Skriv udkast til en kort besked i Discord-tråden "New stats - Teamwork and leadership" (#feedback-and-ideas). Spillerne fik et forkert svar 16/9 (at faldet skyldtes de tomme evner) — det skal korrigeres rent. EJEREN POSTER SELV. Tone: `docs/TONE_OF_VOICE.md`, jeg/du, aldrig vi, ingen em-dash.
f) Flip #5288 til `claude:done` straks efter merge.

**Restpunkt ejeren skal tage stilling til (ikke bygget):** loftet på 70 skærer også teamwork (climber, rouleur) og lederskab (gc, sprinter) ned fra 93, fordi `abilityRoleClass` er binær på fortegn — også vægt 1 giver `signatur`. Det koster de typer ca. 1,5-1,8 ratingpoint og forklarer thelambas "gc og sprinter ca. −2". Det er ejer-godkendt og urørt. Spørg ÉN gang om det skal væk også, med tallene, og byg kun på et ja.

## 2. Ret patch note 7.277 FØR du merger #5287

#5287 (7.277) siger ordret *"Lofterne for taktik og angrebslyst er sænket tilsvarende"* / *"The ceilings for tactics and aggression were lowered to match."* Den sætning bliver usand i samme øjeblik #5297 merger. Ret den i #5287's branch, så kun taktik nævnes:

- EN: `The ceiling for tactics was lowered to match.`
- DA: `Loftet for taktik er sænket tilsvarende.`

Checks på #5287 er fra 15/9 kl. 18:46 og dermed stale; de to røde er `e2e-shard (mobile-webkit)` og `frontend-smoke`. Push rettelsen, lad checks køre friskt, rerun flakes, og merge derefter. Merger #5297 først, så `gh pr update-branch 5287` inden.

## 3. Merge-kø — hvad der faktisk kan lukkes i dag

Målt 16/9 kl. ca. 07:15. Alle står `BLOCKED` (28 påkrævede checks + ingen review) — det er normalt her; merge sker med `--admin` via `scripts/merge-queue.ps1`, én ad gangen.

| PR | Status | Hvad der mangler |
|----|--------|------------------|
| **#5297** fighter-loftet | 47 pass, 0 fail, 3 pending | ejer-go (punkt 1) |
| **#5281** B3: fjern manager-klik-bonussen | **48 pass, 0 fail — helt grøn** | ejeren parkerede den ("vent til træningssessionen"). Spørg om den kan gå nu, eller om den stadig hænger på punkt 4. |
| **#5287** patch note 7.277 | 46 pass, 2 fail (stale fra 15/9) | tekstrettelse + rerun (punkt 2) |
| **#5240** i18n-bundle/perf | 47 pass, 2 fail: `e2e-shard (desktop-chromium)`, `frontend-smoke` | rerun først; er de ægte, så kort til ejeren før der bygges |
| **#5264** B4 samlet daglig træning | **DIRTY** | `gh pr update-branch 5264` FØRST, ellers kører CI slet ikke på nye pushes |
| **#5285** fairplay-handel | 46 pass, 3 fail: `backend-tests`, `static-guards`, `swallowed-catch-guard` | ægte fejl. Tilhører en ANDEN sessions bølge (#5284) — rør den ikke uden at tjekke `wave-active.json` og spørge ejeren |
| **#5169** løbsdage 140 | 44 pass, 2× `audit` fail | parkeret indtil løbsdage-retningen er afgjort (punkt 4b) |
| #5263, #5262, #5235, #3512 | DRAFT | ikke i dag medmindre ejeren siger det |

Realistisk lukkeliste i dag: **#5297 → #5287 → #5281 → #5240**. Én ad gangen, `gh pr update-branch` mellem hver, done-flip PR-for-PR (ikke til sidst).

## 4. Ejerens oprindelige liste fra 15/9 aften ("i morgen")

a) **Sponsor #4860** (PR #5263, draft): kortet + før/efter-billedet ligger i `docs/audits/2026-09-15-5267-visuals/4860-sponsor-foer-efter.png` og i #4860's seneste kommentar. Vis billedet igen, forklar med Team WolkerWessels (368.000 → 515.200). Merge først ved "det er det jeg bestilte".
b) **Løbsdage #5267**: rapporten + de to visuelle kort blev afvist 15/9 ("Det her er rigtigt dårligt tror jeg sku"). Spørg HVAD der er dårligt, i én linje, før du foreslår noget. Fakta der holder: D1 havde 86 løbsdage i S3; "140" er etaper (5 klokkeslæt × 28 dage). PR #5169 er parkeret til afgørelsen.
c) **Træningssession**: B4 #5264 + B3 #5281. Programmets 7×5-grid afhænger af punkt 4b.
d) **To apply-go-kort** (ejer ser tal live, ÉN mutation ad gangen, spillerbesked skrives af ejeren): evne-point-flyt #5268 (`infisical run --env=prod -- node backend/scripts/dry-run-5268-mental-abilities.js --dry-run`, V1 vs V2, anbefalet V2, evt. ANDEL da massen ellers stiger 54 %) og trup-backfill #4619 (`node backend/scripts/backfill-4619-riders-squad.js --dry-run`, 282 u23 / 249 junior, valg A).

**Bemærk rækkefølgen:** kør #5268-point-flytningen EFTER #5297 er merget og deployet, ellers flytter du point under en loft-formel der er på vej til at ændre sig.

## 5. Discord-sweepen fra i morges

8 nye issues oprettet 16/9. To har priority:high:

- **#5296** — welcome-mailen sender 0 trods fundne kandidater, to døgn i træk (mail-drift-vagten). Nye managers får ingen velkomstmail. Ikke rodårsags-undersøgt; start med Resend-logs for 13-15/9 og se om der overhovedet er afsendelsesforsøg.
- **#5288** — punkt 1 ovenfor.

Resten (priority:med/low): #5289 rå i18n-nøgle `SELECTION.HUNTER` på dansk planlægningsside, #5290 etapeløb i morgen vises som "i dag", #5292 rytterdatabase mangler hurtig-scout + filtre nulstilles ved tilbage-navigation, #5294 + #5295 to ubesvarede docs-spørgsmål, #5293 live bids-blokken. #5289 og #5290 er små og oplagte worker-opgaver hvis der bliver luft.

## 6. Close-out

NOW.md (Next action + Working agent = "Ingen aktiv session"), MASTERPLAN hvis køen ændrede sig, FEATURE_REGISTRY ved flag-flip, patch note, done-flips PR-for-PR, `pwsh -File scripts/check-agent-token-hygiene.ps1`, `scripts/close-out-cleanup.ps1`, prompt til næste session. Postmortem for #5288 i `.claude/learnings/2026-09-16-aggression-loft-ramte-kun-baroudeur.md` — lektien er at et go-kort med et loft-tal skal sige HVEM tallet rammer, ikke bare hvad det ændrer fra og til.

## Regler jeg holder fast i

- Ejeren læser ikke lange kort. Ét delpunkt, ét eksempel med rigtige tal fra prod, én anbefaling.
- Merge-køen kigger kun på påkrævede checks. Webkit-flake #4925 rammer frontend-PR'er; rerun, ikke fix. 2 CI-fails på samme symptom → STOP og spørg.
- `gh pr update-branch` FØR merge. CI tavs på en PR = tjek `mergeStateStatus` DIRTY først.
- Byg KUN via `.claude/workflows/wave.js`; guard-agent-spawn blokerer håndskrevne Agent-kald mens NOGEN bølge kører, også en anden sessions.
- Hoved-checkoutet bliver på main. Feature-arbejde i worktree: `pwsh -File scripts/new-worktree.ps1 -Branch <navn> -FromBranch origin/main`.
- Udskyd aldrig noget selv; "hvad viger" er ejerens beslutning.
- Founder-prosa til spillere skriver ejeren; jeg leverer udkast i hans tone (Hep!, du-form, ingen em-dash, jeg/I aldrig vi).
