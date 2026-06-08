**Brief til #1103: Relaunch-orchestrator + founder-badge (frisk sæson 1)**

**Mål:** Implementer `backend/scripts/relaunchSeason1.js` som en ny orchestrator, der udfører en komplet nulstilling og genopbygning af spillets tilstand til en frisk sæson 1. Inkluder fiktiv population, backfill af evner og tildeling af founder-badges.

**Runtime-evidens:**
*   `backend/lib/betaResetService.js`: Indeholder eksisterende reset-logik for marked, rosters, balancer, board-profiles, race-kalender, transfer-arkiv, lån, notifikationer, sæsoner og manager-progress. Genbrug disse funktioner [4].
*   `backend/lib/fictionalLaunchPopulation.js`: Definerer `LAUNCH_POPULATION` med `seed: 2026`, `count: 800`, `referenceYear: 2026`. Orchestratoren SKAL importere disse parametre direkte for at sikre reproducerbarhed af sæson-1 populationen [5].
*   `backend/scripts/generateFictionalRiders.js`: Kan bruges som reference for CLI-wrapper og `--dry-run` funktionalitet, men `fictionalLaunchPopulation.js` er den kanoniske kilde for launch-parametre [6].
*   `backend/lib/seasonTransition.js`: Overvej genbrug af eksisterende sæson-transitionslogik for at oprette den nye sæson 1 [7].

**Invarianters der beskyttes:**
*   Brugerkonti bevares (kun game-state nulstilles).
*   Founder-badges tildeles korrekt og overlever fremtidige resets.
*   Ingen rigtige navne er aktive; kun fiktive ryttere i markedet.
*   Data-integritet på tværs af Supabase-tabeller efter reset.

**Minimal change:**
*   Fokus på at orkestrere eksisterende `betaResetService` funktioner og integrere `fictionalLaunchPopulation.js` for at opnå målet. Undgå at genopfinde hjulene.
*   Implementer `founder_badge` som en ny `achievements`-definition og indsæt i `manager_achievements` for beta-testere, der undtages fra `resetBetaAchievements`.

**Verification path:**
*   Kør hele sekvensen på en preview-DB (dry-run → rigtig). Verificer:
    *   Reset → population → backfills → sæson 1 er korrekt udført.
    *   Ingen legacy-ryttere (`pcm_id IS NOT NULL`) er aktive.
    *   Founder-badges er tildelt korrekt og forbliver efter reset.
    *   Rollback-sti er dokumenteret (legacy-ryttere kan re-aktiveres).
