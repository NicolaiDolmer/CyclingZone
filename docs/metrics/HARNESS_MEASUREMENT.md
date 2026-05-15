# Harness blob measurement — methodology

> **Hvorfor det er svært:** Claude Code's "harness blob" (system prompt + top-level tool schemas + deferred tool names + skill descriptions) injekteres ved API-call af klienten — IKKE gemt i jsonl-transcripts og IKKE udelukkende defineret af lokale config-filer. MCP-connectors konfigureres cloud-side via claude.ai/settings/connectors. Eneste pålidelige måling er manuel optælling af hvad agenten faktisk ser i session-startens system-reminders.

## Komponenter

| Komponent | Hvor det kommer fra | Variabilitet pr. PC |
|---|---|---|
| System prompt preamble | Hardkodet i Claude Code-binæren ("You are Claude Code…") | Identisk |
| auto-memory instruction block | Hardkodet (memory-system-instruktioner) | Identisk |
| Top-level tool schemas (Agent, Bash, Edit, …) | Hardkodet, ~14 tools med fuld JSONSchema | Identisk |
| Deferred tool NAMES | Cloud-konfigurerede MCP-connectors (claude.ai/connectors) + project `.mcp.json` | **Forskellig pr. PC/login** |
| Skills list | Enabled plugins i `~/.claude/settings.json` | **Forskellig pr. PC** |

Det er kun de sidste to der adskiller PCs — og som token-cuts kan adressere.

## Sådan tager du et nyt snapshot

1. Start ny Claude Code session i CyclingZone-repo
2. I session-startens system-reminder skal du finde to blokke:
   - "The following deferred tools are now available via ToolSearch" → tæl listen
   - "The following skills are available for use with the Skill tool" → tæl listen
3. Opdatér `docs/metrics/harness-snapshot-<hostname>.json` med:
   - `deferred_tools_count` = antal navne
   - `deferred_tools_tokens` = (gennemsnit 60 chars/navn × count) / 4
   - `skills_count` = antal skills
   - `skills_tokens` = (gennemsnit 150 chars/skill × count) / 4
4. Commit + push

Top-level tool schemas + system prompt er konstanter (~12,000 tok kombineret) — opdatér kun hvis Claude Code-binær opgraderes og prompt-formatet ændres.

## Aktuel måling (2026-05-15)

Se `docs/metrics/harness-snapshot-NICOLAIPC.json`. Headlines:

- **Total harness:** ~15,780 tok (vs hardkodet 5,700-estimate — 3x undervurderet)
- **Reel cold-start:** ~22,300 tok (file-context 6,524 + memory 1,074 + harness 15,780)
- **Post-Phase-2+3-cut target:** ~10,280 tok harness → cold-start ~17,800 → vidererefiner med C+D faser

## Hvorfor estimat var så meget for lavt

Den oprindelige hardkodede 5,700-tokens estimate i `check-agent-token-hygiene.ps1` blev sat før systematic counting af deferred-tools listen. Med 202 connectede MCP tools (mange usynlige før session-start) og 20 skills + de fulde tool schemas i prompten, er den reelle størrelse ~3x det estimat.

Per-PC variation (eksempel): hvis Microsoft Clarity, Google Drive, Gmail, Calendar disconnectes (alle med 0 brug per Phase 2-playbook), forsvinder ~31 deferred tool names = ~465 tok. Hovedvægten ligger i de connectorer der har mange tools (GitHub 41, Supabase 29, Chrome 22, Vercel 18, Discord 22).

## Fremtidig automatisering

Når Claude Code-API tilbyder programmatic adgang til injected context (i en fremtidig version), kan denne måling automatiseres. Indtil da: manuel snapshot ved enhver state-ændring.
