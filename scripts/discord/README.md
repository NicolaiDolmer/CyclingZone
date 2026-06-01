# Discord ops-scripts

Bash-scripts der kalder Discord REST API direkte (når MCP `discord_*`-tools er for langsomme/begrænsede til batch-operationer).

## Forudsætning (alle PCs)

Bot-token læses fra `DISCORD_TOKEN` eller `DISCORD_BOT_TOKEN` i process environment. Inject via Infisical eller user-env før scriptet køres. Token må ikke læses fra `.mcp.json` eller OneDrive secret-filer.

## Filer

| Script | Formål | Hvornår |
|---|---|---|
| `discord-fase1-finish.sh` | Initial server-setup (kategorier, kanaler, topics) | Reference for ny server/staging — kør ikke igen mod prod |
| `discord-i18n-step-a-renames.sh` | Rename DA → EN på alle kanaler + topics | Reference / template for fremtidige bulk-renames |
| `discord-i18n-step-a-retry.sh` | Retry-script for em-dash JSON-encoding-bug | Template ved unicode-issues |
| `discord-i18n-step-a-fix-emoji.sh` | Fix emojis der blev `??` ved single-quoted curl | Template ved unicode-issues |
| `discord-i18n-step-c-dansk.sh` | Opret 🇩🇰 Dansk-kategori + 3 gated kanaler | Reference for sprog-gated zones |
| `discord-i18n-step-d-roles.sh` | Opret `Speaks English` + `Speaks Danish` roller | Reference for sprog-role-pattern |

## Køreksempel

```bash
bash scripts/discord/discord-i18n-step-d-roles.sh
```

## Bidt-af-noter (se også #462)

- **Em-dash + emoji corruption**: `curl -d '...'` på Git Bash (Windows) mangler UTF-8 i single-quoted JSON. Workaround: heredoc til fil + `curl --data-binary @file`.
- **MCP `discord_get_server_info`** viser emojis som `??` på Windows stdout — faktisk Discord-state er korrekt; verificér via direkte REST `GET /guilds/{id}/channels` ved tvivl.
