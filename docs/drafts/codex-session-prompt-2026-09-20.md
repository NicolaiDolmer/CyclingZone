# Codex-sessionsprompt 20/9 2026: B4-træningen rettes (#5264) → løn ved pension (#4153)

> **Til ejeren (ikke en del af prompten).** Skrevet af Claude søn 20/9 ud fra `docs/NOW.md`, MASTERPLAN, sæsonskifte-overblikket 19/9 og PR-/issue-teksterne. Begge opgaver er rent byggearbejde på den kritiske vej mod 27-28/9 og kræver ingen ny design-beslutning fra dig undervejs. Start Codex fra repo-roden: `cd C:\Dev\CyclingZone; codex`, højeste reasoning-niveau. Kør IKKE en Claude-byggebølge i de samme filer imens; Claude må gerne lave read-only, kort og merges. Når Codex melder "PR klar", er det dig der siger ordret "merge". Vil du have en anden opgave først, så ret kun afsnit 1/2; rammen (afsnit 0, 3, 4) er den samme. Kopiér alt under stregen.

---

Du er Codex i CyclingZone (browserbaseret cykel-managerspil, open beta, live på cyclingzone.org; sæson 3 slutter 27/9, sæsonskiftet til S4 er 27-28/9, etaper kører kl. 11-19 dansk tid). Ejeren er solo-udvikler og sidder med. Svar på dansk. Skriv kort, konkret, med tal og filnavne. Sig "ikke verificeret", når du ikke selv har set det; gæt aldrig et feltnavn eller en tilstand.

## 0. Ramme (udfør før alt andet)

