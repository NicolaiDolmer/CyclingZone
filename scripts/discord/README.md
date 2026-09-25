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
| `sweep-pins-relaunch.mjs` | READ-ONLY: server-struktur + pins-dump med PCM-/rytter-markør-flag (#1180 pkt 7) | Genkørbar før launches/oprydninger — `infisical run --env=dev -- node ...` |
| `sweep-webhook-channels.mjs` | READ-ONLY: seneste webhook-/bot-leverance pr. aktiv spil-kanal | Genkørbar webhook-sundhedstjek uden test-post |
| `sweep-daily.mjs` | READ-ONLY: daglig sweep af forums + tekst-kanaler siden sidste kørsel | Automatiseret daglig kørsel (#2758). Forum-identifikation: se afsnittet nedenfor |

## Forum-identifikation i `sweep-daily.mjs` (#5635)

Forums identificeres IKKE på rent kanalnavn — et navn kan genbruges på tværs af
kategorier (beta-forummet hed `bugs` 21-24/9 og skyggede det rigtige `#bugs`,
som derfor blev 0-tråde uden advarsel). I stedet, i prioriteret rækkefølge:

1. **Pinnet kanal-id** (mest robust) — sæt env `DISCORD_FORUM_IDS` som et
   JSON-objekt `{"feedback-and-ideas":"<id>","bugs":"<id>","beta":"<id>"}`.
   Ingen prod-id'er må stå i repoet (hard rule 17) — sæt env lokalt/i
   Infisical/CI, aldrig i en committet fil.
2. **Kategori + navn** (fallback uden pins) — `#feedback-and-ideas`/`#bugs`
   matches på eksakt navn UDENFOR en kategori der matcher `/beta/i`.
   Beta-forummet matches på **kategorien** `beta-testing`, ikke på navn —
   navnet har allerede skiftet én gang (`bugs` → `feedback-and-bugs`).

Findes 0 eller >1 kandidater for en forventet forum, gættes der ALDRIG:
kilden markeres `missing`, sweepen skriver en `## ⚠️ ADVARSEL`-sektion øverst
i outputtet, logger til stderr, og processen slutter med exitcode 1 (grøn
exit = alle 3 forums fundet). Se `resolveForums()`/`EXPECTED_FORUMS` i
`sweep-daily.mjs` og testene i `sweep-daily.test.mjs` for detaljer.

## Køreksempel

```bash
bash scripts/discord/discord-i18n-step-d-roles.sh
```

## Bidt-af-noter (se også #462)

- **Em-dash + emoji corruption**: `curl -d '...'` på Git Bash (Windows) mangler UTF-8 i single-quoted JSON. Workaround: heredoc til fil + `curl --data-binary @file`.
- **MCP `discord_get_server_info`** viser emojis som `??` på Windows stdout — faktisk Discord-state er korrekt; verificér via direkte REST `GET /guilds/{id}/channels` ved tvivl.
