# Session-prompt til 15/9 (skrevet ved close-out 14/9 aften)

> Kopiér blokken herunder som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`. Den bygger på hvad der virkede og ikke virkede i dagsbølgen 14/9 (11 merges, 9 spor, 2 spor stoppet ved loftet).

---

Trin 0: Forrige session (14/9 aften) er lukket. Læs `docs/NOW.md`. Ignorér "Working agent"-linjen hvis den ikke siger "Ingen aktiv session". Kør `pwsh -File scripts/close-out-cleanup.ps1` (dry-run) og tjek at `.claude/run/wave-active.json` ikke findes; findes den, så slet den før noget andet (bølgen 14/9 er slut).

Du er orkestrator (Fable). Du udfører aldrig selv byggearbejde; workers bygger (model eksplicit: opus til motor/perf/undersøgelse, sonnet til afgrænsede fixes og UI). Følg start-rutinen i CLAUDE.md.

**Dagens 13 opgaver, i rækkefølge. Én beslutning pr. kort. Aldrig go-kort uden skærmbillede for UI.**

1. **Spørgeskemaets fakta-ark** (#5121, lukkede 14/9 kl. 23:59). READ-ONLY opus-spor, 30 min: endelige tal + tabeller (metoden i docs/SURVEY_SYSTEM.md §5, sammenlign med 14/9-opsummeringen på #5121). Ingen prosa; jeg skriver forum-opslaget selv (forum = beslutninger, #4235). Luk #5121 når jeg har postet.

2. **Måling af assistent-flippet** (#5136, late_fill 12 t siden 14/9 kl. 14:41): hvor mange trupper blev fyldt, hvor mange managere rettede selv i en fyldt trup før start, klager i Discord/indbakke. Ét tal-kort. Rul KUN tilbage hvis jeg siger det.

3. **De to PR'er der venter på mine tekster:** #5211 (Discord-velkomst i indbakken) og #5214 (anmeld handel). Jeg skriver EN + DA i chatten; en sonnet-worker sætter dem ind ordret, CI, derefter go-kort med skærmbillede. #5214 har desuden to røde checks fra 14/9 aften der skal rerunnes (webkit-flake #4925 er den kendte).

4. **CodeQL #362** (#5230): 3-linjers rettelse i seo-public-routes.spec.js (startsWith → URL-origin). Første spor i bølgen, sonnet. Ingen kort nødvendigt: det er en test-fil; merge når CI er grøn og sig det til mig.

5. **Bølge 1 via wave.js** (den nye version fra #5228 med investigate-flag, blandet kø og livstegn-prik). Spor: #5230 (lille) · #5241 "Kør ugens træning" på kom-i-gang-kortet (sonnet, UI, jeg godkender de to nye tekster og ser preview før merge) · #2760 win-back-mail til de 92 sovende (sonnet: mailtype + én-gangs-udsendelse bag app_config, dry-run-tal, jeg skriver prosaen, udsendelse ca. 21-24/9 kræver mit go) · #4067 forsiden, tre rettelser på PR #5239 (fallback ved fejl/timeout, videresend UTM-query, Accept-Language da → /da) + nyt preview-bevis · #5242 koble apiFetch på resten af fetch-kaldene (sonnet, TIER FULL). Maks 4 laner, små først.

6. **Resterne fra 14/9's to stoppede spor,** som egne spor EFTER bølge 1: #5124 fire mobiltabeller (PR #5235, branch lever med WIP-commit 18:36; træning + transfers er bygget, træningsside-tests er røde: 3762-day-panel, onboarding-tour, training-season-receipt på mobil) og #5177 LCP-rest (PR #5240, flag-ikoner ude af den kritiske sti er klar; sprog-lazy-load vælter pseudo-sprog-testen en-XA på fire sider). Del #5177 i to PR'er: flag-delen først (grøn), sprog-delen som eget spor.

7. **Træningsdesignet** (#5205, træning pr. løbsdag, bag flag): vis mig designet (skærmbilleder fra preview + de tre nye pas #5236/#5237/#5238 som mockup) FØR noget bygges videre. Det er spørgeskemaets nr. 1 (træning 44 % "fungerer dårligst", "løbene træner dig" topscorer).

8. **Åbnere** (#5238) og **brosten + vifte** (#5236) og **angreb** (#5237) bygges først når jeg har sagt ja til #5205-designet. Ikke i dag medmindre jeg siger det.

9. **Post-verify på 14/9-merges:** #5108 påmindelsen (vises den gult/rødt hos rigtige managere, ingen fejl i Sentry), #5233 apiFetch (ingen nye 429/401-loops i Railway), #5122/#5123 (ingen Sentry-fejl på ønskeliste/løbsside).

10. **Sentry-tjek** kl. 9 og kl. 15: nye issues siden 14/9 kl. 18. CYCLINGZONE-56 (chunk-fejl) måles på et døgn UDEN aftenbølge; #5223/#5224 er lav prioritet.

11. **Patch note 7.274** for dagens merges ved close-out (7.273 dækker 14/9).

12. **Search Console:** hvis jeg har lagt `GSC_SERVICE_ACCOUNT_JSON` i Infisical, kør `infisical run --env=dev -- node scripts/gsc-report.mjs --days=28` og giv mig baseline før #5216-effekten.

13. **Close-out:** NOW.md (Next action + Working agent = ingen), MASTERPLAN, FEATURE_REGISTRY ved flag-flip, patch note, done-flips PR-for-PR, token-hygiejne, close-out-cleanup.ps1, og en prompt til 16/9.

**Regler jeg holder fast i (lært 14/9):**
- Reviewer-verdikt læses KUN fra workflow-journalens `result.verdict` (aldrig tekst-match i transcripts; postmortem 14/9). Sig "ingen re-review" når et ret-trin er kørt uden ny review.
- Backend-/ops-fixes uden UI med reviewer GODKENDT og grøn CI: spørg mig om merge uden kort. Ingen antagelse.
- Founder-prosa til spillere (indbakke, dialoger, mails) skriver JEG. Du leverer fakta-punkter og markerer AI-skrevne linjer som "EJER SKAL GODKENDE". Ingen "det er ikke X, det er Y".
- Priser spillerne ser er inkl. moms; tal jeg ser er ekskl. moms.
- Undersøgelsesspor: 60 min, "bekræftet + fix-plan" eller "afvist + bevis". Når et spor har svaret, stopper du det.
- Merge-køen én ad gangen; `gh pr ready N` FØR køen (den stopper nu selv på drafts). Flip issue til done straks efter merge.
- Svar på hver besked fra mig med det samme, også midt i en bølge. Én beslutning pr. kort med tallene INDE i kortet.
- Bane 1 (kalender #5169) rører du ikke før jeg har set designet.

Start med trin 0, læs NOW.md, og giv mig fakta-arket fra spørgeskemaet som første kort.
