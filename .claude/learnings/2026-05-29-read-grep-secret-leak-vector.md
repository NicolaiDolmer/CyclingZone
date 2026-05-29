# Postmortem: Read/Grep secret-leak-vektor (udækket af #634-guards)

**Dato:** 2026-05-29
**Type:** Sikkerheds-guard-gap (forebyggelses-hul, ikke prod-incident)
**Refs:** #634 (oprindelig forebyggelse), #296 + #620 (tidligere leaks)

## Hvad skete der

Et Discord bot-token i klartekst i `.mcp.json` (gitignored, aldrig committed) blev
dumpet til agent-transcript 2× på én dag: en session-læsning + en `Grep` udført af en
agent mens den undersøgte selve token-eksponeringen. Ironien: agenten lækkede tokenet
mens den arbejdede på at sikre det.

## Root cause

To komplementære #634-guards havde et hul ingen af dem dækkede:
- **PreToolUse** (`block-dangerous-secret-commands.sh`) scanner kun `tool_input`. For
  `Read`/`Grep` er input bare en sti — tokenet er i `tool_response`, som hooken ikke rører.
- **PostToolUse** (`sanitize-secrets.sh`) *scanner* `tool_response`, men var i
  `.claude/settings.json` kun koblet på `Bash|PowerShell|mcp__.*`. Scriptets EGEN header
  (`:2`) deklarerede `Read|Write|Edit|Grep` → **ren config-drift**: kontrakten sagde ét,
  registreringen et andet.

`Read`/`Grep` mod en secret-fil faldt mellem de to stole. `SECRET_LEAK_VECTORS.md:98`
påstod endda at "sanitizer fanger output" for Read — men det var aspirationelt, aldrig
koblet på. Samme klasse fejl som #296's forward-guards der blev "ideas" og aldrig bygget.

## Fix (defense-in-depth, 2 lag)

- **Lag A (primær):** PreToolUse-block af `Read`/`Grep` mod secret-fil-stier
  (`.mcp.json`, `*.env`, `*.env.*`, `*/secrets/*`; whitelist `.example/.sample/.template`).
  Indholds-uafhængig, nul falsk-positiv på normal kode.
- **Lag B (backup):** `Read|Write|Edit|Grep` tilføjet til PostToolUse-sanitize-matcheren
  (bringer config i sync med scriptets header). Fanger kendte secret-patterns selv i
  ukendte/nye secret-filer.
- **Lag C:** `scripts/test-sanitize-secrets.ps1` udvidet med block- + sanitize- + anti-FP-
  cases (44/44 PASS). Live-verificeret: `Read`/`Grep` mod `.mcp.json` → exit 2; normal
  fil → exit 0.

## Forward-guards (forhindrer gentagelse af DENNE klasse)

1. **Config-drift-fælde:** når en hook-scripts header deklarerer en matcher, skal
   `.claude/settings.json` matche den. Overvej en test der asserterer at PostToolUse-
   matcheren ⊇ scriptets deklarerede matcher.
2. **Aspirationelle doc-claims:** `SECRET_LEAK_VECTORS.md`-rækker der siger "X fanger
   dette" skal pege på en faktisk test, ikke en intention. `:98` var et eksempel.
3. **Backwards-check udført:** alle lokale secret-filer kortlagt (`.mcp.json`,
   `backend/.env`, `frontend/.env`, `frontend/.env.production`,
   `.codex.local/supabase-readonly.env`) — alle dækket af lag A's sti-mønstre.

## Stadig åbent (bevidst)

- **Token-rotation udskudt** af owner indtil forebyggelsen stod + var testet (nu opfyldt).
  Rotation + lag D (env-injection `${DISCORD_TOKEN}` i `.mcp.json`) er næste skridt;
  runbook i `docs/DISCORD_MCP_SETUP.md`.
