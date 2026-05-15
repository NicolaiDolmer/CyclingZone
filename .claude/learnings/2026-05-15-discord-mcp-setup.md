# Discord MCP server-opsætning — findings 2026-05-15

## Kontekst

Første gang vi brugte Discord MCP til at bygge community-server fra bunden (#415 epic, 17 issues #415-431). Server `1504615050831466669`. Bot: Cycling Zone#8784.

## MCP-værktøjer der virkede

| Tool | Use case | Note |
|---|---|---|
| `discord_login` | Login | Idempotent; "Already logged in as ..." besked OK |
| `discord_get_server_info` | Verificér adgang + kanal-state | Returnerer alle eksisterende kanaler + features |
| `discord_create_category` | Opret kategorier | `position` virker — kan sortere |
| `discord_create_text_channel` | Opret tekst-kanaler | Se begrænsning nedenfor |
| `discord_create_webhook` | Opret webhooks | Returnerer ID + token i klartekst |
| `discord_send` | Post besked som bot | Indhold posted som "Cycling Zone#8784" |

## ⚠️ MCP-begrænsninger der bed

### 1. `discord_create_text_channel` har INGEN parent/categoryId-parameter
- Alle kanaler oprettes på root-niveau
- User skal manuelt trække 16+ kanaler ind i kategorier i Discord UI
- **Fremtidig fix:** check om nyere MCP-version har `parentId`-param; ellers acceptér manuelt step

### 2. Ingen `discord_create_forum_channel`
- `discord_create_forum_post` findes, men kun til at poste i eksisterende forum
- `discord_get_forum_channels` findes til at læse
- **Workaround:** opret som text-channel, user konverterer manuelt (Edit Channel → Channel Type → Forum)
- Sæt eksplicit warning i kanal-topic (`⚠️ KONVERTÉR TIL FORUM`) så det ikke glemmes

### 3. Bot kan ikke invitere sig selv
- Server-info-call fejler med template-URL hvis bot ikke er i serveren
- User skal til https://discord.com/developers/applications → OAuth2 URL Generator
- Scopes: `bot` + `applications.commands`, Permissions: `Administrator`

### 4. Webhook-tokens returneres i klartekst i tool-response
- Tokens er secrets — må IKKE i public commits eller offentlige issue-bodies
- **Mønster:** kommentér kun webhook-ID på issue, lad user hente URL fra Discord Server Settings → Integrations → Webhooks
- For GitHub-webhooks: husk `/github`-suffix på URL

### 5. Stock-default-kanaler kan ikke slettes via MCP listet tool-set
- Server kommer med "Tekstkanaler"/"Talekanaler" + #generelt + #klip-og-højdepunkter + Lobby + Spil
- Bør slettes manuelt af user — eller acceptér de hænger ved indtil cleanup

## Mønster der virkede godt

### Issue-først, så execution
1. Opret parent epic-issue
2. Opret 16 sub-issues med konkrete acceptance criteria
3. Eksekver det jeg kan via MCP
4. Kommentér på sub-issues med næste skridt + IDs
5. User picks up resten manuelt — alt dokumenteret

### Body-filer fremfor heredocs
Per memory-rule "Bash-tool — multi-line commit via `git commit -F`": skrev hver issue-body til `.tmp-discord-issues/NN-name.md` så `gh issue create --body-file` virkede uden quoting-helvede. 17 issues på <5 min.

### Sekventiel parent-først for issue-numre
Opret parent → få number → opret children → opdatér parent body med rigtige numre. Placeholder `#__1` i parent-draft erstattes 1:1 efter children er oprettet.

## Næste gang vi rører Discord MCP

- Forvent at user skal lave 5-15 min manuel UI-arbejde EFTER MCP-execution (parent-routing, forum-conversion, permissions)
- Skriv det manuelle arbejde EKSPLICIT i issue-kommentar med checklist
- Verify bot er invited FØR du forsøger struktur-creation
- Stock-defaults fra ny server — gør user opmærksom på de skal slettes manuelt
