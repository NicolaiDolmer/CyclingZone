# Bash ikke på PATH + OneDrive-memory cloud-only (NICOLAIPC, 14/10)

**Hvad skete:** NICOLAIPC havde ikke været brugt siden maj. Ved opstart 14/10:

1. **Secret-guarden blokerede ALLE værktøjer** (også Read/Glob), fordi Python ≥3.8 manglede. Fail-closed er korrekt; ejeren installerede Python 3.12 via winget.
2. **`link-onedrive-context.ps1` startede `cross-pc-sync.sh` med bar `bash`** og fejlede ("Den angivne fil blev ikke fundet"): Git for Windows lægger kun `Git\cmd` på PATH, ikke `Git\bin`. Transcript-sync kørte aldrig, og fejlen var kun en gul linje.
3. **161/348 memory-filer lå cloud-only** (OneDrive Files On-Demand), plus codex-memories og tools. Memory var langsom og ville mangle offline.
4. Bonus-støj: npm 11.4.1 fjernede `libc`-felter i begge lockfiler ved `sync-deps` (nyere npm på DOLMERPC skriver dem). Løst med `npm i -g npm@11.21.0` + `git checkout` af lockfilerne.

**Rod-årsag:** Opsætningsscripts antog en "varm" PC: bash på PATH og OneDrive-filer lokalt. En PC der har ligget i måneder bryder begge antagelser stille.

**Fix (#6602 / PR #6603):** `Resolve-GitBash` (PATH uden WSL-launcher → Program Files → LOCALAPPDATA → `git --exec-path`, kun Windows), pin af memory/codex-memories/codex-local/tools/claude-settings med `attrib +P -U "<dir>\*" /S /D` (wildcard er nødvendigt; uden det pinnes kun mappen), `agent-doctor`-tjek `git-bash` + `memory-cloud-only`, og `bootstrap-pc.ps1` lægger Git\bin på User-PATH. Codex-review fangede at resolveren crashede doctor på Linux-CI (`$env:SystemRoot` tom → Join-Path kaster under Stop).

**Regel fremover:**
- En PC der har stået stille: kør `bootstrap-pc.ps1` → `setup-local.ps1` → `link-onedrive-context.ps1` → `agent-doctor.ps1`, og tjek at npm-versionen matcher (lockfil-diff efter `sync-deps` = forkert npm, aldrig commit den).
- Delte PowerShell-helpers der også kaldes fra `agent-doctor.ps1` SKAL tåle Linux (`$IsWindows`-guard), fordi doctor kører i `quality-inbox.yml` og `lockfile-drift-check.yml` på ubuntu.

Refs #6602 #6603
