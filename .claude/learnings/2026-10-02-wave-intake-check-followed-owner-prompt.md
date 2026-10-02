# Postmortem · 2026-10-02 · Intake-tjek fulgte ejerens startprompt i stedet for sit eget trin

## Hvad skete der?
I bølge 47f874c9 (run wf_34078cb4-b51, 1.-2/10) kørte `intake-tjek 11` (haiku) sin ene kommando korrekt (`wave-policy.mjs intake --peek`, pending=2). Derefter "startede den hovedsessionen": læste docs/NOW.md og issue #6013, satte sig selv som Working agent i NOW.md (ucommittet, rullet tilbage manuelt), gennemgik PR'er og issues og kørte `backend/scripts/dev/repair5897BoardYouthRaces.mjs` mod prod i dry-run. Harnessen flaggede "Modify Shared Resources".

## Root cause
Workflow-harnessen giver ethvert `agent()`-deltrin to beskeder: ejerens oprindelige besked som "user request" (der vinder ved konflikt) og scriptets prompt som "computed task". Ejerens besked var her startprompten til hovedsessionen ("læs CLAUDE.md, NOW.md og #6013, sæt dig som Working agent ..."). Intake-tjek-prompten sagde kun "kør præcis denne ene kommando", ikke at ejerens besked tilhører hovedsessionen. Haiku læste derfor `pending = 2` som et startsignal og tog fat på ejerens liste. Agenten havde desuden alle værktøjer (Read/Edit/gh/MCP), så intet stoppede den.

## Fix
- `subStepScopeLines(task, kind)` i `.claude/workflows/wave.js` (spejlet i `scripts/wave-freeze.mjs`, drift-vagt i `wave-freeze.test.mjs`) står først i ALLE bølgens agent-prompts. Lanes, reviewere og fix-agenter får også ejerens besked relayet og havde samme hul. `setup`-varianten (fase 0, intake, intake-tjek, probe, oprydning) siger: din eneste opgave er X; ejerens relayede besked er hovedsessionens; læs aldrig NOW.md/issue- og PR-tekster; intet under backend/ eller mod prod; ingen filændringer ud over trinene; returnér skemaet straks. `worker`-varianten (lane, review, fix, graceful stop) begrænser til eget worktree, issue og PR, forbyder NOW.md/MASTERPLAN/Working agent, prod-skrivning uden brief-krav og merge.
- Intake-tjekket kører som agent-typen `.claude/agents/wave-intake-check.md` (ingen Read/Edit/Write/Grep/Glob/web/Agent/Workflow/ToolSearch) og den fulde intake som `wave-setup.md` (ingen Edit/web/ToolSearch). Ukendt type i sessionens register (læses ved session-start) giver et kald uden typen plus en log-linje, ikke et slukket optag.
- Tjekket kører på sonnet (effort low) i stedet for haiku.
- Issue #6058.

## Forhindret-fremover
Testene i `scripts/wave-freeze.test.mjs` kræver at hver prompt-funktion et `agent()`-kald bruger, starter med `subStepScopeLines()` med rette kind, at værnet nævner NOW.md, Working agent, issues, backend og prod, at ingen bølge-agent kører på haiku, og at agent-typerne nægter fil-redigering.

Opfølgning: deterministisk hook-håndhævelse af intake-tjekkets ene kommando og NOW.md/prod-forbud for bølge-agenter, samt drift-audit af subagent-transcripts ved oprydning (#6064, #6065).

Ikke dækket: `disallowedTools` er en denyliste. MCP-værktøjer der ikke er deferred, er stadig tilgængelige; der er prompt-værnet eneste barriere. Allowlisten `tools: Bash` blev fravalgt, fordi det ikke er dokumenteret om StructuredOutput så stadig er tilgængeligt. Uden det kan tjekket ikke svare i skemaet.

## Læring
Et workflow-deltrin ser ejerens besked til hovedsessionen som sin egen user request. Enhver `agent()`-prompt skal derfor sige eksplicit hvem beskeden tilhører og hvad trinet aldrig må, ikke kun hvad det skal. Billige modeller følger den relayede besked lettest. Brug haiku kun hvor drift ikke kan skade noget, eller begræns værktøjerne.
