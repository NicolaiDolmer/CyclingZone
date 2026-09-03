# Natbølge 2026-09-03 (den store natbølge, ejer-GO 2/9 kl. 23:44)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 23:45 → (kører; opdateres ved close-out) |
| Agenter launched / fuldført / døde | 8 samtidige (A: 6 laner over 14 spor, B: 2 laner over 15 spor) / opdateres / opdateres |
| PR'er åbnet / merged | opdateres |
| Issues → claude:done | opdateres |
| gh-401-retries (preflight-probe + bølge) | 0 i preflight (OAuth-token-advarsel, ingen fejl) |
| Recoveries (type) | opdateres |
| Preflight | GO kl. 23:19 (.codex.local/night-wave-preflight.json) |

Workflows: A = `wf_64e6c306-c6f` (opus/sonnet eksplicit pr. spor), B = `wf_e2adaf29-541` (sonnet). Scripts i sessionens scratchpad (`natboelge-A/B-2026-09-03.js`); design: lane-pool over prioriteret kø (ingen tomme slots, et frosset spor blokerer kun sin lane), per-spor-timeout 170/100/90 min, monitor hvert 20. min (frosne transcripts + PR-tal).

## Hårde afhængigheder (målt 2/9 kl. 23:30 mod prod)

- `seasons` har number 0-3; **S4 findes ikke**. Spor 1 gør S4 byggeklar (uniform tilt, scorecard i dry-run, beslutningsliste). Apply = ejer-GO om morgenen.
- **16 menneskehold uden bestyrelsesmedlemmer** (12 rigtige, 4 test), 240 menneskehold, 237 aktive mandater → [#4664](https://github.com/NicolaiDolmer/CyclingZone/issues/4664). Spor 16 leverer rod-årsag + backfill-script + vagt. Apply = ejer-GO.

## Spor (rækkefølge = køen; område-rækkefølge fra pengeplan §3)

| # | Spor | Issues | Worktree | Model | Merge-politik | Resultat |
|---|---|---|---|---|---|---|
| 1 | S4 byggeklar | #4270 #4176 | feat-4270-season4-calendar | opus | merge 09; apply = GO | |
| 2 | Ryttere + Transfers på kittet | #4628 | feat-4628-riders-transfers-kit (oven på #4657) | opus | draft, visuelt go | |
| 3 | Auktioner + Akademi + skjul overbudte | #4628 #4262 | feat-4628-auctions-academy-kit (oven på #4657) | opus | draft, visuelt go | |
| 4 | Mit hold + holdside + managerside | #4628 #4381 | feat-4628-team-pages-kit (oven på #4657) | opus | draft, visuelt go | |
| 5 | Playwright shards + flake-rapport + gate | #4647 #4292 #4548 | feat-4647-playwright-shard | opus | merge 09 efter review | |
| 6 | Løbssiden | #4628 #2810 #1884 | feat-4628-race-page-kit (oven på #4657) | opus | draft, visuelt go | |
| 7 | Punch/climbing-split | #4631 | feat-4631-split-punch-climbing | opus | draft, ejer-go | |
| 8 | v4 TeamOrders + M5/M6/M14 | #4615 | feat-4615-v4-teamorders-wiring | opus | merge 09 (bag flag) | |
| 9 | Assistent sen-udfyldning bag flag | #4201 | feat-4201-assistant-late-fill | opus | merge 09 (flag off) | |
| 10 | Træning: loft-visning + udbytte | #4128 #3966 | fix-4128-3966-training-ceiling-yield | sonnet | #4128 draft | |
| 11 | Taktik-lås + board-bekræftelse | #4538 #4519 | fix-4538-4519-tactics-board-confirm | sonnet | #4538 merge, #4519 draft | |
| 12 | Bug-sweep | #4374 #4588 #4594 | fix-4374-4588-4594-bug-sweep | sonnet | merge 09 | |
| 13 | Kalender-glyffer + celle | #4143 #4386 | feat-4143-4386-calendar-glyphs | sonnet | draft, visuelt go | |
| 14 | Scout-harness | #3853 | chore-3853-scout-harness-cadence | sonnet | merge 09 | |
| 15 | CI-fixups på drafts | #4657 #4656 #4661 #4662 | de eksisterende | sonnet | push til PR'er | |
| 16 | Bestyrelses-backfill | #4664 | fix-4664-board-members-backfill | sonnet | merge 09; apply = GO | |
| 17 | Anti-slop-vagter | #4626 | chore-4626-anti-slop-guards | sonnet | merge 09 | |
| 18 | Auktionstekst + dobbelt historik | #4177 #4297 | fix-4177-4297-auction-text-history | sonnet | merge 09 | |
| 19 | maybeSingle-vagt | #4496 | chore-4496-maybesingle-guard | sonnet | merge 09 | |
| 20 | Script-fejl | #4493 #4651 | fix-4493-4651-script-bugs | sonnet | merge 09 | |
| 21 | Kalender-scorecard i CI/preflight | #4215 #4573 | chore-4215-calendar-scorecard-ci | sonnet | merge 09 | |
| 22 | Rolle vs ordre | #4246 #2405 | docs-4246-role-vs-order | sonnet | merge 09 | |
| 23 | Indbakke-mockups | #2223 | docs-2223-inbox-mockups | sonnet | merge 09; ejer vælger | |
| 24 | DA-mails | #2853 #4650 | feat-2853-mail-v2 (PR #4654) | sonnet | push til #4654 | |
| 25 | Datahygiejne | #4576 #4282 | fix-4576-4282-data-hygiene | sonnet | merge 09; #4576-apply = GO | |
| 26 | SSOT-gæld | #4254 | docs-4254-ssot-debt | sonnet | merge 09 | |
| 27 | Lønkrav + værdi-årsag | #3442 #4263 | fix-3442-4263-salary-value-reason | sonnet | draft, visuelt go | |
| 28 | Agent-playbook | #2823 | docs-2823-agent-playbook | sonnet | merge 09 | |
| 29 | GitHub-oprydning (kandidatliste) | #4267 | docs-4267-github-cleanup-candidates | sonnet | merge 09; ejer lukker | |

Ejer-go 2/9 kl. 23:44: hele planen + visuelt go til #4657 (merges i nat når CI er grøn og deployet er set READY).

## Afvigelser/læringer
- Hard rule 12 (maks 5 åbne PR'er) fraveget bevidst på ejerens ønske om en hel nats volumen; drafts parkeres til visuelt go, backend merges i rækkefølge kl. 09.
- (opdateres ved close-out)
