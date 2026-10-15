# Startprompt: DOLMERPC sideløbende med pc1 (15/10)

Kopiér alt under linjen ind i en ny Claude Code-session på DOLMERPC.

---

Ny session på DOLMERPC, sideløbende med en Claude-session på pc1 (NICOLAIPC). Svar på dansk, ét beslutningskort ad gangen. Jeg giver eksplicit opt-in til multi-agent-orkestrering: byggearbejde køres som Workflow via `wave.js` (CLAUDE.md, Orkestrator-standard). DOLMERPC's lane-loft er 4 (`scripts/wave-capacity.json`).

**Arbejdsdeling (bindende, så de to pc'er aldrig rører de samme filer):**
- **pc1 ejer:** S5-kalenderkæden (#6640, kalender-PR #6637, prod-dry-run, `--apply` på ejer-go, live senest lør 18/10), datokort #6601, Codex-audit-kort, løbsbiblioteket #6636. pc1 rører ikke etapeside/løbshistorie-filer.
- **DOLMERPC ejer:** (1) **Løbshistorien på etapeside 2.0** (#6570 del 2): replay, øjeblikke, mellemtider, Final 5 km som TV-grafik og referat, bygget på løbslog-kontrakten fra #6632. Design-go findes (artifact v7 https://claude.ai/artifact/CfMddzMmT4uG9FfK3oVQRS). Underlag vises kun, når det ikke er asfalt. opus. (2) Derefter **landingpage "mennesket bag"** (#1369, P01-P20, Codex-handoff i kommentar 6168854429 + OneDrive `private-handoffs/2026-10-14-claude-code-complete-planning-handoff.txt`). sonnet til UI.
- **Rør aldrig:** `backend/lib/raceStageProfileGenerator.js`, `raceRouteGenerator.js`, `s5*`, `tierCalendarMaterializer.js`, `calendarRaceDayTargets.js`, `backend/scripts/buildSeasonCalendar.js`, `docs/CALENDAR_RULES.md`. Kræver løbshistorien en ændring der, så skriv det på #6570 og spørg mig.

**1. Opstart:**
- `git pull --ff-only`; `npm run sync-deps` hvis en `package-lock.json` er ændret.
- `pwsh -File scripts/link-onedrive-context.ps1`, derefter `pwsh -File scripts/agent-doctor.ps1`.
- Læs `docs/NOW.md`. Tilføj din EGEN linje under 🤖 Working agent ("DOLMERPC: løbshistorien #6570"), rør ikke pc1's linje. Commit bag guarden, `git pull --rebase` før push.
- Læs seneste kommentarer på #6570 og #6632 FØR plan.

**2. Før første PR:** læs kontrakten fra #6632, `docs/design/PAGE_TEMPLATES.md` (T3) og `docs/design/TASTE.md`. Verificér mod rigtige løbslogs i prod (read-only), ikke antagelser. Lav ét samlet annoteret før/efter-billede og send det som fil, før du beder om visuelt go.

**3. Merge:** pc1 kører den ene merge-kø (`scripts/merge-queue.ps1`). DOLMERPC merger ikke selv: når en PR er grøn, reviewet og har mit visuelle go, kommentér "klar til merge-køen" på PR'en, så tager pc1 den. Ingen patch notes i bølge-PR'er; saml dem ved close-out.

**4. Grænser:** `stage_page_v2` forbliver off; jeg tænder beta selv. Ingen prod-mutation, motor-tænding, flag-flip eller udsendelse uden mit ordrette go pr. skridt. Ingen natpakker eller CronCreate. Meld anomalier proaktivt.

**5. Close-out efter CLAUDE.md:** din NOW-linje nulstillet, issues flippet, token-hygiejne, `scripts/close-out-cleanup.ps1`, og før du lukker: `pwsh -File scripts/cross-pc-forensic-audit.ps1` + hver lokal branch tjekket mod GitHub.
