# Startprompt: pc1 (NICOLAIPC) efter genstart, 14/10 eftermiddag

Kopiér alt under linjen ind i en ny Claude Code-session på pc1.

---

Ny session på pc1 (NICOLAIPC) efter genstart. Svar på dansk. Ejeren er med; spørg ét kort ad gangen. Ejeren bruger Codex på DOLMERPC til planlægning samtidig: rør ikke filer/issues Codex arbejder på, og spørg ved tvivl.

**Status ved overdragelse (formiddagens session):** pc1 er gjort fuldt arbejdsklar (Python 3.12, npm 11.21, Railway 5.68, Claude Code opdateret, git fsmonitor/rerere/pull.ff=only, Git\bin på PATH, memory pinnet lokalt, alle 4 konti logget ind, Discord-MCP sat op, backend-test + frontend-build grønne). PR #6603 (#6602, Git Bash + OneDrive-pin) er rettet efter Codex/CodeRabbit-review og merget eller i merge-køen: tjek `gh pr view 6603`. Er den ikke merget, så før den til dørs efter regel 35.

**Start (5 min):**
1. `git pull --ff-only` på main; `pwsh -File scripts/agent-doctor.ps1`. Forvent `git-bash` OK og `memory-cloud-only` OK. Er #6603 merget, så kør `pwsh -File scripts/link-onedrive-context.ps1` (forvent "[triggered] C:\Program Files\Git\bin\bash.exe" + "memory pinnet (cloud-only: 0 -> 0)") og læg resultatet som kommentar på #6602 (NICOLAIPC-restverifikation).
2. Læs `docs/NOW.md`. Sæt dig selv som 🤖 Working agent.

**Arbejde, i denne rækkefølge, parallelt hvor muligt:**

A) **Bølge på pc1 NU: #6604** (alle major-efterslæb i dag, ejer: "træt af at indhente sjusk", intet udskydes til efter sæsonskiftet). Kør via `.claude/workflows/wave.js`, maks 4 laner, `model` eksplicit pr. spor:
   - Spor 1 (sonnet): marketing ESLint 10 via eksplicit `settings.react.version` → merge Dependabot #6564 + fjern forældet tailwind-major-ignore i `.github/dependabot.yml` + agent-doctor-tjek for major-efterslæb + regel "luk aldrig en major-PR med @dependabot ignore".
   - Spor 2 (sonnet): frontend `react.version` 18.3 → 19.3, slå React 19-reglerne til igen, eslint-budget forbliver 0/0.
   - Spor 3 (opus): Sentry 10 → 11 i frontend + backend (reopen/unignore #6040/#6037). Sentry er G4-gaten 22/10: verificér at events faktisk lander fra preview og Railway efter deploy.
   - Spor 4 (sonnet): `@vercel/og` 0.9 → 1.0; verificér `/api/og/stage?id=<rigtig etape>` på preview med et rigtigt billede FØR merge.
   Merge efter regel 35 (ingen spillertekst, grøn CI + diff + CodeRabbit) via `scripts/merge-queue.ps1`, én ad gangen. Done-flip pr. PR.

B) **Imens (orkestratoren, kun læsning):**
   - "Hvad brænder" 14/10 var rød (#6549): Sentry CYCLINGZONE-56 (ny, 1 spiller) og CYCLINGZONE-80 (regressed). Find ud af hvad de er; reelle → issue med problem + løsning (byg via bølgen). CYCLINGZONE-62 = Alunta-faktura (ejer, se påmindelser).
   - Forbered datokortet til torsdag (#6601): find alle "25 October" i udkastene, og sammenstil S4-slut, sæsonskifte, S5-start og første løbsdag. Ret INTET.

C) **Kl. 20 i dag:** læs de to forum-afstemninger (post 8a504dc4 + b76339e3) → endeligt resultat på #5833 → S5-startdato til generatoren. Samtidig: **påmind ejeren om dvale-indstillingen** (Indstillinger → System → Strøm → "Aldrig" på strøm; ellers kan en bølge dø midt i). Spørg om `backend/.env` (forældet fra maj, rigtig service-nøgle i klartekst, Infisical er kilden) må slettes nu.

D) **Torsdag 15/10:** datokort til ejeren om lanceringsteksterne (#6601) · S5-tørkørsel gennem gaten (#6367) inkl. højdeprofilen (#6594) → billede af en rigtig S5-etape (road book `/api/og/stage?id=`).

**Påmindelser til ejeren (står i NOW, sat til 14/10):** Alunta-faktura 61,25 kr. i Dinero · CodeRabbit-loft · `INDEXNOW_KEY` som GitHub-secret (#6558) · Discord-tekst 7.359 + app-opslag i forum.

**Regler:** byggearbejde kun via bølgen. Intet sendes, postes eller aktiveres på ejerens vegne. Ingen natpakker/CronCreate. Close-out efter CLAUDE.md (NOW.md, token-hygiejne, status-board, close-out-cleanup).
