# NOW — Aktuel arbejdsstatus

## Aktiv styring
**Masterplan landed 2026-05-19:** `docs/MASTER_PLAN.md` er styringskontrakten for CyclingZone på tværs af Manus, Claude Code og Codex. Frem til sprinten slutter 2026-06-17 har **Monetization Validation** forrang over brand-polish, bot-polish og post-Go betalingsimplementation. Brand Phase 1 er låst, men Brand Phase 2 må ikke trumfe feedback-loopet.

> **🟢 Sæson 1 starter i aften kl 23:00 (Europe/Copenhagen) — bruger-action (REVIDERET 2026-05-21, v3.78):**
> 1. Gå til `/admin → Sæson` → sektion `🔄 Sæson-cyklus`
> 2. Tryk **Udfør sæsonskifte (sæson 0 → 1)** og bekræft
> 3. Engine'n hopper over `processSeasonEnd` for sæson 0, opretter sæson 1's transfer-window, og udbetaler 240K sponsor til **19 hold** (3 test-hold + 1 inaktiv manager (Inuit Cycling) frosset ud per 2026-05-21)
> 4. Per-fase-log skal vise 6 ✅ — særligt `insert_next_season: updated (promoted upcoming → active)`
> 5. **NYT v3.78:** Salary + loan-interest + emergency-lån trækkes nu ved sæson-START sammen med sponsor. 19 hold får sponsor 240K, derefter trækkes ~1,5M samlet løn, ~278K rente, og 9 hold får emergency-lån
>
> **⚠️ Brug IKKE manual ⏹ Afslut + ▶ Start-knapperne** — audit 2026-05-21 ([`docs/economy-flow-audit-2026-05-21.md`](docs/economy-flow-audit-2026-05-21.md)) viste at ⏹ Afslut sæson 0 ubetinget kører `processSeasonEnd` → ~1.5M pts salary-debit på 17 hold, ~278K loan-interest, 9 hold får emergency-lån (~438K), 2 vilkårlige hold rykker op til D2. NOW.md sagde tidligere "formentlig harmløs" — det var forkert. Engine'n er den sikre vej.
>
> **Verifikation efter sæsonskifte (kør queries efter knapklik):**
> - `seasons`: sæson 0 'completed' med end_date, sæson 1 'active' med start_date
> - `transfer_windows`: sæson 0's window 'closed', ny `00000000-...0001aaaa` for sæson 1 ('closed' status — racing-sæson)
> - `finance_transactions WHERE season_id='00000000-0000-0000-0000-000000000001'`:
>   - 20 sponsor-rows á 240.000 (test-hold ekskluderet)
>   - 17 salary-rows (hold med ryttere)
>   - 7 loan_interest-rows (hold med aktive lån)
>   - 9 emergency_loan-rows (hold der ikke kunne betale løn)
> - Postmortem: `.claude/learnings/2026-05-21-season-1-uuid-drift.md`
>
> **Næste session — fortsæt på økonomien (REVIDERET 2026-05-21 efter v3.78):**
> Start her hvis bruger vil tage økonomi-tråden op igen:
> 1. **VERIFICÉR post-23:00 state** — kør verifikations-queries ovenfor og sammenlign med forventede rækker. Hvis tal ikke matcher → læs [`docs/economy-flow-audit-2026-05-21.md`](docs/economy-flow-audit-2026-05-21.md) Fase 2/3-trace.
> 2. **Validér forecast-numerik** — gå til `/finance` som en testbruger og kør forecast med horisont 1/3/5 sæsoner. Tjek at sæson 1's projected_net inkluderer faktisk salary + interest (ikke 0 som før patch). Estimat-sæsoner (~) skal vise faldende loan-interest pga. 25% decay.
> 3. ~~**buildSeasonEndPreviewRows i frontend er nu misvisende**~~ — ✅ fikset i v3.79 (2026-05-21): preview-tabellen omdøbt til "Sæson-transition preview", kolonner reordered til v3.78-cashflow (balance + sponsor − renter − løn), backend-math inkluderer sponsor i balance_after + nødlån-flag.
> 4. **#452 tilmeld-knap til kommende sæson** — sub-issue til Slice 08 #239. Manager der ikke kan stille hold ved sæson-skifte (ingen ryttere) skal kunne tilmelde sig kommende sæson. Mangler spec.
