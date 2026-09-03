# Natbølge 2026-09-03 (den store natbølge, ejer-GO 2/9 kl. 23:44)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 2/9 23:45 → 3/9 ca. 03:30 (sidste nat-PR) · merge-runde 07:36 → 11:45 |
| Agenter launched / fuldført / døde | Nat: 29 workflow-spor (8 samtidige), 28 fuldført, 1 død tavst (anti-slop 00:22). Morgen: 22 Agent-tool-workers (fixups, e2e, S4-regler, katalog, patch note), 20 fuldført, 2 stoppet (GT-katalog hang på `cd &&` 10:13; #4670-e2e tavs 45 min) |
| PR'er åbnet / merged | 38 åbnet (32 i nat + 6 om morgenen) / **37 merget 3/9 kl. 07:36-11:40** (inkl. #4705 CI-fix, #4713 budget). Ejeren mergede 6 drafts 2/9 kl. 23:44. Åbne ved close-out: se "Rest" |
| Issues → claude:done | #4658 #4594 #4496 #4493 #4651 #4626 #3853 #2405 #4254 #2823 #4650 #4664 #4615 #4647 #4292 #4105 #2810 #1884 #4538 #4374 #4588 #4177 #4297 #3966 #4282 #4631 #4128 #3442 #4215 #4573 #4201 #4519 #4143 #4386 (34) |
| gh-401-retries (preflight-probe + bølge) | 0 i preflight (OAuth-token-advarsel, ingen fejl); 0 observeret i bølgen |
| Recoveries (type) | 3: anti-slop re-spawn (0 commits), GT-katalog re-spawn efter `cd`-hæng (0 commits), #4662 rebase fortsat i samme worktree efter to stoppede agenter (uncommitted budget-ændring bevaret) |
| Prod-mutationer med ejer-GO | bestyrelses-backfill 09:01 (13 hold, 65 rækker; post-verify 0 under 5); S4-katalog + grus auto-migreret ved merge af #4708 09:50 (race_pool 175 → 221, Toscana = gravel_classic, CHECK udvidet med gravel) |
| Preflight | GO kl. 23:19 (.codex.local/night-wave-preflight.json) |

Workflows: A = `wf_64e6c306-c6f` (opus/sonnet eksplicit pr. spor), B = `wf_e2adaf29-541` (sonnet). Scripts i sessionens scratchpad (`natboelge-A/B-2026-09-03.js`); design: lane-pool over prioriteret kø (ingen tomme slots, et frosset spor blokerer kun sin lane), per-spor-timeout 170/100/90 min, monitor hvert 20. min (frosne transcripts + PR-tal).

## Hårde afhængigheder (målt 2/9 kl. 23:30 mod prod)

- `seasons` har number 0-3; **S4 findes ikke**. Spor 1 gør S4 byggeklar (uniform tilt, scorecard i dry-run, beslutningsliste). Apply = ejer-GO om morgenen.
- **16 menneskehold uden bestyrelsesmedlemmer** (12 rigtige, 4 test), 240 menneskehold, 237 aktive mandater → [#4664](https://github.com/NicolaiDolmer/CyclingZone/issues/4664). Spor 16 leverer rod-årsag + backfill-script + vagt. Apply = ejer-GO.

## Spor (rækkefølge = køen; område-rækkefølge fra pengeplan §3)

| # | Spor | Issues | Worktree | Model | Merge-politik | Resultat |
|---|---|---|---|---|---|---|
| 1 | S4 byggeklar | #4270 #4176 | feat-4270-season4-calendar | opus | merge 09; apply = GO | PR #4667 merget 08:55; regler #4709 + katalog #4708 merget 09:50 (prod: 221 katalogloeb, Toscana grus); apply afventer #4203 + scorecard-GO |
| 2 | Ryttere + Transfers på kittet | #4628 | feat-4628-riders-transfers-kit (oven på #4657) | opus | draft, visuelt go | PR #4671, ejer-go, CI |
| 3 | Auktioner + Akademi + skjul overbudte | #4628 #4262 | feat-4628-auctions-academy-kit (oven på #4657) | opus | draft, visuelt go | PR #4670, ejer-go, e2e-rest |
| 4 | Mit hold + holdside + managerside | #4628 #4381 | feat-4628-team-pages-kit (oven på #4657) | opus | draft, visuelt go | PR #4666, ejer-go, CI |
| 5 | Playwright shards + flake-rapport + gate | #4647 #4292 #4548 | feat-4647-playwright-shard | opus | merge 09 efter review | PR #4665 merget 09:20 (e2e 27 -> 8 min) |
| 6 | Løbssiden | #4628 #2810 #1884 | feat-4628-race-page-kit (oven på #4657) | opus | draft, visuelt go | PR #4668 merget 10:01 |
| 7 | Punch/climbing-split | #4631 | feat-4631-split-punch-climbing | opus | draft, ejer-go | PR #4677 merget 10:16 |
| 8 | v4 TeamOrders + M5/M6/M14 | #4615 | feat-4615-v4-teamorders-wiring | opus | merge 09 (bag flag) | PR #4679 merget 09:11 (bag flag; jagt-kalibrering = #4707) |
| 9 | Assistent sen-udfyldning bag flag | #4201 | feat-4201-assistant-late-fill | opus | merge 09 (flag off) | PR #4673 merget 10:27 (flag off) |
| 10 | Træning: loft-visning + udbytte | #4128 #3966 | fix-4128-3966-training-ceiling-yield | sonnet | #4128 draft | PR #4675 merget 10:16; #4678 merget 10:04 |
| 11 | Taktik-lås + board-bekræftelse | #4538 #4519 | fix-4538-4519-tactics-board-confirm | sonnet | #4538 merge, #4519 draft | PR #4681 merget 10:01; #4688 ejer-go, CI |
| 12 | Bug-sweep | #4374 #4588 #4594 | fix-4374-4588-4594-bug-sweep | sonnet | merge 09 | PR #4672 #4676 #4682 merget |
| 13 | Kalender-glyffer + celle | #4143 #4386 | feat-4143-4386-calendar-glyphs | sonnet | draft, visuelt go | PR #4685 v2 (silhuetter), ejer-go, CI |
| 14 | Scout-harness | #3853 | chore-3853-scout-harness-cadence | sonnet | merge 09 | PR #4683 merget 09:04 |
| 15 | CI-fixups på drafts | #4657 #4656 #4661 #4662 | de eksisterende | sonnet | push til PR'er | #4657 #4656 #4661 merget af ejer 23:44 (CI-fix i #4705); #4662 rebaset 3/9 |
| 16 | Bestyrelses-backfill | #4664 | fix-4664-board-members-backfill | sonnet | merge 09; apply = GO | PR #4669 merget 08:59; backfill koert 09:01 (13 hold) |
| 17 | Anti-slop-vagter | #4626 | chore-4626-anti-slop-guards | sonnet | merge 09 | foerste worker doede 00:22; PR #4706 merget 09:04 |
| 18 | Auktionstekst + dobbelt historik | #4177 #4297 | fix-4177-4297-auction-text-history | sonnet | merge 09 | PR #4674 merget 10:01 |
| 19 | maybeSingle-vagt | #4496 | chore-4496-maybesingle-guard | sonnet | merge 09 | PR #4680 merget 09:04 |
| 20 | Script-fejl | #4493 #4651 | fix-4493-4651-script-bugs | sonnet | merge 09 | PR #4684 merget 09:04 |
| 21 | Kalender-scorecard i CI/preflight | #4215 #4573 | chore-4215-calendar-scorecard-ci | sonnet | merge 09 | PR #4687 merget 10:17 (porteret til #4667-strukturen) |
| 22 | Rolle vs ordre | #4246 #2405 | docs-4246-role-vs-order | sonnet | merge 09 | PR #4686 merget 09:04 |
| 23 | Indbakke-mockups | #2223 | docs-2223-inbox-mockups | sonnet | merge 09; ejer vælger | PR #4689 merget 09:04; ejer vaelger variant |
| 24 | DA-mails | #2853 #4650 | feat-2853-mail-v2 (PR #4654) | sonnet | push til #4654 | PR #4690 merget 09:04 |
| 25 | Datahygiejne | #4576 #4282 | fix-4576-4282-data-hygiene | sonnet | merge 09; #4576-apply = GO | PR #4692 merget 09:47; #4693 merget 10:04 |
| 26 | SSOT-gæld | #4254 | docs-4254-ssot-debt | sonnet | merge 09 | PR #4691 merget 09:04 |
| 27 | Lønkrav + værdi-årsag | #3442 #4263 | fix-3442-4263-salary-value-reason | sonnet | draft, visuelt go | PR #4695 merget 10:16 (#4263 ikke bygget: ingen aarsagsdata) |
| 28 | Agent-playbook | #2823 | docs-2823-agent-playbook | sonnet | merge 09 | PR #4694 merget 09:04 |
| 29 | GitHub-oprydning (kandidatliste) | #4267 | docs-4267-github-cleanup-candidates | sonnet | merge 09; ejer lukker | PR #4696 merget 09:04 |

Ejer-go 2/9 kl. 23:44: hele planen + visuelt go til #4657 (merges i nat når CI er grøn og deployet er set READY).

## Status 3/9 kl. 09:10 (merge-runden i gang)

- **Natten:** A 14/14 spor med PR, B 14/15 (anti-slop-sporet døde tavst kl. 00:22 uden commits; genkørt om morgenen som PR #4706). 32 PR'er åbnet i nat + #4705/#4706 om morgenen. Ejeren mergede selv #4654 #4656 #4657 #4659 #4661 #4663 kl. 23:44 (før min launch-commit), hvilket gjorde main rød på fire vagter (canary, warning-budget, bundle-budget, feature-liveness) og alle 32 PR'er røde; rettet af #4705 (merget 08:42).
- **Sessionen døde i nat** (begge workflows "stopped" uden slutrecord); recovery efter runbooken: alt lå pushet med PR'er, intet uncommitted, kun anti-slop-sporet skulle re-spawnes.
- **Merget 3/9 formiddag (batch A):** #4705 #4660 #4667 #4669 #4682 #4680 #4684 #4706 #4683 #4689 #4686 #4691 #4694 #4696 #4690. Done-flip: #4658 #4594 #4496 #4493 #4651 #4626 #3853 #2405 #4254 #2823 #4650 #4664.
- **Prod-mutation med ejer-GO:** bestyrelses-backfill kørt 09:01 (13 hold uden medlemmer fik 5 hver; 24 på dry-run-listen havde allerede 5; post-verify 0 hold under 5 ekskl. test).
- **Ejer-beslutninger 3/9:** visuelt go på #4671 #4670 #4666 #4668 (ingen filtre fjernet, verificeret i kode) og #4677; S4: 28 dage, ingen tilt, D4 3 etaper/dag, eksakt kvote, etapebånd 3-6, rolling gulv+loft, classic i hilly, GT 17/17/18, monument- og overlap-gates, grus som etapetype (tæller som brosten), belgisk åbningsuge i S4, sektorvægte til S5, #4209 som eget spor; v4 #4679 merges bag flag med jagt-kalibrering som næste spor.
- **I gang:** #4665 (rebaset, CI kører) → derefter batch B (#4671 → #4670 → #4666 → #4668, #4673) + rest af A; S4-spor på Opus (regler/gates + katalog/grus).

## Afvigelser/læringer
- Hard rule 12 (maks 5 åbne PR'er) fraveget bevidst på ejerens ønske om en hel nats volumen; drafts parkeres til visuelt go, backend merges i rækkefølge kl. 09.
- Ejer-merges i den samme time som bølgen launches gør main rød for alle spor: næste gang merges drafts FØR launch (med CI-fixup) eller efter bølgen, ikke midt i.
- Workflow-agenter dør tavst (anti-slop 00:22, 7 tool-kald): lane-timeouten (90 min) holdt køen i gang, men 90 min var tabt; overvej 45 min for lette spor + re-spawn ved "ingen commit efter 30 min".
- Dry-run-rapporter kan overtælle (bestyrelses-scriptet viste 37 kandidater, 13 var reelle): apply-guarden skal være sandheden, og rapporten skal bruge samme predikat som apply.
- Session-død er stadig realiteten: alle spor overlevede fordi de pushede og oprettede PR'er selv; monitoren (bash `sleep`-loop) døde med exit 1 ved start og gav ingen vækning.
