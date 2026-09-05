# Natbølge 2026-09-05 (ejer-GO 5/9 kl. 22:2x "A–F, 23 spor")

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 6/9 00:55 (bølge A+B launched) → ca. 06:xx (sidste fixup) · merge-runde 6/9 formiddag med ejer-go |
| Agenter launched / fuldført / frosne | 7 workflows (A 18 spor, B 8, C 3 recovery, D 1 recovery, E 7 rest, F 1 recovery, G 4 CI-fixups): 30 spor-agenter + 4 fixups; 6 frøs tavst (harness), alle 6 spor leveret via recovery i samme worktree |
| PR'er åbnet / merged | 28 åbnet i nat (#4784–#4810 + F) / merges = formiddag (ejer-go) |
| Issues → claude:done | udfyldes PR-for-PR i merge-løkken |
| gh-401-retries | 0 observeret |
| Recoveries (type) | 6: pushed-commit+dirty 1 (#4734), unpushed commit 1 (rage-clicks), dirty-only 3 (LCP, pile-rest, dublet-ITT), PR-allerede-oprettet 1 (#4495, ingen handling) |
| Prod-mutationer | ingen (alle reparationer leveret som dry-run-scripts, apply = ejer-GO) |
| Preflight | GO kl. ~22:15 (.codex.local/night-wave-preflight.json) |

## Spor (prioriteret kø; model eksplicit)

| # | Spor | Issues | Bølge | Model | PR | Merge-politik | Bemærkning |
|---|---|---|---|---|---|---|---|
| 1 | Backend-tekster via nøgler | #4734 | A→C | opus | #4797 | merge 09 efter review | frøs 01:12, recovery; ingen ny migration (metadata-kontrakten fandtes, #666); CI: swallowed-catch → G |
| 2 | Usolgt graduate-auktion | #4495 | A | opus | #4789 | merge 09; reparations-script apply = GO | agent frøs EFTER PR |
| 3 | Mekanisk udgang + solgt rytter | #4520 #4119 | A | opus | #4785 · #4794 (draft) | #4785 merge 09; #4794 visuelt go | 100 % af mekaniske udgange gav skade; ingen screenshot på #4794 (mock har én rytter) |
| 4 | Rage/dead clicks | #4501 #4500 #4498 | A→C | opus | #4795 (draft) | visuelt go | frøs 01:07 (push); rytterprofil ikke screenshot-verificeret; 6 fund → #4813 #4814 #4815 |
| 5 | LCP dashboard/training | #4160 | A→C | opus | #4800 | merge 09 efter preview-blik | frøs 01:08; kun mock-måling; getUser→getSession skal ses på preview |
| 6 | Etape-ikoner sprint/rolling | #4748 #4487 | A | sonnet | #4791 (draft) | visuelt go | kalender/planlægger stadig server-bucket (#4596, #4815) |
| 7 | Sticky tabelhoved | #4747 | A | sonnet | #4796 (draft) | visuelt go | |
| 8 | Tekst <10 px + vagt | #4624 | A | sonnet | #4799 (draft) | visuelt go | /seasons-skygger er bevidst teknik (#2795) → ejer-valg #4814 |
| 9 | Akademi-intake +2 | #4750 | A | sonnet | #4801 | merge 09 | rod-årsag + prod-tal i PR |
| 10 | Udbrudsjæger-visning | #4746 | A | sonnet | #4803 (draft) | ejer-go (RACE_ENGINE_RULES §7) | ingen screenshots (browser-pane ustabil) |
| 11 | Compare på ranglisten | #4749 | A | sonnet | #4802 (draft) | visuelt go | CI: em-dash → G |
| 12 | Dublet-enkeltstart | #4539 | A→E | sonnet | #4806 | merge 09; reparations-script apply = GO | stoppet med A, fortsat i E fra 1 dirty fil |
| 13 | Bestyrelsesmål + bonus | #4377 #3574 | A→E | sonnet | #4808 · #4809 | merge 09 | #4377 var allerede rettet (PR #4549/#4550/#4046) → verificér + luk; CI: Supabase-vagter → G |
| 14 | Kontraktbesked kan lukkes | #4387 | E | sonnet | #4807 | merge 09 (ejer-ja i tråd 29/8) | |
| 15 | Pile-rest i locales | #3422 | E→F | sonnet | #4817 | merge 09 | #3422 selv leveret af #4743 3/9; frøs 04:07, recovery fra 13 dirty filer; rest: plannerShared.js "↓" + admin-metrics (i #4815-klassen) |
| 16 | Auto-merge-label | #4404 | E | sonnet | #4804 | ejer bekræfter 4/9-beslutning | worker fandt ejerens låste beslutning og FJERNEDE workflowet i stedet for briefens PAT-vej |
| 17 | Preflight-vagter + shard-budget + board-dry-run | #4783 #4711 #4715 | E | sonnet | #4805 | merge 09 | |
| 18 | Whitelist + ti guards i ét job + webkit-flake | #4580 #4505 #4424 | E | sonnet | #4810 | merge 09 | #4424 karantæne, ikke rod-årsag |
| 19 | Sprogudvidelse (rapport) | #4110 | B | sonnet | #4784 | merge 09 | browser_language 0 rækker → #4811 |
| 20 | EN/DA-konsistens A | (i18n) | B | sonnet | #4787 | merge 09 | 22 filer; CI: alle e2e-shards røde → G |
| 21 | EN/DA-konsistens B | (i18n) | B | sonnet | #4786 | merge 09 | CI: mobile-webkit → G |
| 22 | Sponsor-D3 (rapport) | #4544 | B | sonnet | #4788 | merge 09 | |
| 23 | Tre balance-målinger | #4704 #4489 #4417 | B | sonnet | #4790 | merge 09 | kommentarer på issues |
| 24 | AI-triage A | 15 issues | B→D | sonnet | #4798 | merge 09 | frøs 01:45 (flerlinjet kommando); 6 ejer-valg i audit-filen |
| 25 | AI-triage B | 19 issues | B | sonnet | #4793 | merge 09 | |
| 26 | Stale-audit spand A+B | #3154 | B | sonnet | #4792 | merge 09 | spand B "18 par" fandtes ikke i 4/9-filen (min brief pegede forkert; de 18 par er fra 31/8-auditten) |

## CI-fixups (bølge G + recovery, 05:05-06:15)

Seks PR'er var røde efter første CI-kørsel; alle rettet af sonnet-fixup-workers uden at røre vagterne: #4802 em-dash i to strenge · #4797 markerede best-effort-catches efter swallowed-catch-guardens regel · #4808 `.order("id")` på fetchAllRows · #4809 error-tjek + paginering i api.js · #4787 e2e-forventning fulgte den rettede pil-streng (en fixup-agent frøs midt i commit, recovery-agent afsluttede) · #4786 var en webkit-flake (9/9 lokalt), shard re-kørt.

## Afvigelser/læringer

- **Frosne agenter holder deres samtidigheds-plads.** Seks agenter frøs tavst midt i almindelige Bash-kald (push, sed, test, gh, cat). Per-spor-timeout fyrede, men den nye `agent()` stod i kø bag den frosne, så bølge A kørte på 2 laner fra 01:12 til 03:50. Løsning der virkede: stop workflowet, relancér resten som ny bølge, recovery i samme worktrees. Postmortem: `.claude/learnings/2026-09-06-frozen-workflow-agents-hold-concurrency-slots.md`. Runbook opdateret.
- **Dispatch-forfilteret fangede state, ikke beslutninger.** #3422 var leveret (PR #4743) og #4377 var rettet af tre PR'er; #4404 havde en låst ejer-beslutning 4/9 i tråden. Workers fangede det selv (godt), men forfilteret skal også læse sidste ejer-kommentar.
- **Ingen patch notes i PR'er** (bølge-regel) holdt; én samlet note skrives efter merge-runden.
- 6 opfølgnings-issues oprettet fra out-of-scope-fund: #4811 browser_language tom · #4812 dependabot-auto-merge · #4813 transferhistorik døde rækker · #4814 to designvalg (foto-plads, /seasons-skygger) · #4815 småfund design · #4816 småfund ops.

_Refs #605._
