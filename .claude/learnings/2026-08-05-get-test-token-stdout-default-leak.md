# Secret-leak: `get-test-token.mjs` havde stdout som eneste output-kanal (4. bekræftede store leak)

**Dato:** 2026-08-04 20:00 (leak) / 2026-08-05 (fix)
**Type:** Secret-leak (4. bekræftede store leak — jf. #296, #620, #634-follow-up 2026-05-30)
**Eksponeret:** Supabase `access_token` for `test-a@cyclingzone.dev` (`is_test_account=true`, lav blast radius — ingen prod-data rørt, ingen gist oprettet).
**Refs:** [#3342](https://github.com/NicolaiDolmer/CyclingZone/issues/3342), [#3336](https://github.com/NicolaiDolmer/CyclingZone/issues/3336) (arbejdet der udløste det), [#634](https://github.com/NicolaiDolmer/CyclingZone/issues/634) (hook-systemet).

## Hvad skete der

En subagent kørte `scripts/get-test-token.mjs --email=test-a@cyclingzone.dev` for at logge ind som testbruger og verificere en UI-ændring under #3336. Scriptet printede det fulde JWT til stdout — som i en agent-session ER transcriptet. `sanitize-secrets.sh` (PostToolUse) fangede det på næste kald, men først EFTER tokenet allerede stod i konteksten. Agenten stoppede selv, ryddede op og skiftede til read-only verifikation — ingen eskalering.

## Rod-årsag (ikke symptom)

Scriptets **hele formål** var at udsende en JWT på stdout — der fandtes ingen anden kanal. Det er ikke en engangs-kommando-fejl (som `railway variables` eller `infisical secrets`, hvor en sikker form også findes); det var et purpose-built værktøj hvor den "korrekte" brug OG leak-vektoren er identiske. Ingen deny-list-regel kan fikse det uden at ændre selve scriptet — modsat #634-hullerne, hvor problemet var manglende dækning af en ellers-undgåelig kommandoform.

## Fix (verificeret samme session)

- **Default-kanal ændret:** scriptet skriver nu til en gitignored fil (`.codex.local/test-token.json`, `--out=<path>` for override) og printer kun stien. `--print` bevarer den gamle adfærd — kun til manuel terminalbrug, advarsel i `--help` + på stderr ved hvert kald.
- **Hook-parity:** `--print`-formen blokeres kategorisk i `block-dangerous-secret-commands.{sh,ps1}` (samme mønster som `infisical secrets/export`). Fandt OG rettede en selvstændig bug undervejs: Lag A's Python path-scan matchede kun secret-stier med et leading `/` (`"/secrets/" in pl`) — en relativ sti som `.codex.local/test-token.json` (uden leading slash, som er præcis den form Read-tool'et sender) matchede IKKE. Fanget af egen test FØR commit, ikke af CI.
- **Ny artefakt-risiko dokumenteret proaktivt:** selve output-filen er lige så følsom som `--print` — tilføjede blok for `cat`/`Get-Content`/`Read`/`Grep` mod `.codex.local/test-token*.json`, selvom ingen leak er sket den vej endnu (forward-guard, ikke retro-fix).
- Test: 14/14 nye cases (`scripts/test-block-dangerous-secret-commands.sh` — ny fil, ingen test af denne hook eksisterede før) + regression på eksisterende railway/vercel/infisical/.env-mønstre.
- Inventar: gennemsøgte `scripts/` + `backend/scripts/` for samme mønster (secret-værdi til stdout som scriptets formål). Kun `get-test-token.mjs` ramte. `smoke-test-prod.mjs` bruger et token internt men printer det aldrig. `rotate-supabase-key-dev-from-prod.ps1` har allerede et bevidst temp-fil+filter-design der aldrig printer værdien.

## Forward-guard / generel regel

- **Et script hvis eneste formål er at udsende en secret er en leak-vektor by design** — ikke en agent-fejl der kan trænes væk. Enhver ny "hent en secret/token"-hjælper skal have fil-først, print-kun-sti som default fra dag 1, ikke som eftertanke.
- **Test PreToolUse-hook-ændringer mod BEGGE sti-former** (relativ og absolut/nested) — Lag A's path-scan er skrevet til `/`-præfikserede substrings og fanger ikke relative Read-stier uden manuel verifikation. Samme klasse fejl som #634's deny-list-huller, men i path-matching frem for command-matching.
- **Når du introducerer et nyt gitignored output-artefakt der bærer en secret:** dokumentér og bloker læsning af DET artefakt i samme PR, ikke som separat follow-up — ellers gentager man præcis det mønster #634 selv opstod af (fix uden forward-guard for den nye overflade man lige skabte).
