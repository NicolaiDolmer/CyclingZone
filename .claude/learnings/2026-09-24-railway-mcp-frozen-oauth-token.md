# Postmortem · 2026-09-24 · Railway-MCP "Unauthorized" midt i sessionen (frosset OAuth-token)

## Hvad skete der?
Siden juli svarede Railway-MCP'en (`railway mcp`, user-scope i `~/.claude.json`) `Failed to get project: Unauthorized. Please run railway login again` efter et stykke tid i en session, mens `railway`-CLI'en på samme PC virkede (#2409, ejer-kommentar 22/9 på #5484). Den daglige Sentry/Railway-triage mistede log-vinduer (10/8: 17:33-23:37 UTC kunne ikke hentes).

## Root cause
Railway CLI 4.65.0 (installeret 28/5) byggede i `serve_stdio()` sin HTTP-klient én gang med `Authorization: Bearer <access-token>` som default-header. OAuth-access-tokenet lever 1 time (`tokenExpiresAt` = skrivetid + 3600 s i `~/.railway/config.json`). CLI'en fornyer tokenet ved hver kommando, men MCP-processen lever i timer og fornyer aldrig. Kaldet fejler derfor, så snart tokenet den læste ved opstart, udløber, og `railway login` i en anden terminal hjælper ikke. Upstream bekræfter det i railwayapp/cli#1035 og har rettet det fra v5.30.3.

Evidens fra 558 connect-logs (`%LOCALAPPDATA%\claude-cli-nodejs\Cache\*\mcp-logs-railway\*.jsonl`): aug-sep fejlede processerne altid efter 6-304 min og aldrig ved opstart. Fejlen blev reproduceret live 24/9 kl. 09:44Z: samme `list_services`-kald virkede kl. 09:36 og fejlede efter `tokenExpiresAt` 09:43:03.

Anden fejlklasse (jun-jul, 27 tilfælde): `failed to refresh OAuth token: invalid_grant` ved opstart. Railway roterer refresh-tokenet ved hver fornyelse, så to samtidige processer, der fornyer med samme refresh-token, taber til hinanden. v5 serialiserer fornyelsen med en fil-lås og genindlæsning af config.

## Fix
- DOLMERPC: `npm i -g @railway/cli@latest` (4.65.0 → 5.62.1). Bare `railway mcp` er nu en stdio-proxy til `mcp.railway.com` med frisk token pr. kald.
- `.claude/settings.json`: `deniedMcpServers` blokerer plugin-dubletten `plugin:railway:railway` (samme remote-server via Claude Codes egen OAuth, som ikke kan gennemføres i desktop-sessioner) på URL. Plugin'ens skill og hook bevares.
- `.claude/settings.json`: deny på `mcp__railway__list-variables` (+ v4-navnet), fordi den returnerer secrets i klartekst.
- `scripts/agent-doctor.ps1`: nyt `railway-cli`-tjek advarer under 5.30.3.
- `docs/CROSS_PC_SETUP.md`: engangs-trin til NICOLAIPC og EMMAPC.

## Forhindret-fremover
`agent-doctor.ps1` flager gamle CLI-versioner. CROSS_PC_SETUP har trinene, og `bootstrap-pc.ps1` installerer allerede `@railway/cli` upinnet (= nyeste) på nye PC'er.

## Læring
"Tool X virker, men dens MCP-server gør ikke" betyder ofte at en langlivet MCP-proces har cachet en kortlivet credential. Mål processens alder ved fejl i connect-loggene, før du jagter tokens og scopes: fejler den altid efter N minutter og aldrig ved opstart, er det udløb i processen. Tjek også upstream-changelog for den installerede version, før du bygger en workaround. Her lå fixet klar i 7 uger, mens #2409 foreslog en Infisical-token-omvej.