1. Læs `docs/agents/CODEX_PROMPTS.md`. Udfør **Del B** (daglig session-start) trin 1-6 nu, ordret: læs `CLAUDE.md` (du auto-loader den ikke), `git fetch --prune origin && git status -sb`, læs `docs/NOW.md`, og skriv `Codex — #5264 B4-træning rettes (worktree feat/4847-race-day-close-trigger)` i feltet `🤖 Working agent` og push det STRAKS (commit-titel `docs(now): ...`, #5093-guarden kræver det). Claude kan ikke se dig køre; det felt er den eneste lås.
2. Står der allerede en anden aktiv session i `🤖 Working agent` → STOP og spørg.
3. Worktree: PR #5264 findes allerede på branchen `feat/4847-race-day-close-trigger`. Opret worktree på DEN branch (`pwsh -File scripts/new-worktree.ps1 -Branch feat/4847-race-day-close-trigger`; findes der allerede en worktree til branchen under `C:\Dev\CyclingZone-worktrees`, så brug den). Alt arbejde sker derinde. Hoved-checkoutet `C:\Dev\CyclingZone` er ejerens og Claudes; rør det kun for NOW.md-låsen.
4. Commit KUN bag guarden: `bash scripts/guard-commit-branch.sh <branch> <worktree-sti> && git -C <worktree-sti> commit -F <msg-fil>` (eller PowerShell-wrapperen `scripts/guard-commit-branch.ps1`, som fejler hårdt hvis bash mangler). Aldrig heredoc; skriv beskeden til en fil og brug `-F`. Commit-beskeder: `fix(traening): ... (Refs #4847 #5267)`, sidste linje `Co-Authored-By: Codex <noreply@openai.com>`.
5. Læs FØR kode (hard rule 30, SSOT'er): `docs/TRAINING_RULES.md` (især §13.3, ejer-beslutningerne 15/9), ejerens realisme-regel 18/9 (seneste kommentar på PR #5264 + #5267-kommentaren samme aften), `docs/GAME_INVARIANTS.md`, `database/schema-snapshot.json` (kolonnenavne; slå `race_entry_days`, `race_stage_schedule`, `races` op dér, gæt ikke).
6. Rør ALDRIG: `docs/NOW.md` ud over låse-feltet, `docs/MASTERPLAN.md`, `frontend/src/data/patchNotes.js`, `.claude/`, race engine (`backend/lib/engine/`), kalender-generatoren og PR #5169 (venter på en spiller-afstemning), PR #5281 (B3, merges først på flip-dagen), flagenes værdier i prod. Tænd ALDRIG et flag. Anvend ALDRIG en migration selv mod prod; `database/*.sql` køres af `auto-migrate.yml` ved merge. Dump aldrig secret-værdier (`railway variables`, `vercel env ls`, `cat .env*`, `env` er forbudt).
7. **Tallet 140 løbsdage er LÅST (ejer 15/9). Spørg aldrig om det, og hardkod det ikke et nyt sted; læs det fra den konstant/det argument motoren allerede bruger.**

## 1. Opgave 1 (primær): ret B4 (PR #5264), så den overholder ejerens realisme-regel

**Baggrund.** B4 lader dagens træning køre samlet, én gang pr. dag, efter dagens sidste løb, bag flaget `training_tick_per_race_day` (OFF i prod). Ejeren låste 18/9 fire regler: (1) en løbsdag er én dato, (2) løb ELLER træning pr. løbsdag, aldrig begge, (3) et etapeløb binder rytteren fra første til sidste etape, også på hviledage; hviledag i et etapeløb = hvile, ikke træning, (4) alle divisioner har lige mange løbsdage, og løbsdage uden løb er rene træningsdage. Gennemgangen 18/9 fandt tre brud i PR'en. Ejerens løfte til spillerne er at det nye træningssystem er live til S4-start, så denne PR er på den kritiske vej.

**De tre rettelser (alle skal med, i denne rækkefølge):**

1. **Regel 3, binding fra `race_entry_days`.** I dag afgøres "kørte løb" af dagens etaperesultater (`backend/lib/dailyTrainingEngine.js`, `loadRacedRiderIdsToday`, ca. linje 70-94). `race_entry_days` (rytterens spænd inkl. GT-hviledage) læses aldrig. Ret: en rytter er bundet på en løbsdag, hvis han har en `race_entry_days`-række for den dag, uanset om der er et etaperesultat. Bundet rytter = ingen træning den dag. Test: GT med hviledag; rytteren får hverken træningstick eller "træningsdag" på hviledagen.
2. **Regel 2, ingen afhængighed af et andet flag.** Detektionen hænger i dag på `race_day_development_enabled` (dormant). Med kun `training_tick_per_race_day` tændt er `racedRiderIds` altid tom, og en rytter der kørte løb får træning oveni. Ret: løb-ELLER-træning afgøres alene inden for `training_tick_per_race_day`-stien. Test: kun det ene flag on → rytter med løb får 0 træning.
3. **Regel 4, tick på rene træningsdage.** `gameDaysByDivision` (`backend/lib/trainingDayCloseTrigger.js`) udleder løbsdage fra `race_stage_schedule`, så en løbsdag uden løb giver intet tick. Ret: løbsdags-aksen skal komme fra sæsonens løbsdags-tal (det argument/den konstant kalenderen og motoren allerede deler), ikke fra hvilke dage der tilfældigvis har etaper. Find kilden med grep, og skriv i PR-body hvilken du valgte og hvorfor. Test: en division med en løbsdag uden løb får præcis ét tick den dag for alle ikke-bundne ryttere.

**Derudover:**
- Merge `origin/main` ind i branchen FØRST. Konflikterne er kun `docs/FEATURE_REGISTRY.yml` + `docs/FEATURE_STATUS.md`; `FEATURE_STATUS.md` er genereret, så løs registry i hånden og kør `node scripts/generate-feature-status.mjs`. OBS: PR'en viser ingen CI-kørsler, så længe den er i konflikt.
- Flag OFF skal stadig være bit-identisk med i dag. Behold den eksisterende test for det; bliver den rød, har du ændret for meget.
- `frontend-smoke` var rød 15/9 på PR'en. Find ud af om det var en ægte regression eller tidsbudgettet (run-link står i PR-kommentaren), og ret eller dokumentér.
- Sweepens to betingelser (kl. ≥ 20 dansk tid + dagens sidste finalization færdig, maks-ventetid kl. 23 m. Sentry-capture) er ejer-besluttede. Rør dem ikke.
- Opdatér `docs/TRAINING_RULES.md`, så realisme-reglens fire punkter og de tre rettelser står dér (kort, med dato). Hjælpetekst (`help.json` en+da) kun hvis adfærden spilleren ser ændrer sig i forhold til det der allerede står i PR'en; følg `docs/TONE_OF_VOICE.md` (jeg/I, aldrig vi; EN først, DA under, med æøå).

**Verifikation (TIER FULL: backend + delte libs + >6 filer):** `pwsh -File scripts/verify-local.ps1`, derefter i `frontend/`: `npm run lint`, `node --test`, `npm run build`. Kør i FORGRUNDEN og vent på output; "baggrundsjob kører" er ikke et resultat. Derefter `pwsh -File scripts/preflight-pr.ps1`. Loop-guard: 2 røde CI-kørsler på samme symptom → STOP og spørg. Push mindst hvert 15. minut.

**Aflevering.** Opdatér PR #5264's body (skabelonen; Brugerverifikation som `- [x]` med hvad ejeren kan tjekke; "Refs", ikke "Closes"; patch note: ingen, alt er bag slukket flag, skriv det). Meld tilbage med en tabel: rettelse | ændret (fil:linje) | test der beviser det | selv kørt / antaget. Vent på ordret "merge". Ved "merge": `pwsh -File scripts/merge-queue.ps1 -Pr "5264"` (én ad gangen, aldrig manuelt `gh pr merge`, aldrig i minutterne HH:57-HH:03). Efter merge: kommentér #4847 med hvad der er verificeret og hvad der udestår til flip-dagen (B3 #5281 + flag). Flaget flippes IKKE af dig.

## 2. Opgave 2 (kun når ejeren siger "næste"): #4153, løn trækkes for ryttere der pensioneres i samme sæsonskifte

**Baggrund.** Ved skiftet trækker `season_payroll` (transition fase 6) hele den nye sæsons løn, FØR `rider_progression` (fase 13) pensionerer ryttere. Ved S2→S3 betalte 26 hold ca. 103.700 for 28 ryttere, der aldrig kørte et S3-løb; det blev refunderet i hånden natten til 24/8. Fejlen gentager sig automatisk 27/9, hvis den ikke rettes.

**Løsning: variant A fra issuet** (mindst indgribende; variant B flytter faser og rører den ejer-låste #1155-rækkefølge, så den er udelukket). `processTeamSeasonPayroll` springer ryttere over, hvis pension er deterministisk givet den netop afsluttede sæson. Krav:
- Genbrug motorens EGET pensions-prædikat (`riderSeasonAge.js` + den regel `riderProgression` faktisk bruger). Ingen kopi af reglen; kan prædikatet ikke importeres rent, så udtræk det til én delt funktion, som begge kalder.
- Test: transition-fixture hvor en rytter der pensioneres ved skiftet ikke lønnes, mens en jævnaldrende der IKKE pensioneres lønnes som før. Samlet løntræk for et hold uden pensionister er uændret (bit-identisk).
- Ny worktree + ny branch `fix/4153-payroll-skips-retiring-riders`, egen PR, `fix(economy): ... (Refs #4153)`. Læs `docs/GAME_INVARIANTS.md` (finalization-paths) før du rører transitionen.
- Ingen prod-kørsel, ingen refusions-script. Skriv i PR-body den read-only SQL, Claude kan køre før skiftet for at se hvor mange ryttere/hold og hvilket beløb rettelsen ville spare ved S3→S4.
- Patch note: skriv et EN/DA-udkast på to linjer i PR-body; ejeren afgør om det kommer med.

Samme verifikation og aflevering som opgave 1 (TIER FULL, tabel, vent på "merge").

## 3. Arbejdsform hele sessionen

- Én beslutning ad gangen til ejeren, med tal og kontekst i selve spørgsmålet, i almindeligt sprog. Tekniske valg tager du selv.
- Spørg ved 70-95 % sikkerhed. Under 70 %: undersøg først. Over 95 %: gør det. Genåbn aldrig en låst ejer-beslutning (140, realisme-reglen, sweepens tidspunkter, #1155-rækkefølgen).
- Tidsstempler i dansk tid (Europe/Copenhagen); kør `Get-Date` før du logger noget.
- Aldrig `git diff` uden `--no-pager`, aldrig `gh pr checks --watch` i forgrunden. Lokalt verify → push → videre; tjek CI bagefter med `gh pr checks <nr>`.
- Finder du noget uden for scope: søg dubletter (`gh issue list --search`), opret ét issue i klar tekst, fortsæt. Ret det ikke i samme PR.
- Status hvert 45. minut, også når intet er færdigt: gjort, næste, blokerer.

## 4. Close-out (obligatorisk, uanset hvor langt du nåede)

1. Alt committet + pushet; worktree efterlades ren.
2. Kommentar på #4847 (og #4153 hvis rørt): tabel med del | status | verificeret hvordan | udestår. Postmortem ved bugfix: `.claude/learnings/2026-09-20-<slug>.md`.
3. Nulstil `🤖 Working agent` til `Ingen aktiv session` i `docs/NOW.md` og push (kun det felt).
