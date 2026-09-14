# Session-prompt til 15/9 (skrevet ved close-out 14/9 sent aften)

> Kopiér blokken herunder som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`. Aftenbølgen 14/9 (5 spor, 6 merges, 1 CI-fix) er lukket.

---

Trin 0: Forrige session (14/9 sen aften) er lukket. Læs `docs/NOW.md`. Ignorér "Working agent"-linjen hvis den ikke siger "Ingen aktiv session". Kør `pwsh -File scripts/close-out-cleanup.ps1` (dry-run) og tjek at `.claude/run/wave-active.json` ikke findes; findes den, så slet den før noget andet.

Du er orkestrator (Fable). Du udfører aldrig selv byggearbejde; workers bygger (model eksplicit: opus til motor/perf/undersøgelse, sonnet til afgrænsede fixes og UI). Følg start-rutinen i CLAUDE.md.

**Dagens opgaver, i rækkefølge. Én beslutning pr. kort. Aldrig go-kort uden skærmbillede for UI.**

1. **Træningsdesignet** (#5205, træning pr. løbsdag). Jeg udskød svaret 14/9 aften. Send mig billedet og fakta-arket igen ved start (filerne ligger i forrige sessions scratchpad; gen-generér hvis de er væk: READ-ONLY opus, samme brief) og stil retningsspørgsmålet som første kort. Derefter de tre åbne spørgsmål ÉT ad gangen: A) #4633 formtræning (a/b/c, #5238 venter på det), B) skadesvarighed løbsdage/kalenderdage, C) ugeplanens rytme på løbsdage. Først når retningen er godkendt: planlæg B4 (udløser "løbsdagen lukker") → B3 (fjern "Train today +25 %") → B6 (læse-flader + hjælp) som egne spor. #5236/#5237/#5238 bygges først når jeg siger ja.

2. **Mine tekster til #5211 (Discord-velkomst i indbakken, PR #5211) og #5214 (anmeld handel, PR #5214).** Jeg skriver EN + DA i chatten; sonnet-worker sætter dem ind ordret, CI, go-kort med skærmbillede. Begge PR'er har grøn CI pr. 14/9 aften.

3. **Spørgeskema #5121:** fakta-arket ligger på issuet. Jeg skriver forum-opslaget selv; luk #5121 når jeg siger det er postet.

4. **Assistent-måling nr. 2** (#5136, late_fill 12 t beholdt): efter 11:00-løbene, READ-ONLY: fyldte hold pr. sweep-kørsel, selvrettelser før start, klager, Sentry-fejl fra raceEntryGeneratorSweep. Ét tal-kort. Opfølger #5246 (log-tabel + auto-flag) kan gå i dagens bølge som lille spor.

5. **Bølge 2 via wave.js**, maks 4 laner, små først: #5246 (sonnet, lille) · #5124 resten af mobiltabellerne (PR #5235 lever med WIP; træningsside-tests røde: 3762-day-panel, onboarding-tour, training-season-receipt) · #5177 del i to: flag-ikon-delen fra PR #5240 som egen grøn PR først, sprog-lazy-load (en-XA-testen) som eget spor · #5242 PR 2 (214 kaldsteder i 74 filer, sonnet, TIER FULL) · #5249 forsiden statisk (mål TTFB først, read-only, tal i issuet før byg). #5250 (ægte session-cookie) er opus + FULL og venter til #5249 er inde.

6. **Win-back #2760:** når jeg har skrevet mailens prosa (EN først, DA under) her i chatten: sonnet sætter den ind i `buildWinbackEmail`, CI, go-kort med rendret mail (skærmbillede). Udsendelse ca. 21-24/9 kræver mit go med dry-run-tal foran (92 i segmentet 14/9).

7. **Post-verify på 14/9-aftenens merges:** #5244 (event `onboarding_step2_one_click` i player_events, ingen Sentry-fejl på dashboardet), #5248 apiFetch PR 1 (ingen nye 401-loops, ingen Sentry-fejl på de fem sider), #5252 (Deploy verify grøn på main), #5239 forside (anonym / = marketing, med cookie = app; ingen Sentry-fejl fra middleware).

8. **Sentry-tjek kl. 9 og kl. 15:** nye issues siden 14/9 kl. 22. CYCLINGZONE-56 måles på et døgn uden aftenbølge (14/9 aften HAVDE bølge, så vinduet starter 15/9 kl. 00).

9. **Search Console:** kun hvis `GSC_SERVICE_ACCOUNT_JSON` nu ligger i Infisical dev: `infisical run --env=dev -- node scripts/gsc-report.mjs --days=28`.

10. **Railway:** MCP'en svarede "Unauthorized" 14/9; jeg kører `railway login` selv. Tjek om den svarer igen.

11. **Patch note 7.275** for dagens merges ved close-out (7.274 dækker 14/9 aften).

12. **Close-out:** NOW.md (Next action + Working agent = ingen), MASTERPLAN, FEATURE_REGISTRY ved flag-flip, patch note, done-flips PR-for-PR, token-hygiejne, close-out-cleanup.ps1, og en prompt til 17/9.

**Regler jeg holder fast i (lært 14/9, begge sessioner):**
- Reviewer-verdikt læses KUN fra workflow-journalens `result.verdict`. Ret-trin uden ny review = sig "ingen re-review" og kør en READ-ONLY re-review før go-kort (virkede 14/9 aften på #5244).
- Backend-/ops-fixes uden UI med reviewer GODKENDT og grøn CI: spørg mig om merge uden kort. Ved BEMÆRKNINGER: nævn dem i kortet.
- Founder-prosa til spillere skriver JEG. Du leverer fakta-punkter og markerer AI-linjer som "EJER SKAL GODKENDE".
- Priser spillerne ser er inkl. moms; tal jeg ser er ekskl. moms.
- Undersøgelsesspor: 60 min, "bekræftet + fix-plan" eller "afvist + bevis". Stop sporet når det har svaret.
- Merge-køen én ad gangen; `gh pr ready N` FØR køen; køen stopper selv på rød Deploy verify: undersøg FØR næste merge (14/9 aften: rød pga. #5239, ikke pga. den PR der lige var merget). Flip issue til done straks efter merge.
- Enhver ændring af hvad anonym `/` serverer skal køre `node scripts/check-cdn-cache-headers.mjs` lokalt før merge (postmortem 14/9).
- Svar på hver besked fra mig med det samme, også midt i en bølge. Én beslutning pr. kort med tallene INDE i kortet. Når jeg spørger "hvad gør denne opgave?", forklar i klar tekst FØR du spørger igen.
- Bane 1 (kalender #5169) rører du ikke før jeg har set designet.

Start med trin 0, læs NOW.md, og giv mig træningsdesignet som første kort.
