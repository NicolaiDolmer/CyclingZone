# Postmortem · 2026-09-24 · Discord-MCP timeoutede ved samtidige sessioner (#5484)

## Hvad skete der?
To Discord-MCP-servere fejlede ved sessionstart. `plugin:discord:discord` gav `Connection closed` hver gang (275/275 siden august). `discord` (`npx -y mcp-discord`) gav `CONNECT_TIMEOUT` efter 30 s i 30 % af opstarterne i september (22 % i august, 0 % i juni-juli), så Discord-triage faldt tilbage på `sweep-daily.mjs`.

## Root cause
1. **`discord`:** `mcp-discord` venter (`await autoLogin()`) på en Discord gateway-login FØR den starter MCP-stdio-transporten. Discord tillader én gateway-IDENTIFY pr. 5 s pr. bot (`GET /gateway/bot` → `max_concurrency: 1`). Når flere sessioner starter samtidig (bølger, genstart af appen), står de i kø: målt 4,9 / 9,8 / 14,8 / 20,3 / 22,1 / 31,7 s for 6 på én gang. Nr. 6 og op ryger over 30 s. Fejlraten steg i takt med flere parallelle sessioner. `npx` lagde 2-6 s oveni.
2. **`plugin:discord:discord`:** Det officielle Discord-*channel*-plugin (chat-bro, ikke læse-connector) kører `bun`, som aldrig var installeret: `'bun' is not recognized`. Det var aldrig sat op (ingen `--channels`, ingen token-fil) og blev ikke brugt.
3. **Latent:** OneDrive-kilden `CyclingZone-context\secrets\mcp.json` (hardlinket ind i 54 worktrees) havde en inline `DISCORD_TOKEN` fra 6/5, som var roteret (HTTP 401). Claude Code lader `env` i `.mcp.json` vinde over forældre-miljøet (verificeret 24/9 med en probe-server). En desktop-worktree-session læste alligevel fint 24/9, så desktop-appen læser tilsyneladende main-checkoutets `.mcp.json` (slutning ud fra evidens, ikke dokumenteret). Derfor ramte den døde token ikke i praksis, men enhver session der læser worktree-filen, ville få den.

## Fix
- `scripts/discord/mcp-readonly-server.mjs`: egen read-only MCP-server uden afhængigheder, der kun bruger REST (ingen gateway). Handshake på 0,1 s, også med 6 samtidige; 4 friske `claude -p`-sessioner forbandt på 1,3-1,9 s og læste en kanal. Samme tool-navne som `mcp-discord`, ingen skrive-tools.
- `scripts/setup-discord-mcp.ps1`: installerer serveren i `%LOCALAPPDATA%`, skriver secret-fri `.mcp.json` (også OneDrive-kilden, in-place så hardlinks følger med), synker `DISCORD_TOKEN` fra Infisical til User env og slår channel-pluginet fra.
- CI kører `scripts/discord/mcp-readonly-server.test.mjs`.

## Forhindret-fremover
- Testen låser, at handshaket ikke venter på netværk, og at serveren ikke har skrive-tools.
- `setup-new-pc.ps1` kører altid Discord-setuppet (sprang før over, hvis en `.mcp.json` fandtes, og beholdt dermed gammel config).
- Connect-tider kan måles i `%LOCALAPPDATA%\claude-cli-nodejs\Cache\<projekt>\mcp-logs-<server>\*.jsonl`.

## Læring
En MCP-server må aldrig lave langsomt eller rate-begrænset netværksarbejde, før den svarer på `initialize`. Log ind dovent ved første tool-kald, ellers bliver hver sessionstart afhængig af eksterne kvoter. Og "den forbinder nogle gange" er et målbart mønster: saml connect-tider fra MCP-loggene, før du gætter.
