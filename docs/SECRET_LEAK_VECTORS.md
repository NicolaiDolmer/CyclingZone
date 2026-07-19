# Secret leak vectors — root cause-analyse

> **Genereret 2026-05-25 som del af [#634](https://github.com/NicolaiDolmer/CyclingZone/issues/634) AC1.** Lever som single source of truth for kendte leak-vektorer + mitigations. Når en ny vektor opdages → tilføj her + opdatér sanitizer-patterns ([`/.claude/hooks/sanitize-secrets.sh`](../.claude/hooks/sanitize-secrets.sh)) + memory ([`feedback_secret_leak_prevention.md`](../../../Users/emmas/.claude/projects/C--dev-CyclingZone/memory/feedback_secret_leak_prevention.md)).

## Hvorfor det her dokument findes

Brugeren har været tvunget til at rotere produktions-secrets manuelt 2 gange på 14 dage pga. agent-fejl:

- **2026-04-17 → 2026-05-11 ([#296](https://github.com/NicolaiDolmer/CyclingZone/issues/296)):** Supabase service_role JWT i klartekst i `setup.py`, committed til public repo, 25 dage før rotation. Forward-guards listet i postmortem ([`2026-05-11-supabase-key-rotation.md`](../.claude/learnings/2026-05-11-supabase-key-rotation.md)) — pre-commit gitleaks, audit-script, PR-template — **blev ALDRIG bygget**. Det er den primære årsag til at leak #2 skete.
- **2026-05-25 Session B ([#620](https://github.com/NicolaiDolmer/CyclingZone/issues/620)):** `railway variables --json` printede klartekst SENTRY_DSN + SUPABASE_SERVICE_KEY + DISCORD_BOT_TOKEN til transcript (kørte 2 gange — agent indså ikke det stadig leakede efter første run). Bruger måtte rotere 3 keys.

**Brugeren har eksplicit nægtet at rotere igen før permanent forebyggelse er bygget.** Det er denne issue (#634) der bygger den.

## Evaluerings-spørgsmål (jf. #634)

### 1. Hvorfor sker det?

Agent kører commands der dumper secret-values til stdout/stderr fordi:

- **Friction-bias:** "Jeg vil bare lige tjekke" → kører `railway variables` uden filter fordi det er hurtigere end at skrive wrapper. Skete i #620 — agent vidste at output kunne indeholde values, men kørte alligevel.
- **Manglende awareness af alle vektorer:** Nogle commands leaker uden at det er åbenlyst (fx Node error-traces der inkluderer config-objekt med embedded keys, eller `vercel inspect` der printer build-time-env).
- **Tooling uden `--keys-only` flag:** Railway CLI har INGEN `--keys-only` eller `--no-values` flag. Vercel `env ls` printer keys-only på TTY men values i `--format json`. Supabase CLI `secrets list` ALDRIG printer values, men kan stadig leake via `supabase functions logs` hvis koden printer env.
- **No output sanitization:** Indtil #634 var Claude Code's tool-output streamed direkte til konteksten uden scanning. PostToolUse-hook bygges i AC2.
- **Repo-side guards manglede:** gitleaks pre-commit aldrig installeret (forward-guard fra #296 ikke bygget). CI-side `secret-scan.yml` eksisterer men kører kun ved push, ikke ved lokal commit.

### 2. Hvorfor blev forward-guard fra #296 ikke bygget?

3 årsager (kombination):

- **Postmortem-pligt mangler exit-criteria.** `2026-05-11-supabase-key-rotation.md` listede 3 forward-guards som "Ide til separat issue (epic:quality-hardening)" — uden at konkret issue blev oprettet med pickup-label. Forward-guards blev "ideas" og forsvandt i backloggen.
- **Bias mod feature-arbejde.** Mellem 2026-05-11 og 2026-05-25 byggede vi 3 økonomi-slices (#239, #240 osv.), Discord-integration (#550), i18n-fase-2 (#411). Quality-hardening backlog blev pushed.
- **Ingen central tracker for "ting fra postmortems der skal bygges".** Lessons learned var dead doc — ingen check forhindrede pre-commit fra at fejle.

**Forebyggelse mod #634-style gentagelse:** AC1-AC7 i denne issue er ALLE konkret eksekverbare. Ingen "ide til separat issue"-formuleringer. Bruger lukker først når alle 7 er verificeret leveret.

### 3. Hvor mange leak-events hidtil?

Bekræftede store leaks:

| # | Dato | Vektor | Værdier eksponeret | Issue |
|---|---|---|---|---|
| 1 | 2026-04-17 → 2026-05-11 | Hardcoded i `setup.py` commit `bc9204d`, line 27 | Supabase service_role JWT (legacy) | [#296](https://github.com/NicolaiDolmer/CyclingZone/issues/296) |
| 2 | 2026-05-25 (Session B) | `railway variables --json` × 2 i transcript | SENTRY_DSN + SUPABASE_SERVICE_KEY + DISCORD_BOT_TOKEN | [#620](https://github.com/NicolaiDolmer/CyclingZone/issues/620) |
| 3 | 2026-05-30 | `infisical secrets --plain` i transcript (deny-list-hul: hook matchede kun `list --format json`) | SUPABASE_SERVICE_KEY + TEST_ACCOUNT_PASSWORD | [#634](https://github.com/NicolaiDolmer/CyclingZone/issues/634) follow-up |

Mindre instances (verificeret ved gennemgang af `settings.local.json` allow-list — commands der har været approved og kørt minst én gang):

- `python3 -c "...d['SUPABASE_SERVICE_KEY']..."` — printede `len=` og `prefix=` (kun metadata, ingen full value). NO LEAK, men på grænsen.
- `curl ... -H "apikey: sb_publishable_..."` — sb_publishable er ikke en secret per Supabase model (= anon key). NO LEAK.
- `Bash(grep -oE 'eyJh...')` patterns på bundle-files — søger efter mønstre, ikke printer dem (no leak).
- Supabase-MCP `get_publishable_keys` — kaldt 2026-07-18 under RLS-undersøgelsen for at reproducere et anon-kald med curl. Output indeholdt anon/publishable-nøgle i klartekst, korrekt blokeret af `sanitize-secrets.sh` (#634), incident logget i `.claude/secret-leak-incidents.log`. NO LEAK (sanitizer fangede det), men vektoren var udokumenteret — se ny række i Tabel F ([#2673](https://github.com/NicolaiDolmer/CyclingZone/issues/2673)).

**Konklusion:** ≥2 store leaks bekræftet. Ingen evidens for yderligere store leaks, men sanitizer fra AC2 vil retro-fange evt. instances vi har overset.

### 4. Er output-sanitizer tilstrækkeligt?

**Nej, ikke alene.** Output-sanitizer er BAGEFTER-defense — secrets er allerede landet i toolresponse buffer'en. Selv hvis sanitizer redact'er før agent ser output, kan en kompromitteret hook fejle silent. Defense-in-depth model:

1. **Primær: PreToolUse-block** (`.claude/hooks/block-dangerous-secret-commands.sh`) — afviser farlige commands FØR de kører. Catch'er kendte mønstre (`railway variables` uden `--service ... | jq keys`, `vercel env ls --format json` uden `jq '[.[] | .key]'`, `cat .env*`, `env` uden `| grep -v`, etc.).
2. **Sekundær: PostToolUse-sanitizer** (`.claude/hooks/sanitize-secrets.sh`) — scanner faktisk tool-output for secret-patterns. Hvis match → redact value, log incident, advar brugeren via stderr (exit 2). Catch'er ukendte/uventede vektorer (Node error-traces, MCP-tool-output der kommer i nye formater, etc.).
3. **Tertiær: Repo-side guards** — `gitleaks` pre-commit (AC5) fanger hvis secret alligevel landet i en file-edit der skal commits. CI-side `secret-scan.yml` (allerede live) fanger ved push.
4. **Quaternær: Wrapper-scripts** (AC3) — `probe-railway-keys.ps1` + `probe-vercel-keys.ps1` giver agent et SAFE alternativ så friction-biasen ikke skubber den mod farlige raw commands.
5. **Pentar: Memory-discipline** (AC4) — agent læser HOT-tier memory `feedback_secret_leak_prevention.md` ved hver session-start. Eksplicit forbud + pointer til wrappers.

Subagents og spawned agents arver hooks fra parent settings.json — alle tool-calls scannes, ikke kun Bash. Verificér via AC6.

### 5. Skal vi accelere Infisical-migration ([#563](https://github.com/NicolaiDolmer/CyclingZone/issues/563))?

**Ja, men ikke pre-req for #634.** Argumentation:

- **Infisical fjerner root cause:** Central secret-store. Hverken backend eller agent læser direkte fra Railway/Vercel env. `railway variables` blev derved unødvendig.
- **Men Infisical-migration tager 1-2 uger korrekt udført** (incl. backend-rewiring, CI-secret-sync, fallback-tests). #634 skal være nedsmeltet inden næste session.
- **Defense-in-depth holder:** Selv post-Infisical vil sanitizer + pre-commit gitleaks være værdifulde — der vil altid være måder at leake på (logs, errors, scripts der printer env).

Anbefaling: #634 ships nu. #563 prioriteres i sprint 18 maj-17 juni som "P1 sikkerhedsstabilisering".

## Tabel — Kendte leak-vektorer + mitigations

> Format: `Vector | Eksempel-command (FARLIG) | Sidste kendte leak | Mitigation (SAFE alternativ)`. Når sanitizer fanger en vektor der ikke står her → tilføj rækken + opdatér regex i hook.

### A. CLI-dumps (cloud-providers + secret-stores)

| Vector | Eksempel-command (FARLIG) | Sidste leak | Mitigation |
|---|---|---|---|
| Railway env-dump (JSON) | `railway variables --json` | 2026-05-25 (#620) — SENTRY_DSN + SUPABASE_SERVICE_KEY + DISCORD_BOT_TOKEN |  `pwsh -File scripts/probe-railway-keys.ps1` (AC3 — kun key-navne) |
| Railway env-dump (TTY) | `railway variables` (table format) | Ingen kendt | Samme wrapper. Table-format printer values, blot ikke som JSON. |
| Vercel env-dump (JSON) | `vercel env ls production --format json` | Ingen kendt (caught of agent-doctor #620 fix før reel leak) | `pwsh -File scripts/probe-vercel-keys.ps1` (AC3 — kun key-navne) |
| Vercel env-dump (decrypt) | `vercel env pull .env.production --yes` | Ingen kendt | ALDRIG kør på agent-session. Manuel kun. |
| Supabase secrets-list | `supabase secrets list` | Ingen kendt | CLI printer aldrig values i list-mode — safe. Men `--format json` printer keys-only ifgl. docs; verificér før brug. |
| GitHub secrets-list | `gh secret list` | Ingen kendt | Safe — gh secret list printer ALDRIG values (kun navne + opdateringstid). |
| Infisical secrets-dump | `infisical secrets`, `infisical secrets --plain`, `infisical secrets get <KEY>`, `infisical export` | **2026-05-30** — `infisical secrets --plain` printede SUPABASE_SERVICE_KEY + TEST_ACCOUNT_PASSWORD til transcript. Gammel hook-regel matchede kun `list --format json` (deny-list-hul). | ✅ **LUKKET 2026-05-30:** `block-dangerous-secret-commands.{sh,ps1}` blokerer nu **kategorisk** `infisical (secrets\|export)` i alle former (ingen allow-pipe-undtagelse). Kun `infisical run -- <cmd>` (runtime-injection, printer intet) + `infisical login` slipper igennem. Tjek om en key er sat: `infisical run --env=dev -- node backend/scripts/verify-infisical-injection.js` (printer navne/antal, ingen values). |

### B. Lokal env-file reads

| Vector | Eksempel-command (FARLIG) | Sidste leak | Mitigation |
|---|---|---|---|
| Cat .env | `cat backend/.env`, `cat frontend/.env*`, `Get-Content .env*` | Ingen direkte leak (men kommandoer er pre-allowed i settings.local.json — risiko) | PreToolUse-hook blokker. Hvis du SKAL kende key-navne: `grep -oE '^[A-Z_]+=' backend/.env` (kun key-prefix, ikke value). |
| Env-listing | `env`, `printenv`, `Get-ChildItem env:`, `gci env:` | Ingen kendt (men nemt at trigge utilsigtet) | PreToolUse-hook blokker. Hvis du SKAL liste: `env \| awk -F= '{print $1}'` (kun key-navne). |
| Env-grep med value | `env \| grep SUPABASE` (printer key=value) | Ingen kendt | Brug `env \| awk -F= '/SUPABASE/{print $1}'` (kun match key, ikke value). |
| Read/Grep tool på secret-fil | `Read('.env')`, `Read('.mcp.json')`, `Grep('TOKEN', 'backend/.env')` | **2026-05-29** — Discord bot-token dumpet til transcript via `.mcp.json` (ramt 2×: session-læsning + agent-`Grep`). | ✅ **LUKKET 2026-05-29 (#634 follow-up) + hardenet 2026-06-01:** **Lag A (primær)** — `block-dangerous-secret-commands.sh` blokerer nu `Read`/`Grep` mod secret-fil-stier (`.mcp.json`, `*.env`, `*.env.*`, `*/secrets/*`; whitelist: `.example/.sample/.template`). **Lag B (backup)** — PostToolUse sanitizer dækker `Read\|Write\|Edit\|Grep`. **Lag C (root-cause)** — Discord MCP setup skriver nu `.mcp.json` uden inline token; `DISCORD_TOKEN` injectes via Infisical/user-env. |
| Dotenv-debug-print | `node -e "require('dotenv').config(); console.log(process.env)"` | Ingen kendt | ALDRIG kør. Brug `node -e "require('dotenv').config(); console.log(Object.keys(process.env))"`. |

### C. Git history-mining

| Vector | Eksempel-command (FARLIG) | Sidste leak | Mitigation |
|---|---|---|---|
| Git show .env | `git show HEAD:.env`, `git show <sha>:backend/.env` | Hvis `.env` nogensinde har været committed (#296-pattern). Setup.py-leaken var præcis dette. | PreToolUse-hook blokker `git show *:*.env*`. |
| Git log -p på .env | `git log -p backend/.env` | Hvis .env nogensinde committed | PreToolUse-hook blokker `git log -p *.env*`. |
| Git diff på .env | `git diff HEAD~10 -- .env*` | Hvis .env i diff-range | Same hook. |
| Git blame med values | `git blame setup.py` (hvis JWT i koden) | Var roden af #296 | Mitigeret af `.env`-flytning. Men: gitleaks pre-commit (AC5) hindrer fremtidige commits af hardcoded values. |
| GitHub PR-files | `gh pr diff N` (hvis PR har hardcoded secret) | Ingen kendt | Sanitizer (AC2) fanger output. |

### D. Cloud-provider logs/inspectors

| Vector | Eksempel-command (FARLIG) | Sidste leak | Mitigation |
|---|---|---|---|
| Railway logs | `railway logs`, `railway logs --service ...` | Hvis backend console.log'er env (fx `console.log("DB:", process.env.SUPABASE_URL)`) | Code-review: ALDRIG `console.log(process.env.X)` i backend. Lint-rule kunne tilføjes. Sanitizer fanger output. |
| Vercel logs | `vercel logs <deployment-url>` | Hvis frontend SSR/edge-function logger env | Samme code-review. Sanitizer fanger. |
| Supabase logs | MCP `get_logs` | Hvis edge-function logger env eller hvis migration logs printer rolse_key | Sanitizer fanger output. Migration-scripts skal aldrig printe sb_secret_*. |
| Vercel inspect build | `vercel inspect <deployment>` | Inkluderer build-time env-vars (key + value) i nogen formater | Sanitizer fanger. PreToolUse blokker `vercel inspect *`. |
| Sentry events (replay) | Sentry-event-payload kan indeholde request-headers med Authorization | Allerede mitigeret af Sentry SDK `sendDefaultPii: false` + `beforeSend` filter, men ikke 100% | Sanitizer fanger output ved CLI-pull. Vi puller ikke event payloads gennem agenten normalt. |

### E. Error-traces + stack traces

| Vector | Eksempel-command (FARLIG) | Sidste leak | Mitigation |
|---|---|---|---|
| Supabase-client error med config | `node -e "createClient(...)"` der fejler og throw'er med config-object containing keys | Ingen kendt, men teoretisk pattern | Sanitizer (AC2) fanger output. Pattern: høj-entropi base64-like ≥40 chars. |
| dotenv parse-error | `node` med invalid .env der printer parsed values i error | Ingen kendt | Sanitizer fanger. |
| Webpack/Vite build-time env injection error | Build der fejler og dumper `import.meta.env` | Ingen kendt (Vite scoper VITE_* — kun publishable values exponeret) | Sanitizer fanger. Vite hjælper allerede ved at scope. |

### F. MCP-tool output

| Vector | Eksempel-command (FARLIG) | Sidste leak | Mitigation |
|---|---|---|---|
| Supabase MCP `get_logs` | Returns runtime logs der KAN inkludere accidentally-logged secret | Ingen kendt (vi har grep'et tool-results — kun stack-traces uden secrets) | Sanitizer (AC2) scanner ALLE tool_response inkl. MCP. Hook matcher er `Bash\|PowerShell\|mcp__.*`. |
| Supabase MCP `get_publishable_keys` | Kaldt for at hente anon/publishable-nøglen til fx en curl-reproduktion af et anon-kald (`curl ... -H "apikey: <key>"`) | **2026-07-18** — kaldt under RLS-undersøgelsen for at reproducere et anon-kald med curl. Output indeholdt anon/publishable-nøgle i klartekst; korrekt blokeret af sanitizer (#634), incident logget i `.claude/secret-leak-incidents.log`. | ✅ **Kør ALDRIG `get_publishable_keys` for at reproducere rolle-adgang.** Brug i stedet `execute_sql` direkte i DB: `BEGIN; SET LOCAL role anon; <query>; ROLLBACK;` — beviser samme adgangsmønster (fx RLS-policy-adfærd for `anon`) uden at nøglen nogensinde rører transcript'en. Gælder tilsvarende for andre nøgle-returnerende MCP-tools (enhver `get_*_key`/`get_*_secret`-tool i fremtidige providers) — foretræk altid en DB/rolle-intern reproduktion frem for at hente og bruge nøglen. |
| Vercel MCP `get_runtime_logs` | Samme | Ingen kendt | Sanitizer dækker. |
| Railway MCP (hvis installeret) | N/A — vi har ikke Railway MCP | Ingen kendt | N/A. |
| GitHub MCP `get_file_contents` | Returns file content — hvis fil indeholder secret | Ingen kendt | Sanitizer dækker. |
| Chrome MCP `read_page` | Returns DOM — admin-page kunne vise secrets | Ingen kendt (admin er logged-in only, secrets aldrig embedded i DOM) | Sanitizer dækker. |

### G. Clipboard / paste-handling

| Vector | Eksempel-command (FARLIG) | Sidste leak | Mitigation |
|---|---|---|---|
| Clipboard-read med value | `powershell.exe -Command "Get-Clipboard"` (hvis bruger lige har kopieret secret) | Ingen kendt, men risiko-vektor | Brugen skal kontekstualiseres: hvis bruger kopierer secret OG agent læser clipboard → leak. Sanitizer fanger output. |

## Tooling-status (post-#634)

| Guard | Status | Reference |
|---|---|---|
| PreToolUse: dangerous-command-block | ✅ Bygget #634-AC2 | [`.claude/hooks/block-dangerous-secret-commands.sh`](../.claude/hooks/block-dangerous-secret-commands.sh) |
| PreToolUse: Read/Grep secret-path-block | ✅ Bygget 2026-05-29 (#634 follow-up) | samme hook — `Read`/`Grep` mod `.mcp.json`/`*.env`/`*/secrets/*` |
| PostToolUse: sanitizer dækker Read/Grep | ✅ Koblet 2026-05-29 (#634 follow-up) | `.claude/settings.json` matcher `Read\|Write\|Edit\|Grep` (var config-drift fra scriptets header) |
| PostToolUse: output-sanitizer (bash) | ✅ Bygget #634-AC2 | [`.claude/hooks/sanitize-secrets.sh`](../.claude/hooks/sanitize-secrets.sh) |
| PostToolUse: output-sanitizer (pwsh) | ✅ Bygget #634-AC2 | [`.claude/hooks/sanitize-secrets.ps1`](../.claude/hooks/sanitize-secrets.ps1) |
| Wrapper: probe-railway-keys (ps1+sh) | ✅ Bygget #634-AC3 | [`scripts/probe-railway-keys.ps1`](../scripts/probe-railway-keys.ps1), [`scripts/probe-railway-keys.sh`](../scripts/probe-railway-keys.sh) |
| Wrapper: probe-vercel-keys (ps1+sh) | ✅ Bygget #634-AC3 | [`scripts/probe-vercel-keys.ps1`](../scripts/probe-vercel-keys.ps1), [`scripts/probe-vercel-keys.sh`](../scripts/probe-vercel-keys.sh) |
| Pre-commit gitleaks (lokal) | ✅ Bygget #634-AC5 | `.git/hooks/pre-commit` + [`scripts/install-git-hooks.ps1`](../scripts/install-git-hooks.ps1) |
| CI secret-scan workflow | ✅ Allerede live (pre-#634) | [`.github/workflows/secret-scan.yml`](../.github/workflows/secret-scan.yml) |
| HOT-tier memory: secret-leak-prevention | ✅ Pre-existed, opdateret #634-AC4 | `feedback_secret_leak_prevention.md` |
| Test-fixture + verifikation | ✅ Bygget #634-AC6 | [`scripts/test-sanitize-secrets.ps1`](../scripts/test-sanitize-secrets.ps1) |

## Når en ny vektor opdages

1. Tilføj en række i den relevante tabel (A-G) ovenfor.
2. Hvis vektor er en CLI-command der printer values: opdatér `block-dangerous-secret-commands.sh` med ny pattern.
3. Hvis vektor er en ny secret-format (fx ny provider): opdatér regex i `sanitize-secrets.sh` + `sanitize-secrets.ps1` + `.github/workflows/secret-scan.yml` (eller gitleaks-config).
4. Hvis vektor blev fanget i en real session: log incident i `.claude/learnings/<dato>-secret-leak-<provider>.md` med post-mortem.
5. Opdatér `feedback_secret_leak_prevention.md` hvis ny "ALDRIG kør X"-regel skal i HOT memory.

## Refs

- [#634](https://github.com/NicolaiDolmer/CyclingZone/issues/634) — denne issue (permanent forebyggelse)
- [#296](https://github.com/NicolaiDolmer/CyclingZone/issues/296) — leak 1 (Supabase JWT in setup.py)
- [#620](https://github.com/NicolaiDolmer/CyclingZone/issues/620) — leak 2 (railway variables --json)
- [#563](https://github.com/NicolaiDolmer/CyclingZone/issues/563) — Infisical-migration (eliminerer root cause langsigtet)
- [`.claude/learnings/2026-05-11-supabase-key-rotation.md`](../.claude/learnings/2026-05-11-supabase-key-rotation.md) — postmortem #296
