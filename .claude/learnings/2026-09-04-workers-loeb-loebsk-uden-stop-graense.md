# Tre workers løb løbsk i samme session, orkestratoren reagerede først da ejeren spurgte (4/9 2026)

**Symptom:** Ejeren: "Hvorfor er der nogle opgaver der har kørt i omkring 2 timer? Det er da alt for lang tid?" Tre baggrunds-workers havde overskredet enhver rimelig grænse:
1. Mobil-mockup (sonnet): 4 timer uden leverance. En erstatning med stramt scope leverede på 1 minut.
2. "Markér alle som læst" (sonnet): 80+ min, kørte `verify-local.ps1` + fuld e2e + snapshot-refresh i alle 3 Playwright-projekter, selvom prompten sagde targeted verify. Stoppet; en finish-worker lavede PR'en på 30 min.
3. #3512 test-fix (sonnet): 1 t 45 min, 55 min uden push, ét lokalt WIP-commit i et worktree der var ude af sync med origin (kunne ikke pushes).

**Rod-årsag:**
- Orkestratoren (Fable) overvågede kun via completion-notifikationer, ikke via branchens sidste push. Den eksisterende regel (45 min tavshed → status, +15 → TaskStop) blev ikke håndhævet, fordi ingen kiggede på uret.
- Workers falder i verify-loops når `verify-affected.mjs` svarer "TIER FULL": de tolker det som mandat til fuld suite trods prompt-instruks.
- Åbne, brede prompts ("lav en mockup ud fra koden") uden tool-kald-budget lader en worker læse i timevis.

**Regel fremover (bidt 4/9, føj til orkestrator-rutinen):**
1. Hvert worker-prompt får et hårdt budget: "maks N tool-kald / M minutter; push hvert 15. min; stop og rapportér ved 45 min uanset status".
2. Skriv eksplicit i verify-instruksen: "Siger `verify-affected.mjs` TIER FULL, så rapportér det i PR-body og kør IKKE fuld suite; orkestratoren ejer e2e-slottet."
3. Orkestratoren tjekker `git log -1 origin/<branch>` for alle aktive worker-branches ved hver ejer-interaktion (ét Bash-kald), og TaskStop'er alt uden push i 45 min.
4. Research-/mockup-workers: haiku eller sonnet med "maks 12 tool-kald", aldrig åbent scope.
