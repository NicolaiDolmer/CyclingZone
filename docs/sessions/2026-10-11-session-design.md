# Næste session (fra 11/10): design, ejer-godkendt 10/10 aften

Designet i samtale med ejeren 10/10 kl. 19-20. Alle punkter her er ejer-beslutninger. Genåbn dem ikke; spørg kun om det, der står som åbent.

## Mål (rækkefølge = prioritet)

**Løbsmotoren først.** Den rene motor-revision (`official_times_v3`, spec `docs/superpowers/specs/2026-10-10-ren-motor-revision-design.md`, plan `docs/superpowers/plans/2026-10-10-ren-motor-revision.md`) gøres færdig, bevises og tændes så hurtigt som muligt. Tidsplanen er "så hurtigt som muligt, så tager vi den derfra", altså ingen dato-løfter. Touren (start 11/10 11:00) kører på `official_times_v2` og skifter ikke midt i.

## Form

- Én hovedsession med motoren som hovedopgave + **én bølge med sidespor** (ejer-valg A). Én merge-kø.
- **Kombinationen (ejer-regel):**
  1. Motoren har altid førsteret til byggekraft og merge-kø.
  2. Spillernes klager og dato-løfter kører som sidespor.
  3. Nye roadmap-features kun, hvis en lane ellers står tom, og aldrig noget, der rører motoren.
  4. **Udvikling 2.0 (#6110), også designkortene, starter først, når motoren er live.** Første opgave derefter: #6403/#5842 (værdier og evner ved sæsonskiftet, frist 25/10).

## Motoren: vejen til tænding

1. **Ret #6431 (spor 1):** efter merge af form (#6430) fejler `breakawaySize6201.test.ts:305`: flad median 2,5 på Giro-feltet (mål 3-6). Samspil mellem form og spor 1's udbrudsdannelse. Merge derefter (slukket revision).
2. **#6434:** forbind `sprintTrainLeadoutOrder` i `aiTactics.ts` under v3.
3. **Luk #6397** (indeholdt i sporene) efter #6431.
4. **Motor-testbænken (ejer-valg, bygges):** en privat Artifact-side, der kan deles med staff og aldrig er spillervendt:
   - Hundredvis af **skyggeløb**: alle rigtige prod-etaper fra de sidste dage + Touren, genkørt med rigtige felter og ordrer under `official_times_v2` og `official_times_v3`, flere seeds, kun læsning.
   - Claudes dom øverst (bedre / værre / i tvivl, med links til beviser).
   - Side om side pr. etape: vinder, nr. 10/30, udbrud, grupper, bedste klatrer, farvet mod ejerens låste mål og virkeligheden. Filter på profil, løb og division.
   - Kommentarer pr. etape (ejer og staff), som Claude læser og svarer på. Anonymiser holdnavne med ét klik.
   - Opdateres ved hver ny revision på samme link.
5. **Gaten** (`backend/scripts/dev/cleanRevisionGate.mjs`, 7 trin) skal være grøn. Dagens prod-fund indgår som målepunkter:
   - Kuperet endagsløb: udbrud med 9-16 min (#6428).
   - Bjerg/nedkørsel: nr. 10 4-6,5 min.
   - Lang slutstigning: nr. 30 12-21 min (for stort).
   - Fixture-feltet: nr. 10 0:13 (for samlet).
6. **Fable-dom** på hele revisionen.
7. **Ejeren ser testbænken og siger "tænd".** Intet tændes automatisk (ejer-regel 10/10). Flip-PR, migration til `races_engine_rules_revision_check`, `ORDERS_GC_LINEAGE`, RULES/help (EN+DA), patch note. Verificér de første løb på hver profil i prod.

## Sidespor (bølgen), i rækkefølge

1. **Træning (alle 4 ejer-valgt):**
   - Train now træner kun 4 af 5 løbsdage, og knappen gør intet omkring kl. 20. Opret issues, de findes ikke.
   - Kompensations-modsigelsen: #6061 siger live, #6129 siger intet anvendt. Tjek prod og luk ærligt.
   - Rapport og hjælp: point vs. procent (#6208), løbsdag-numre (#5915, #6242).
   - Bekvemmelighed: sortering og hover (#6176), kryds-af-valg (#6303), egomadsens 3 forslag 7/10 (opret issue).
2. **CodeQL: 3 åbne fund på main.** Escaping i `scripts/chunk-errors-per-release.mjs:113` (fra #6398) og to ineffektive regexer i `scripts/ci/cron-deploy-verification.mjs:48/:297`.
3. **10 spillersvar** skrevet færdige i ejerens stemme. EN, eller DA i danske kanaler, TONE_OF_VOICE. Ejeren poster selv. Plus kort staff-udmelding om form: "form kommer med i den store motoropdatering, formtoppe i S5". Kilde: spillerfeedback-rapporten 10/10, se nedenfor.
4. **S5-kalender + etapeprofiler** (#5841, #6369), frist 18/10.
5. **Sæsonskifte-plan S4→S5** (frist 25/10): dry-runs, liga-pyramide (#5669), kalender-gate.
6. **Løfter, der er overskredet:** #3984 (indstillingsside + nationalitet) og #4714 (12-timers minimum). Én beslutning fra ejeren hver, så bygges de.
7. **Chunk-fejl (#5162)** måles med beviset fra #6398. Feature-registeret rettes (træningsflag `beta`→`live`, `ai_pool_retirement_v2_enabled` `building`→`live`). Databasevagten #6426 merges, når secrets findes (secrets-sessionen).

## Faste regler (fra dagens faldgrupper)

- **En UI-PR kaldes aldrig klar uden et rigtigt skærmbillede fra en kørende side og grønne e2e-tests.** 10/10 var 4 billeder tegninger, og én PR crashede /training (`.claude/learnings/2026-10-10-tailwind-class-as-js-expression-crashed-training-page.md`).
- **Én merge-kø, ingen automatiske kæder.** Den næste starter efter task-notifikationen (`.claude/learnings/2026-10-10-chained-merge-queues-fired-early-on-grep.md`).
- **Ingen tidsløfter.** Sig næste checkpoint og hvad der er færdigt (ejeren 10/10: skønnene rammer forkert).
- **Ingen `npm ci` i et worktree med junction-node_modules** (`.claude/learnings/2026-10-10-npm-ci-in-worktree-wipes-shared-node-modules-cache.md`). Nye worktrees: junction til cachen (frontend) og hovedcheckoutens rod-node_modules (hooks).
- **CodeRabbit-loft:** et uafhængigt Claude-review pr. PR tager over (ejer-valg B, ingen ny udgift).
- **Ét spørgsmål ad gangen, kort, med billede som fil.** Ejeren poster selv på Discord. Claude poster aldrig.
- Ingen PR-loft (ejer 22/9, #5510, genåbnes ikke).

## Succes (ejer-godkendt)

1. Testbænken er live med hundredvis af skyggeløb og Claudes dom.
2. Gaten er grøn (alle 7 trin), inkl. #6434 og spor 1's flade udbrud.
3. Ejeren har set testbænken og sagt "tænd". Den rene revision kører på nye løb, verificeret i prod på hver profil.
4. Træningsklagerne er rettet eller ærligt besvaret, og de 10 spillersvar ligger klar.
5. CodeQL har 0 åbne.

## Ikke i denne session

- Udvikling 2.0 (efter motor-live).
- Betaling og moms (#4511, #4514, #4512) + billing-watch-alarmen: egen session mandag.
- Transfersum før skift (#6181): efter motoren.

## Kilder fra 10/10

- Spillerfeedback 3/10-10/10: top 8 = motor (11 spillere), træning (9), udvikling (9), bestyrelse (8, leveret), ungdom (5), penge (4), taktik (3), scoutrapport (2). Råudtræk lå i session-scratchpad (ikke i repo). Ventende svar: #6385, #6302, #6303, #6242, #6384, #6422, #6207, #6206 + Train now 4/5 og kl. 20 + staff om form. Kan lukkes nu: #6238 (magwag1) og #6320 (egomadsen).
- Beta 10/10: intet i beta i prod; træningsflag on siden 9/10 23:22.
- Discord: 7.351 + 7.352 (+ 7.353) ligger klar i `docs/drafts/discord-patch-7351-7353.md`. Ejeren poster selv.
