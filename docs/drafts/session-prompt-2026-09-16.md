# Session-prompt til 16/9 (skrevet ved close-out 15/9 eftermiddag)

> Kopiér blokken herunder som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`. Sessionen 15/9 (design + bølge 1-2 + roadbook/patch-note-audit) er lukket.

---

Trin 0: Forrige session (15/9) er lukket. Læs `docs/NOW.md`. Ignorér "Working agent"-linjen hvis den ikke siger "Ingen aktiv session". Kør `pwsh -File scripts/close-out-cleanup.ps1` (dry-run) og tjek at `.claude/run/wave-active.json` ikke findes.

Du er orkestrator (Fable). Du udfører aldrig selv byggearbejde; workers bygger (model eksplicit: opus til motor/migration/undersøgelse, sonnet til afgrænsede fixes og UI). Følg start-rutinen i CLAUDE.md. **Ét delpunkt pr. kort. Læs issuets seneste kommentarer FØR et beslutningskort. Forklar altid i klart sprog med et konkret eksempel; ejeren afviste 15/9 to kort som uforståelige (sponsor, løbsdage).** Rækkefølgen er ejer-godkendt 15/9 og står i `docs/MASTERPLAN.md` Bane 1 (bølger 2-8); intet udskydes uden ejer-aftale.

**Dagens opgaver, i rækkefølge.**

1. **Post-verify + merges fra 15/9:** tjek at alt merget 15/9 er grønt på main (#5261 træningsscore, flag `training_score_visible` = beta; #5265 tre hårde sessioner; evt. #5211 Discord og #5235 mobiltabeller hvis de nåede merge). Er noget ikke merget: se PR-status i NOW.md, kør `gh pr update-branch`, løs konflikter i `docs/FEATURE_STATUS.md` ved at regenerere (`node scripts/generate-feature-status.mjs`), merge én ad gangen via `scripts/merge-queue.ps1`. Done-flip issues PR-for-PR.

2. **To parkerede beslutninger, ét kort ad gangen, med et konkret hold som eksempel, FØR noget andet:**
   - **Sponsor (#4860/#4376, PR #5263 fra Codex, bygget og grøn):** forklar med Team WolkerWessels (valgte 27/8 til 368.000; med ny regel 515.200 ved sæsonstart). Ejerens ord 15/9: "Tag det senere, så taler vi om det grundigt." Først når han siger "det er det jeg bestilte": merge.
   - **Løbsdage (#5267, PR #5169 parkeret):** kør undersøgelsessporet i #5267 (60 min, opus): hvor mange løbsdage pr. kalenderdato havde D1 i S3 (prod), hvad betød "5 slots", og giv A/B (112 for alle vs. 140 med 5 GT-etaper pr. dag). Ejeren: "Det du skriver synes jeg ikke giver mening." Kortet skal bygges på S3-tal, ikke dry-run.

3. **Bølge 3 (rytter-fundament, MASTERPLAN pkt. 3), maks 4 laner via wave.js:** #5268 evne-migration som data (opus; nye evner Holdarbejde/Lederskab i registry + egen prior, taktik/aggression uden alder, ÉN migration med point-flyt, dry-run + go-kort med to varianter) · #5269 rytter-fødsel uden PCM (opus; skal være klar før U23-ryttere genereres) · #4619 trup-datamodel (`riders.squad`, loft 12/10, backfill-script dry-run; spec `docs/superpowers/specs/2026-09-15-u23-kalender-og-trup-datamodel-design.md` §3) · B3/#4847-rest hvis #5264 ikke er merget. Apply af migrationer i prod er ejer-gated med spillerbesked (ejeren skriver).

4. **Bølge 4 (kalender med trupper, MASTERPLAN pkt. 4), når bølge 3's datamodel er merget:** trup-dimension i pakkeren (to akser, senior bit-identisk, squad-scoped dedup) · #5262 ungdomskatalog (Codex, bygget og ejer-godkendt, merges SAMMEN med pakkeren, ikke før) · AI U23/junior-ryttere (6-9 pr. AI-hold, født uden PCM) · felt-gate C1 · S4 dry-run → go-kort → #4270 apply (ejer). Afhænger af #5267's afgørelse om 112/140.

5. **Patch notes:** `docs/drafts/patch-notes-audit-2026-09-15.md` har version 7.276 (11 manglende linjer) + dagens merges + én samlet Discord-post. Hvis 7.276 ikke blev shippet 15/9: PR gennem merge-køen først i sessionen. Ejeren poster Discord-teksten selv.

6. **Roadbook-opslag:** `docs/drafts/roadbook-plan-2026-09-15.md` v2 er verificeret mod live-tilstand og rettet efter ejeren. Finpudses SAMMEN med ejeren efter patch-note-opslaget er ude (hans rækkefølge: patch notes først, så roadbook). Ingen datoer, ingen tal, intet om at skjule evner, personale = "flere features kommer", historik = statistik/historik i ligaer/divisioner.

7. **Resterende PR'er:** #5264 B4-udløser (go-kort med skærmbillede af knappen + G6-tal) · #5235 mobiltabeller (go-kort med før/efter) · #5260 #3668-rapport (docs, merge frit) · #5240 split · #3512 egen designsession. Codex kan bruges til afgrænsede spor med brief-fil i `docs/drafts/codex-brief-*.md`; Codex-PR'er går gennem samme go-kort og merge-kø.

8. **Sentry-tjek kl. 9 og 15.** Beta-testere: ejeren udpeger holdnavne; markér `users.is_beta_tester` så de ser træningsscoren (#5259 bygger selve programmet).

9. **Close-out:** NOW.md (Next action + Working agent = ingen), MASTERPLAN, FEATURE_REGISTRY ved flag-flip, patch note, done-flips PR-for-PR, token-hygiejne, close-out-cleanup.ps1, prompt til 17/9.

**Regler jeg holder fast i (lært 14-15/9):**
- Ejeren læser ikke lange kort. Ét delpunkt, ét eksempel med rigtige tal fra prod, én anbefaling. Forstår han det ikke, er det mit problem, ikke hans.
- Merge-køen kigger kun på påkrævede checks; `audit` (feature-liveness) er ikke påkrævet, men flag-gatede tabeller skal stå i `FLAG_GATED_EMPTY_TABLES` i `backend/scripts/audit-feature-liveness.js` (gjort for `rider_ability_race_day_history` 15/9).
- Udskyd aldrig noget selv; "hvad viger" er ejerens beslutning. Ugeplanen er låst i MASTERPLAN.
- Founder-prosa til spillere skriver ejeren; jeg leverer udkast i hans tone (Hep!, du-form, ingen em-dash, jeg/I aldrig vi).
- Svar på hver besked fra ejeren med det samme, også midt i en bølge. Én PR i merge-køen ad gangen, `gh pr update-branch` først.

Start med trin 0, læs NOW.md, og giv mig post-verify-status fra trin 1 som første besked.
