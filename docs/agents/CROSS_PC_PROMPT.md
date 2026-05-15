# Cross-PC AI prompt — paste til Codex, Claude og Manus

> **Sådan bruger du filen:** kopiér det relevante afsnit ind som dit allerførste budskab til hver AI når du starter en session. AI'en bekræfter at den har læst `AGENTS.md` + kørt session-start sekvensen.
>
> Filen er identisk-effektiv på begge PC'er. Hold den på GitHub — paste fra `https://github.com/NicolaiDolmer/CyclingZone/blob/main/docs/agents/CROSS_PC_PROMPT.md`.

---

## Paste til Codex CLI

```
Du arbejder i CyclingZone-repoet på en af to PC'er der deler samme OneDrive-konto.
Den anden PC kan tage over når som helst — så intet vigtigt må ende kun lokalt.

Før du gør noget andet:

1. Læs AGENTS.md i repo-roden — den er sandheden for hvordan vi arbejder cross-PC.
   Særligt §LOKAL: whitelist for .codex.local/ + decision tree for ad-hoc indhold.

2. Kør session-start sekvensen:
   git fetch --prune origin
   git pull --ff-only   (hvis på main)
   pwsh -File scripts/link-onedrive-context.ps1
   pwsh -File scripts/cross-pc-forensic-audit.ps1

3. Hvis auditen exit'er 1: STOP. Vis mig output. Vi adresserer fund først.
   Hver "local-only-content" finding betyder en fil der er stuck på denne PC.
   Promovér til GitHub (gh issue/pr create --body-file <fil> && rm <fil>),
   ELLER slet hvis den er forældet.

4. Bekræft til mig: "AGENTS.md læst, session-start kørt, audit: clean/N fund".

Under sessionen:
- ALDRIG persistent indhold i .codex.local/ udenfor whitelisten.
- Issue-drafts → gh issue create direkte. Slet aldrig output til en .md-fil
  med tanke om "jeg pusher det senere". Push NU eller skriv det ikke.
- Memory om bruger/projekt → ~/OneDrive/CyclingZone-context/memory/ (ikke ~/.codex/memories/).
- Hvis du opdager du har skrevet noget lokalt der ikke burde være: ryd op NU.

Ved session-slut:
- git status: rent (commit + push alt)
- pwsh -File scripts/cross-pc-forensic-audit.ps1: [clean]
- cross-pc-stop-check.sh kører automatisk og advarer
```

---

## Paste til Claude Code

```
Du arbejder i CyclingZone-repoet på en af to PC'er der deler samme OneDrive-konto.
Den anden PC kan tage over når som helst — så intet vigtigt må ende kun lokalt.

Før du gør noget andet:

1. Læs AGENTS.md (repo-root) UDOVER din auto-loadede CLAUDE.md.
   §LOKAL definerer whitelist for .codex.local/ og decision tree for ad-hoc indhold.

2. Kør session-start (Bash-tool):
   git fetch --prune origin
   git pull --ff-only   (hvis på main)
   pwsh -File scripts/link-onedrive-context.ps1
   pwsh -File scripts/cross-pc-forensic-audit.ps1

3. Hvis auditen finder lokal-only state: STOP, vis mig output, og foreslå
   hvad der skal promoveres til GitHub vs. slettes.

4. Bekræft: "AGENTS.md læst, session-start kørt, audit: clean/N fund".

Husk specifikt for dig:
- Auto-memory er allerede junctioned til OneDrive. Skriv frit dér.
- Multi-line commit-messages: Write → fil + git commit -F (aldrig PowerShell
  heredoc inden i Bash-tool, det er bidt 3 gange).
- PatchNotesPage.jsx er obligatorisk ved brugerrettet ændring.
- Refs (ikke Closes) — brugeren lukker selv issues.

Ved session-slut:
- git status rent + pushed
- forensisk audit clean (eller fund adresseret)
- foreslå "Næste session starter med..." linje
```

---

## Paste til Manus (cloud — manus.im)

```
Du arbejder på CyclingZone-projektet sammen med Codex og Claude.
Vi har to PC'er der deler samme OneDrive-konto, men du kører i cloud — så
sandheden for hvad du må gøre ligger på GitHub.

Før du gør noget andet:

1. Åbn og læs:
   https://github.com/NicolaiDolmer/CyclingZone/blob/main/AGENTS.md
   Særligt §LOKAL (whitelist + decision tree) og §6 (din specifikke rolle).

2. Bekræft til mig: "AGENTS.md læst — jeg er The Architect & Coordinator,
   leverancer går til OneDrive 'CyclingZone-Manus noter' og beslutninger
   til GitHub issues/docs."

Husk specifikt for dig:
- Strategiske leverancer (roadmaps, frameworks, validation plans) går i
  ~/OneDrive/CyclingZone-context/CyclingZone-Manus noter/ — IKKE kun i
  Manus' eget storage. Brugeren skal kunne se dem fra begge PC'er.
- Beslutninger med implementations-konsekvens → GitHub issue (gh CLI eller
  GitHub web) eller PR mod docs/decisions/.
- Hvis du opretter et delivery-doc: skriv navn + URL i et GitHub-issue så
  Codex/Claude kan finde det. Manus-noter er ikke indexerede af de andre AI'er.

Lokal sidecar (hvis du har en kørende på PC'en):
- Kun ~/.manus/logs/ må være lokal.
- Alt andet persistent skal til OneDrive eller GitHub.
```

---

## Hvorfor jeg har lavet denne fil

Codex efterlod 19 lokal-only filer på denne PC (7 Discord-issue-drafts, token-baselines,
vite-logs, sub-issue-260-bodies, migration-rapporter) — alle usynlige fra den anden PC.
Reglerne i AGENTS.md var rigtige men for abstrakte. Nu er der:

1. **Konkret whitelist** i AGENTS.md §LOKAL — alt udenfor er en fejl
2. **Forensisk audit-script** der kører automatisk session-start og fejler exit 1 ved fund
3. **Stop-hook udvidelse** der advarer ved session-slut hvis nyt lokal-only state er opstået
4. **Denne prompt** der ankrer alle 3 AI'er til samme proces

Hvis du nogensinde tilføjer en 4. AI: tilføj en sektion her, og opdatér AGENTS.md §6
med agentens specifikke regler.
