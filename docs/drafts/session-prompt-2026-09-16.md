# Session-prompt til 16/9 (skrevet ved close-out 15/9 formiddag)

> Kopiér blokken herunder som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`. Sessionen 15/9 (kort, design + PR-gennemgang + audit) er lukket.

---

Trin 0: Forrige session (15/9 formiddag) er lukket. Læs `docs/NOW.md`. Ignorér "Working agent"-linjen hvis den ikke siger "Ingen aktiv session". Kør `pwsh -File scripts/close-out-cleanup.ps1` (dry-run) og tjek at `.claude/run/wave-active.json` ikke findes.

Du er orkestrator (Fable). Du udfører aldrig selv byggearbejde; workers bygger (model eksplicit: opus til motor/perf/undersøgelse, sonnet til afgrænsede fixes og UI). Følg start-rutinen i CLAUDE.md. **Ét delpunkt pr. kort** (lært 15/9: et kort med tre nummererede punkter blev afvist). **Læs issuets seneste kommentarer FØR et beslutningskort** (15/9: #4633 var allerede besluttet 14/9, NOW.md var stale).

**Dagens opgaver, i rækkefølge.**

1. **Post-verify #5258** (main grøn igen + migration #4846): `schema_migrations` har `database/2026-09-14-4846-training-tick-game-day.sql`, 2 partielle unikke indexe på `training_day_runs`, tabellen `rider_ability_race_day_history`, `app_config.training_tick_per_race_day = off`, CI på main grøn. Rød? Undersøg før noget andet.

2. **Bølge 1 via wave.js (maks 4 laner), træningens byggeplan efter ejer-beslutningerne 15/9** (`docs/TRAINING_RULES.md` §13.3, #4850 kommentar 15/9):
   - **#5169 → 140**: `SEASON_RACE_DAY_TARGET[4] = 140`, antal løb pr. division URØRT, tomme-løbsdags-budget pr. kalenderdag hævet til 5; dry-run-tabel i PR-body; derefter go-kort (ikke UI, ejer-go på tal). Opus.
   - **B4 udløser** (#4847-området): ÉN samlet sweep for alle dagens løbsdage, tidligst kl. 20 dansk tid og efter dagens sidste finalization; frivillig knap "Kør dagens træning nu" uden bonus (åbner når dagens sidste løb er lukket); deleren kalibreret til 140; G6-kapacitetstest (skrivetryk ≈ 5×) som krav i PR'en. Opus, TIER FULL.
   - **Skader i løbsdage** (beslutning 7): `injured_until` i løbsdage, UI "ca. <dato>". Sonnet.
   - **Program pr. løbsdag** (beslutning 8): `training_week_plans` får slot-dimension (7 × 5 = 35 celler), ugedagens session som default i alle 5 slots, migration af 27 holds data; UI-grid mobil-først (D-047). Mockup FØRST, go-kort med billede før byg. Sonnet.
   Efter disse: B3 (fjern "Train today +25 %"), B6 (læse-flader + hjælp, træningssiden bygges ÉN gang; PR #4736 lukket 15/9, branchen bevaret), #5236/#5237/#5238 når ejeren siger ja.

3. **#4620 U23-kalender ind i Bane 1** (ejer 15/9: "byg med i S4-cutover"). Læs `docs/YOUTH_RULES.md` §2.3 + `docs/superpowers/specs/2026-09-02-akademi-tre-trupper-design.md` §6. Egen slice-spec FØR build; én løbsdags-akse pr. trup, samme 140-mål. Første kort til ejeren: hvad viger i Bane 1 hvis det ikke når det (bestyrelses-flip #4857 eller cutover-pakken)? Ejeren rangerer, Claude skærer aldrig selv.

4. **Beta-adgang #5259** (ejer-ønske 15/9, høj prioritet): sonnet-lane, halv dag. Skærmbilleder admin + profil før go-kort.

5. **Resterende PR'er:** #5211 (Discord-velkomst: CodeRabbit CLI-review + FEATURE_REGISTRY → go-kort m. skærmbillede) · #5235 (mobiltabeller: PR'ens egne skærmbilleder viser overlap i rytter-cellen på træning + transfers, fix-spor før go-kort) · #5240 (split i to: flag-ikoner først, sprog-lazy-load som eget spor) · #3512 (ejeren vil have en EGEN designsession med spørgsmål ét ad gangen; ikke i denne session medmindre han beder om det).

6. **Global handelsliste #5257** (ejer 15/9): Bane 2, efter beta-adgang.

7. **Sentry-tjek kl. 9 og 15**; CYCLINGZONE-56 måles på døgn uden bølge (15/9 havde ingen bølge, kun 4 merges).

8. **Patch note 7.276** ved close-out for dagens merges (7.275 dækker 15/9: anmeld handel).

9. **Close-out:** NOW.md (Next action + Working agent = ingen), MASTERPLAN, FEATURE_REGISTRY ved flag-flip, patch note, done-flips PR-for-PR, token-hygiejne, close-out-cleanup.ps1, prompt til 17/9.

**Regler jeg holder fast i (lært 14-15/9):**
- Merge-køen: en PR grøn på sin egen base kan være rød mod main (ratchet fra #5248 fældede #5214 15/9). Før merge: `gh pr update-branch N` hvis branchen er bag main, og vent på ny CI. Postmortem: `.claude/learnings/2026-09-15-ratchet-stale-base-og-migration-name-array.md`.
- Migration-PR'er: post-verify STRAKS efter merge (auto-migrate fejlede 15/9 på `name[] = text[]`; fail-safe holdt).
- Reviewer-verdikt læses KUN fra workflow-journalens `result.verdict`.
- Founder-prosa til spillere skriver JEG. Priser spillerne ser er inkl. moms; mine tal ekskl. moms.
- Undersøgelsesspor: 60 min, "bekræftet + fix-plan" eller "afvist + bevis".
- Svar på hver besked fra mig med det samme, også midt i en bølge.

Start med trin 0, læs NOW.md, og giv mig post-verify-tallene fra trin 1 som første besked.
