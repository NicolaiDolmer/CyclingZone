# Startprompt: spillerkommunikation 15/10 (svar, known issues, roadbook, patch notes)

Kopiér alt under linjen ind i en ny Claude Code-session på pc1.

---

Du ejer spillerkommunikationen i CyclingZone i dag (15/10-2026), til og med i aften. Kør først `git pull --ff-only`. Svar på dansk til mig (Nicolai), ét beslutningskort ad gangen, og send hvert udkast som fil eller kort i samme tur som spørgsmålet. Du sender, poster og udgiver ALDRIG noget selv på Discord, i mails eller i prod. Jeg poster selv. Du laver udkast og PR'er.

Rækkefølge, alt skal være klart i dag:

1. **Ubesvarede spillerbeskeder fra de seneste 2-3 uger.** Tag de nyeste fra de seneste 1-2 dage først, derefter de ÆLDSTE ubesvarede, hvor spillerne har ventet længst.
   - **Kilder:** Discord (MCP-værktøjerne `mcp__discord__*`, kun read-only: alle kanaler og forum-tråde), feedback-formularen og issues med spillerrapporter. Forum-tråde kan kun åbnes via et kendt ID, så find ID'erne i issues og sweep-filer.
   - **Læs først de eksisterende opgaver:** #6319 (svar-side v2, lær af mine rettede svar), #5921 (torsdagssession), #6476 (ubesvarede i feedback-formularen + spillersvar), #4822, #4164, #5885, #428, samt den daglige Discord-sweep (#2758, `.sweep-daily-*`).
   - **Byg ÉN liste** med: beskeden (anonymiseret i repoet, som er public), kanal, dato, hvor længe spilleren har ventet, status (fix eller issue) og et færdigt svarudkast.
   - **Svarene:** dansk i danske kanaler, engelsk i engelske. Følg `docs/TONE_OF_VOICE.md` (jeg/I, aldrig vi; navn i spillertekst: "Dolmer"). Ingen em-dash og intet AI-fyld. Svarene skal være konkrete: hvad jeg har gjort, eller hvad der sker og hvornår. De skal kunne sendes med copy-paste.
   - **Lever** det som én side, jeg kan arbejde igennem, f.eks. en Artifact med en kopiknap pr. svar, sorteret efter prioritet.
   - **Verdensklasse betyder:** spilleren føler sig hørt, svaret nævner issue eller fix ved navn, status er ærlig, og der er ingen undskyldnings-fyld.

2. **Known issues under roadmappen**, som spillerne kan se.
   - Find kilden: known issues i admin, `frontend/src/components/admin/growth/RoadmapAdminForms.jsx` og tabellen bag.
   - Opdatér alt, der er forældet, og tilføj dagens nye ting. De vigtigste nye ting fra motortjekket (`docs/audits/2026-10-15-motor-gennemgang.md`) er:
     - beskyt/spar bliver overskrevet (#6647, rettes nu)
     - enkeltstart er for tæt (#6645)
     - et kunstigt 3-sekunders trin i målet (#6648)
     - GC vindes fra udbrud (#5978)
     - udbruddenes størrelse (#6201)
     - akademiets hent-knap (#6155)
   - Vis mig før/efter-listen først. Skriv KUN ændringerne i prod på mit ordrette go.

3. **Roadbook-opslag** til alle spillere i dag.
   - Indhold: hvad der sker nu. Motoren løftes i kvalitet, S5 starter 28/10, og der er nye ting: etapeside 2.0 i beta, "Your first race"-kortet og bulk-dag i træningen i beta.
   - Lav ét billede eller design, jeg kan poste, efter `docs/design/TASTE.md`.
   - Teksten skal være på EN. Opslag på Discord er kun på EN og leveres som rå tekst i en kodeblok.

4. **Stor samlet patch note senere i dag**, både til hjemmesiden og Discord.
   - **Hjemmesiden:** `PatchNotesPage.jsx`, EN+DA. Det er en PR, som jeg godkender visuelt før merge.
   - **Discord:** kun EN, rå kodeblok, kort og læsbar.
   - **Indhold:** alt brugerrettet siden 7.360. Se `docs/drafts/discord-patch-7356-7360-2026-10-14.md`, som ikke er postet endnu, og git-log og merged PR'er siden 14/10.
   - Bølge-PR'er skriver ikke selv patch notes, så det er dig, der samler dem.

**Koordinering:**
- Claude på pc1 (sessionen "S5 + motor") ejer S5, motor-PR'erne og `docs/FEATURE_REGISTRY.yml`. DOLMERPC ejer løbshistorien (#6570). Rør ikke deres filer.
- Merge-køen køres kun fra pc1-hovedsessionen. Skriv "klar til merge-køen" på din PR.
- Commit kun bag `scripts/guard-commit-branch.sh`. Kald `gh`/`git` bart.
- Gem beslutninger og status på GitHub-issues (#6319 er hovedissue), ikke kun lokalt.
- Regler: CLAUDE.md og AGENTS.md. Intet sendes på mine vegne. Prod-ændringer kun på ordret go pr. skridt.
