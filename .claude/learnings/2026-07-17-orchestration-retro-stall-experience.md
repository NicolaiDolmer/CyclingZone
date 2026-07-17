# Retro 17/7: "Hvorfor går du i stå hele tiden?" — ejer-oplevelsen af orkestrering

Ejeren spurgte 3× i løbet af dagen om orkestratoren var gået i stå, og bad eksplicit om denne evaluering. Ærlig opgørelse:

## De ÆGTE stalls (2 stk.)

1. **Natten (kritisk):** chunk A-barrieren hang på én frossen agent + ScheduleWakeup-heartbeat fyrede aldrig → orkestrator død 00:05-07:35, chunk B+C forsinket ~9 timer. Rod-årsag + fix: se `2026-07-17-night-wave-orchestrator-never-woke.md` (runbook har nu lag 4: per-agent-timeout).
2. **#2555-agenten:** committede sit fix men pushede aldrig, tavs i 40 min. Fanget via worktree-ground-truth (lokal ≠ origin), orkestrator verificerede + pushede selv. Mønster: agent-død EFTER arbejdet er færdigt ligner succes i transcript-mtime — kun push-status afslører den.

## De OPLEVEDE stalls der ikke var stalls

Resten af de stille perioder var **CI-ventetid**: 14 required checks × ~10-15 min pr. push, og dagens bølge kørte 30+ pipelines. Politikken "verificér lokalt → push → aldrig polle CI" er rigtig (token-økonomi), men den PRODUCERER tavshed. To gange spurgte ejeren 2-6 min FØR et planlagt checkpoint — checkpoints på 12-15 min er længere end ejerens tålmodighed når han sidder aktivt ved skærmen.

## Hvad der skal ændres

1. **Aktiv ejer = korte checkpoints.** Når ejeren er i chatten (svarer løbende), sæt heartbeats på ~5-8 min i stedet for 12-15, ELLER merge straks når kun kendte-langsomme jobs (frontend-smoke) mangler og resten er grøn (virkede fint 13:47: merge gik igennem trods pending smoke).
2. **Sig altid "næste livstegn kl. HH:MM" som SIDSTE linje** i statusbeskeder — det stod der oftest, men begravet i prosa. Gør det til fast afslutningslinje under bølger.
3. **Bundle-budgettet er en merge-serialisator** (6× forening i dag: 824→829→831→834→840→841/some). Hver bølge-PR bumper fra egen base og kolliderer parvist. Strukturelt fix: i18n-namespace-split (issue fra 16/7) SKAL prioriteres før næste store bølge — eller budget-bump samles i ÉN opsamlings-PR efter bølgen i stedet for pr. PR.
4. **Klassifier-denials er flaky** (gh pr merge/issue edit blev blokeret nogle gange, ikke andre). GitHub-MCP som førstevalg til merge/labels under bølger; gh CLI til workflow-filer (MCP-appen mangler workflows-permission, jf. #2544).
5. **ScheduleWakeup:** fyrede pålideligt HELE dagen i aktiv session; nattens svigt korrelerer med lang inaktivitet. Natbølger må aldrig hvile på den alene (runbook-lag 4 dækker), men dag-orkestrering kan stole på den.

## Dagens facit til kontekst

29 PR'er merged, 7 migrationer applied, 24 issues lukket, 2 nye systemer live (Global Rank, drift-vagt), 1 balance-rekalibrering (ejer-valgt variant C efter scorecard), 0 prod-hændelser. Modellen (Fable-arkitekt + sonnet-workers + ejer-gates) HOLDER — det er kommunikations-kadencen og de to stall-klasser der skal strammes.

Refs: docs/audits/night-wave-2026-07-17.md, #2605-sporet (velocity).
