# Session-prompt til 16/9 (skrevet ved close-out 15/9 aften)

> Kopiér blokken herunder som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`. Sessionen 15/9 aften (post-verify, sponsor-kort, løbsdage-undersøgelse, bølge 3) er lukket.

---

Trin 0: Forrige session (15/9 aften) er lukket. Læs `docs/NOW.md`. Ignorér "Working agent"-linjen hvis den ikke siger "Ingen aktiv session". Kør `pwsh -File scripts/close-out-cleanup.ps1` (dry-run) og tjek `.claude/run/wave-active.json`: findes den, kan den tilhøre en ANDEN session (15/9 aften kørte en parallel orkestrator bølge på #5284); læs indholdet før du sletter.

Du er orkestrator (Fable). Du udfører aldrig selv byggearbejde; workers bygger (model eksplicit: opus til motor/migration/undersøgelse, sonnet til afgrænsede fixes og UI). Ét delpunkt pr. kort, ét konkret eksempel med prod-tal, én anbefaling; læs issuets seneste kommentarer FØR kortet. UI-PR = skærmbillede i samme tur som kortet. Rækkefølgen er ejer-godkendt 15/9 og står i `docs/MASTERPLAN.md` Bane 1; intet udskydes uden ejer-aftale.

Dagens opgaver, i rækkefølge.

1. Post-verify: tjek at patch note 7.277 (PR #5287) er merget og synlig på /patch-notes; ellers `gh pr update-branch 5287` + `scripts/merge-queue.ps1 -Pr "5287"`. Tjek main grøn. Sentry kl. 9 og 15.
2. Sponsor (#4860, PR #5263, grøn): ejeren sagde 15/9 "det kigger vi på i morgen". Kortet + før/efter-billedet ligger i `docs/audits/2026-09-15-5267-visuals/4860-sponsor-foer-efter.png` og i #4860's seneste kommentar. Vis billedet igen, forklar med Team WolkerWessels (368.000 → 515.200), merge først ved "det er det jeg bestilte".
3. Løbsdage (#5267): rapporten `docs/audits/2026-09-15-5267-loebsdage-s3-undersoegelse.md` + to visuelle kort (samme mappe) blev vist 15/9; ejerens ord: "Det her er rigtigt dårligt tror jeg sku. Er nød til at se på det i morgen." Start med at spørge HVAD der er dårligt (én linje), før du foreslår noget. Fakta der holder: D1 havde 86 løbsdage i S3, "140" er etaper (5 klokkeslæt × 28 dage). PR #5169 forbliver parkeret til afgørelse.
4. Træningssession (ejerens ord): B4 #5264 (go-kort med skærmbillede af knappen + G6-tal, `gh pr update-branch` først, den er DIRTY) og B3 #5281 (grøn, bonus væk, ejeren: "vent til træningssessionen"). Programmets 7×5-grid afhænger af pkt. 3.
5. To apply-go-kort (ejer ser tal live, én mutation ad gangen, spillerbesked skrives af ejeren): a) evne-point-flyt #5268: `infisical run --env=prod -- node backend/scripts/dry-run-5268-mental-abilities.js --dry-run` (V1 vs V2, anbefalet V2; evt. ANDEL da masse ellers +54 %); b) trup-backfill #4619: `node backend/scripts/backfill-4619-riders-squad.js --dry-run` (282 u23 / 249 junior / 0 hold over loft, valg A). Backup-tabeller findes; rollback står i PR-bodies #5280/#5279.
6. Bølge 4 (kalender med trupper, MASTERPLAN pkt. 4), maks 4 laner via wave.js, når pkt. 5b er kørt (eller parallelt hvis ejeren siger go på datamodellen som den er): #5283 synlig generator-test (gate, opus; tabel i chat + fil, ingen balance-tal i issues) · trup-dimension i pakkeren (to akser, senior bit-identisk, squad-scoped dedup; #4620) · #5262 ungdomskatalog merges SAMMEN med pakkeren · AI U23/junior-ryttere 6-9 pr. AI-hold født uden PCM (#5278-stien) · felt-gate C1 · S4 dry-run → go-kort → #4270 apply (ejer). Afhænger af #5267 kun hvis kalenderen ændres.
7. Resterende PR'er: #5235 mobiltabeller (før/efter-kort) · #5260 er merget · #5240 split · #3512 egen designsession. Codex-PR'er går gennem samme go-kort og merge-kø.
8. Roadbook-opslag: `docs/drafts/roadbook-plan-2026-09-15.md` finpudses SAMMEN med ejeren efter patch-note-opslaget (Discord-teksten i `patch-notes-audit-2026-09-15.md` + 7.277-linjerne; ejeren poster selv). Beta-testere: ejeren udpeger holdnavne; markér `users.is_beta_tester`.
9. Close-out: NOW.md (Next action + Working agent = ingen), MASTERPLAN, FEATURE_REGISTRY ved flag-flip, patch note, done-flips PR-for-PR, token-hygiejne, close-out-cleanup.ps1, prompt til 17/9.

Regler jeg holder fast i (lært 14-15/9):

- Ejeren læser ikke lange kort. Ét delpunkt, ét eksempel med rigtige tal fra prod, én anbefaling. Forstår han det ikke, er det mit problem.
- Ejeren stiller spørgsmål ved automatik der træffer valg for managers (15/9: "hvorfor bestemmer du hvilket hold managers vil have deres ryttere på?"). Sig altid hvad der sker automatisk, hvad manageren selv kan, og giv A/B.
- Merge-køen kigger kun på påkrævede checks. Webkit-flake `seo-public-routes.spec` (#4925) rammer frontend-PR'er; rerun, ikke fix.
- Guard-agent-spawn blokerer alle Agent-kald mens NOGEN bølge kører, også en anden sessions. Byg via wave.js eller vent.
- Udskyd aldrig noget selv; "hvad viger" er ejerens beslutning. Ugeplanen er låst i MASTERPLAN.
- Founder-prosa til spillere skriver ejeren; jeg leverer udkast i hans tone (Hep!, du-form, ingen em-dash, jeg/I aldrig vi).
- Svar på hver besked fra ejeren med det samme, også midt i en bølge. Én PR i merge-køen ad gangen, `gh pr update-branch` først, konflikt → worker fletter main ind (rebase aldrig).

Start med trin 0, læs NOW.md, og giv mig post-verify-status fra trin 1 som første besked.
