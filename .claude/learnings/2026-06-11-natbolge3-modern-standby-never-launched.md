# 2026-06-11 — Natbølge 3 blev aldrig kørt: Modern Standby + launch efter tur-grænse

## Symptom

Ejer godkendte natbølge 3 (4 spor, ~19 agenter, auto-merge grønne PR'er) kl. ~00:15 og lod PC'en stå tændt natten over. Om morgenen: 0 agenter startet, 0 PR'er, 0 audits. Sidste aktivitet var claim-commit'en til `docs/NOW.md` kl. 00:26. "fortsæt"-beskeder i løbet af natten gav tomme svar.

## Rod-årsag (to lag, verificeret)

1. **Workflow-kaldet blev aldrig sendt.** Orkestrator-turen sluttede efter NOW.md-claim+push — FØR Workflow-launchen. Der var altså intet kørende at holde i live, selv før PC'en sov.
2. **Windows 11 Modern Standby suspenderede maskinen kl. 00:30** (kernel-power event 506, 4 min efter sidste aktivitet) og holdt den i dvale til ~06:14. "Skærmen må gerne slukke" ≠ "maskinen er vågen": Modern Standby fryser alle processer inkl. Claude Code, også på strøm.

## Guards fremover

- **Launch i SAMME tur som ejer-go.** Affyr Workflow (run_in_background) først, claim/rapportér bagefter. Aldrig en tur-grænse mellem go og launch.
- **Før natkørsel:** `powercfg /change standby-timeout-ac 0` + `powercfg /change hibernate-timeout-ac 0` (skærm-timeout må gerne stå). Verificér bagefter med kernel-power events 506/507 at maskinen var vågen.
- **Ejerens sengetids-signal = synligt launch-bevis:** beskeden "Workflow wf_xxx kører — N agenter aktive". En claim-commit beviser intet.
- **Genoptagelses-net:** natplan skrives til fil (workflow-scriptPath persisteres automatisk; `resumeFromRunId` kan genoptage), så en frisk session kan fortsætte uden samtale-kontekst.

Spejlet i auto-memory: `project_multiagent_fleet_playbook.md` (natbølge 3-sektionen).
