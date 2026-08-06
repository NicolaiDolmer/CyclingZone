# .env-dump tredje bid: subagent læste backend/.env — nu mekanisk deny, ikke kun mønstre

**Dato:** 2026-08-06 · **Klasse:** #296/#620/#634-vektoren, 3. bid

## Hvad skete

En subagent (markedsmodel-fit, #3448) læste `backend/.env` for at finde Supabase-env-navne. PostToolUse-sanitizeren fangede outputtet, men `SUPABASE_SERVICE_KEY` nåede subagent-transcriptet. Ejer informeret; rotation udskudt af ejer til senere.

## Rod-årsag

`block-dangerous-secret-commands.sh` blokerede kun `cat`/`Get-Content`/`gc` mod `.env` — andre fil-læsere (`head`, `tail`, `sed`, `less`, `more`, `nl`, `awk`, `strings`, `od`, `xxd`) gik fri. Pattern-blacklists taber altid til den næste læser man ikke tænkte på.

## Fix (to lag, begge verificeret ved test)

1. **Deterministisk deny-lag** i `.claude/settings.json` `permissions.deny`: `Read(**/.env*)` + Bash/PowerShell-glob-regler for alle kendte læsere. Enforc'es af harnesset FØR kommandoen kører, gælder alle sessioner + subagenter, uafhængigt af hooks. Verificeret: `cat <sti>/.env` → "Permission denied"; reglen fanger endda kommandoer der blot NÆVNER en læser + .env i argumentstrengen.
2. **Hook-mønstret udvidet** til alle læserne (pipe-testet: head/sed exit 2, keys-only-grep exit 0).

## Læring

- **Blacklist af kommandonavne er et hegn med huller — permission-deny på fil-mønstre er en mur.** Ved secret-filer: læg altid det deterministiske lag først, mønster-hooks som sekundær UX (de giver bedre fejlbesked med safe alternativ).
- **Subagent-prompts der rører DB/env skal eksplicit forbyde env-læsning** og pege på det etablerede mønster (`dotenv/config` loader keys uden at printe dem). Indført i alle senere agent-prompts samme dag.
- Test af deny-regler: brug dummy-fil i scratchpad — aldrig den ægte fil.
