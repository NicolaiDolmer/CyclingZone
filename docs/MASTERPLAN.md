# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt regel 6/9: tre baner, aldrig flere.** 🔴 brand · 🟠 i gang · 🔵 ejer-go · ⚪ ikke startet. ≤1.500 tok. Spørg før omprioritering. Områdernes tilstand: `docs/FEATURE_REGISTRY.yml`. **Intentionen** ejes af GDD'en; MASTERPLAN ejer kun rækkefølgen.

**Reglen (ejer 6/9):** **Bane 1 deadline** = kun det der er låst til S4-cutover, fast rækkefølge. **Bane 2 forretning** viger aldrig. **Bane 3 færdiggør** (>70 %) tømmes FØR noget nyt. **Ejer 10/9:** 🔴 brand går foran alle baner. **Ejer 24/9:** intet nyt startes før det byggede er merget og besluttet. Rytme: [`WEEKLY_STEERING.md`](WEEKLY_STEERING.md).

## 🎯 Ejer-rangering 25/9 (planlægningssession c; kandidatliste + "det har vi aftalt": `private-handoffs/2026-09-25-planlaegning-c-rapport.md`)

**1 · U23/junior færdige (ejer: plads 1)** 🔵 alt merget: #5741 drift-kontakt · #5744 flyt-knap · #5750 én flyt-dialog for alle trupper (7.301) · beta-svar #5519 klar · rest = `youth_squad_pages` → alle lørdag (ejer ser siderne, ejer-kør).
**1b · Mandatet til alle (ejer-valg A 25/9, session e)** 🔵 flip lørdag ved skiftet som "årsmødet åbner sæsonen": #5751 rettet + resynket (0 forskel) · byggesten #5752 #5753 #5754 #5755 merget/i kø · plan + rækkefølge i #4859 · tillid mættet → #5757 (S4-spor).
**2-9 · afventer ejer-rangering ("vi vælger den næste senere", 25/9):** Bestyrelsen live (#5633 fem beta-fund → #4859 flip; A/B før/efter) · Sæsonskiftet 27/9 (#5506 tændingsplan, S4-tørkørsel m. #5707-gaten, kørsler på dagen) · Værdierne (søndag 27/9 m. backup, #5461 rebase, A-omskrivning efter skiftet, admin-oprydning #5031) · Upkeep-rework #4385 (A: S4 / B: S5; anbefalet B) · Vækst måling (aktivitet pr. handling, mail-tracking: `email_events` tom, #5305) · Vækst roadmap-svar + beta (#5388, #5387-rest faner, beta-audit, beta-post) · Rest fra bølgerne (#5577 · #5692 A/B · #5677/#5433 · #5637 · #5271-rest · #5705 · røde #5695/#5696 · #5281 28/9) · ejer-punkter (#5305 #4453 #5484 #5493).

## 🔴 Brand (rettes før alt andet; intet merges uden ejer-go)

**#5323 Quad9** (#5312): 0 låst ude; ejer-valg A/B · epic #5162 chunk (lige efter S4) · #5242 · **#5692** matview-lås (34 statement-timeouts/døgn, ejer A/B Vej 2/3).

## Bane 1 · S4-cutover 27-28/9 (rækkefølge ejer-godkendt 15/9; intet udskydes uden ejer-aftale)

1. 🔵 **Kørsler på dagen (ejer-go pr. trin, SEASON_CUTOVER_RUNBOOK + #5506):** afslut sæson → D4→D3 #5669 → pensionering #5651 → kalender 12b (#5405/#4270, gate #5707) → ungdomsgrupper #5660 → AI-U23 #5518 → drift off #5741 → værdikørsel 27/9 (#5443, #5461) → 28/9-flips: `training_tick_per_race_day` + #5281 · `youth_squad_pages` · Mandatet #4859 → #4858.
2. 🟠 **Træning:** alt merget, flip 28/9 (#4850) · #5238 · #4852-#4854 · point-flyt #5268 (ejer-gated) · #5273 · #5283 (ejer-betingelse før U23-generering).
3. 🟠 **Kalender:** #5405 → "kør" 27/9 aften · generator A6 `--juniors=10 --apply` på ejer-go · #5327 arketype (ejer A/B) · #4270 apply.
4. 🟠 **v4:** #5577 sejrstype (flip-blokker) · #5581 · #5515 flip-klar-rapport → **flip ejer-only** → #4916 · TTT til S5 (#4915 lukket, #3463).
5. ⚪ **Efter apply:** holdarbejde i v4 + mentorpar (bag flag) · #3458/#3512 · taktik-epic #5575 lag 2-4: #5101 → #5573 → #5574.

## Bane 2 · Forretning (viger aldrig; SSOT: [`GROWTH_STACK.md`](GROWTH_STACK.md))

Mål 2/10: ≥ 450 kr / ≥ 10 ✅ (Alunta 14/9: 659 kr / 18) · checkout ≥ 60 % ✅ · D7 ≥ 45 % (30 %) · aktive/7d ≥ 100 (90). **Flaskehals: tilgang + fastholdelse.**
6. 🟠 **Fastholdelse:** #5241 måles 28/9 (#4964) · #5282 · #5320 · #4751 · #5107 fog of war · late_fill #5246 · win-back måling 29/9 (#2760).
7. 🟠 **Vækst-fundament:** måling #5310 #5305 #5306 · SEO #5249 #5250 · rest #4067 #3796 #4811 #4321 · hastighed #5177 #5055 · mobil #1602 #4982 #5131. Uge-blok: 2 handlinger + 1 måling.
8. 🔵 **Mail:** #5045 → testmail → #5038 → flip pr. type. Nøgleblok #4616 → #4608 → #4646. Billing-vagter #4514 · #4512.
9. 🔴 **Spiller-kommunikation #428/#4820:** ejeren poster selv (7.299-udkast i rapport 25/9-b). #5033.

## Bane 3 · Færdiggør (>70 %)

10. 🟠 #2259 backup-tabeller (ejer-go) · **drift:** #5677 · #5433 · #5674 · #3556 · #5507 (blokerende 1/10).
11. **Hygiejne-blok (ejer 11/9):** #4812 PAT (ejer) → #5157 → #5309/#5219 · #5218 · #4924 · GDD D-049+ (#5087).
12. 🔵 Akademi: #5145 (parkeret) · #4750. Design-rest #4622 → **Visuel identitet #5113** (først #5115). **Tailwind 4:** #5151 → #5152.
13. Spillerfund: #5630 (dit A/B) · #5637 · #5620 · #5619 · #4702 #4875 #5030 #5200 #5201 #5382-#5391.

## Venteliste · langsigtet værdi (ejer 2/9)

1 design-kit/anti-slop · 2 drift/tempo · 3 rytterudvikling/træning + trupper (#4629 #4630 #4633 #3664 #3709 #4765 #4831 #4206 #5063 #4620) · 4 løbsmotor/taktik (#3855 #4599 #4600 #4611 #4612 #4614 #4596 #5074) · 5 dashboard/indbakke (#4985 #4984) · 6 planlægning (#3329 #3049 #2794) · 7 kalender (#4176 #4122 #4123) · 8 økonomi (#4385 #2840 #4033 #3732 #3360 #3720 #1441 #1310) · 9 fair play (#3131 #3818 #4537 #4268) · 10 vision (#1154 #1177 #1148 #1239 #5307 #5106). **Grundreglerne B/B2/C (ejer 28/8):** efter 27/9.

## Stående (viger aldrig)

**Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · mere fog of war · maks +1 pr. evne pr. dag. **Ejer 28/8 (låst):** løbsdage 1-baseret · afmeldt hold stiller ikke op · minimum 6, fladt · to regenereringer forbudt. **Balance:** #2557 ENESTE åbne. **Race engine:** ÉN v4; v3 låst fallback; flip ejer-only. **FROSSET:** #2217/#2218 · #4100.
