# NOW - Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Områdernes SSOT'er:** hard rule 30 i AGENTS.md - læs dit områdes fil FØR du rører noget.

## Aktiv styring

> **🎯 Next action:** **Ny session starter med [`docs/drafts/session-handoff-2026-09-03.md`](drafts/session-handoff-2026-09-03.md)** (prompt-forslag nederst): (1) GitHub-audit via `/github-housekeeping` + [`github-cleanup-candidates-2026-09-03.md`](audits/github-cleanup-candidates-2026-09-03.md); (2) S4-apply-kæden (kommentar på #4270 3/9): #4203 monument-pakkeren (blokerer apply) → dry-run fra main → ejerens "kør" → `--apply` én gang → post-verify → årsmøde-tørkørsel; hård dato 27/9; (3) rester fra bølgen: #4670 Auktioner/Akademi (e2e rød), evt. #4671 #4662 + GT-katalog-PR hvis ikke merget; patch note 7.240 for kit-siderne (#4666 #4685 #4688 merget efter 7.239). **Ejer:** Discord-post 7.239 (`docs/drafts/discord-patch-7239-2026-09-03.md`), afstemning #4714 (`docs/drafts/forum-poll-free-agent-auction-time-2026-09-03.md`), nøgleblok #4616 → #4608, #4388 (A/B/C), faktura #2 hos Alunta. **Natbølge 2-3/9:** 38 PR'er, 37 merget ([`night-wave-2026-09-03.md`](audits/night-wave-2026-09-03.md)). Mandagstal (§0.9) man 7/9 kl. 09.

> **⏳ Venter på DIN beslutning (stil dem enkeltvist):** **#4376/PR #4388 S3-kompensation** — A = kun opad (anbefalet, 54 hold / +3.901.500) / B = begge veje / C = begge veje uden minus; PR rebaset og mergeable · **#4495** 7 ryttere fanget i akademiet (SQL vises først) · **#4485-genberegning:** audit skal genkøres m. U25-reglen (26 løb, 915 rækker), så ét go · **#4098 blødt loft**: dialog nu, beslut senere · **#3512** arketyper del 2: anbefalet lukket.

> **🔴 Åbne fund:** **#4203 monument-pakkeren blokerer S4-apply** · **#4595 chunk-fejl 257 på 24 t (budget 25) efter 37 deploys 3/9; deploy-verify rød på main** (rodfix #2423) · **#3777** natlig Security grants audit rød hver nat (tre proposal-filer ikke forfremmet) · **#4545** rest: 404 på manglende asset bærer stadig `immutable` (lukkes af #2423 P1) · **#4537** fair play: spilleren med 2 hold skal vælge hold; trup-håndteringen har ingen verificeret mekanik · **#2960** React 19 + RR8: én allowlistet high-advisory venter på den; rører hydration overalt, så den skal have egen session · #4146 · #4530 · #4531.

> **💳 Betaling:** SSOT [`BILLING_STACK.md`](BILLING_STACK.md). Målt 2/9: MRR 113,87 kr, 3 abo, checkout 2 af 5. PR #4608 (sprog vælger valuta) merges lige efter #4616-nøgleblokken. Pro-fordele #4662 (Founder supporter, evnehistorik, gemte filtre; intet ønskeliste-loft, ejer 3/9) på vej. #4512 dunning (ejer) · #4511 EU-moms (revisor).

> **💰 Værdier, fast dato søn 6/9:** markedsblendet tændes med **15 % vægt** (ejer-go 30/8, [#4449](https://github.com/NicolaiDolmer/CyclingZone/issues/4449)). Før flip: runtime skal læse v2-artefaktet, tørkørsel mod prod, ejer-go, spillerbesked. Kadence (søn kl. 06) live siden #4419. SSOT: [`ECONOMY_RULES.md`](ECONOMY_RULES.md) §9.

> **✅ S3 kører:** 529 løb / 1.239 etaper, 28/8 → søn 27/9. Nattens kalender-audit (05:50) = #4507-beviset - tjek den i næste session.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **Overlap intended**; 1 rytter = 1 løb pr. **løbsdag**. **Pension:** måles på AFSLUTTET sæsons alder. Alders-referenceår = `riderSeasonAge.js` SSOT (S3=2028; #4485-kodefix ligger i PR #4533).
- **Race engine:** v3 låst fallback; v4-flip ejer-only. **v4-gate = 5-seed-middel (ejer 2/9); alle tre F3-ankre GRØNNE 2/9: nedkørsel 0,46, bjerg 208 s (måles på topankomster, ejer-valg A), sprinter 95 %. Næste: #4615 harness-TeamOrders + M5/M6/M14.** **Bonustilbud (Regel A, ejer 31/8): et tilbud lever præcis én sæson** - sæson-slut-tilbud indløses hele den følgende sæson.
- **Økonomi/værdier S3:** låst. [`ECONOMY_RULES.md`](ECONOMY_RULES.md). **Sikkerhed:** kun #691 åben.
- **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik (#428); tråd-bank #4117.

> **🤖 Working agent:** **Session B (Fable, arkitekt) kører merge-runden 3/9** siden kl. 07:36: batch A/B merges med `--admin`, done-flips, S4-spor på Opus (feat/4270-s4-rules-and-gates + feat/4270-s4-catalog-gravel), fix-workers på #4687 #4692 #4693 #4674 #4678 #4662 #4665. Rør IKKE bølgens worktrees eller hoved-checkoutet. Playwright-slottet er Fables. Status: [`night-wave-2026-09-03.md`](audits/night-wave-2026-09-03.md).

_Historik i git-log, issue-tråde + docs/audits/._
