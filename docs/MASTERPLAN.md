# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt regel 6/9: tre baner, aldrig flere.** 🔴 brand · 🟠 i gang · 🔵 ejer-go · ⚪ ikke startet. ≤1.500 tok. Spørg før omprioritering. Områdernes tilstand: `docs/FEATURE_REGISTRY.yml`. **Intentionen** ejes af GDD'en; MASTERPLAN ejer kun rækkefølgen.

**Reglen (ejer 6/9):** **Bane 1 deadline** = kun det der er låst til S4-cutover, fast rækkefølge, intet nyt ind. **Bane 2 forretning** = indtjening, kunder, fastholdelse; viger aldrig. **Bane 3 færdiggør** = alt over 70 % færdigt, tømmes FØR noget nyt startes. **Ejer 10/9:** færre fejl → 🔴 brand går foran alle baner. **Ejer 24/9:** intet nyt startes, før det byggede er merget og besluttet (live / ikke endnu / 28/9 / beta). Rytme: [`WEEKLY_STEERING.md`](WEEKLY_STEERING.md).

## 🎯 Gør det lovede færdigt (ejer-godkendt 21/9; foran alt andet end brand)

**🏁 Motoren (ejer 23/9): runde 1-4 (#4914) går forrest sammen med løfterne**; tændingsdatoen tages op, når byggeriet kører.
**A · ejerens hånd:** 1-2 ✅ · 3 flip `training_score_visible` + udmelding (#4851) · 4 Android-test → flip `training_mobile_table` → slet gammel gren (#3643) · 5 ✅ win-back sendt 22/9 (måling 29/9) · 6 "kør" `youth_squad_pages` on for alle (loft #5626 merget 24/9).
**B · Claude, i rækkefølge:** 6 værdiskiftet #5443 = #5327 → #5435 → #5497 (ejer 22/9) · 7 ✅ S4-kalender 24 t (#5596) · 8 træning pr. løbsdag live 28/9 (flip-dag, #5281) · 9 ✅ /roadmap = fremtiden (#5387, 42 punkter 24/9; gul prik #5673).

## 🔴 Brand (rettes før alt andet; intet merges uden ejer-go)

✅ #5589 dashboard-vinder (#5598, 24/9) · **#5323 Quad9** (#5312): 0 låst ude; ejer-valg A/B. **Rest:** **#5443 værdisystemet** (trin 1-3 før 27/9) · epic #5162 (lige efter S4) · #5242.

## Bane 1 · S4-cutover 27-28/9 (rækkefølge ejer-godkendt 15/9; intet udskydes uden ejer-aftale)

1. 🟠 **Køen (24/9-d):** ✅ merget #5670 #5661 #5650 #5651 #5672 #5610 #5666 #5671 #5663 #5679 · ✅ `race_notify_outbox_enabled` on 18:45 · "kør"-kort: `youth_squad_pages` on (ejer venter på beta-testere) · `email_loop_race_digest` dry_run · `race_finalize_resumable_enabled` · parkeret m. dato: #5461 27/9 · #5281 28/9 · #5502 28/9 (A/B) · #5444 åben til værdikørslen · GitHub-audit.
2. 🟠 **Træning:** ✅ 140 (#5608 #5615) · ✅ kerne + motor C2 (#5640 #5654) · #5670 hjælp · flip-prep #5663 · B3 #5281 flip-dagen · #5238 · #5456 · #4852-#4854. **Rytter-fundament:** point-flyt #5268 (ejer-gated) · #5269 · #5273.
3. 🟠 **Kalender m. trupper:** ✅ kalender pr. trup + 4 D4-puljer (#5653) · **S4-kalender genereres om** (#5405: tørkørsel → "kør" efter #2789; gate lige mange løbsdage #5658) · generator A6 `--juniors=10 --apply` på ejer-go efter transitionen · #5327 arketype (#3512) · #4270 apply (ejer).
4. 🟠 **Trupper (alt live 28/9):** ✅ S2 #5652 · ✅ puljer #5660 · ✅ stilling backend #5665 · ✅ #5650 præmie+udtagelse (16 år) · ✅ #5666 U23/junior-sider (beta; flag on for alle udestår) · ✅ #5671 frontend-scope · Y7-hook + comeback→ungdomsgruppe (opfølgningsissues 24/9).
5. 🔵 **Cutover:** ✅ D4→D3-script #5669 (kør 28/9) · #5651 D4 = 4 puljer · #5661 comeback efter Global Rank · ✅ parkerede hold #5603 · **Mandatet: ✅ #5679 merget 24/9** → #4859 flip 28/9 → #4858 · **v4:** ✅ #5524 #5521 #5579 #5576 #5614 → #5577 · #5582 · lag 1 #5059 #5570 #5571 #5572 · indsats #5580 → #5581 · målinger #5578 #5583 → #5515 → **flip ejer-only** → #4916.
6. ⚪ **Efter apply:** Holdarbejde i v4 + mentorpar (bag flag) · #3458/#3512 · taktik-epic #5575 lag 2-4: #5101 → #5573 → #5574.

## Bane 2 · Forretning (viger aldrig; SSOT: [`GROWTH_STACK.md`](GROWTH_STACK.md))

Mål 2/10: ≥ 450 kr / ≥ 10 ✅ (Alunta 14/9: 659 kr / 18) · checkout ≥ 60 % ✅ · D7 ≥ 45 % (30 %) · aktive/7d ≥ 100 (90). **Flaskehals: tilgang + fastholdelse.**
7. 🟠 **Fastholdelse:** #5241 måles 28/9 (#4964) · #5282 · #5320 · #4751 · #5107 fog of war · late_fill (#5246). Discord-invitation ✅ sendt 24/9 (213).
8. 🟠 **Vækst-fundament:** **måling først** #5304 #5310 #5305 #5306 · **SEO** #5249 + #5250 · rest #4067 #3796 #4811 #4321 · **hastighed** #5177 #5055 · **mobil** #1602 #4982 #5131. Uge-blok: 2 handlinger + 1 måling.
9. 🔵 **Mail:** #2760 ✅ (måling 29/9) · #5045 → testmail → #5038 → flip pr. type. **Nøgleblok #4616** → #4608 → #4646. Billing-vagter #4514 · #4512.
10. 🔴 **Spiller-kommunikation #428/#4820:** ejeren poster selv (svar-udkast i morgenrapport 24/9-d). #5033.

## Bane 3 · Færdiggør (>70 %)

11. 🟠 #2259 backup-tabeller (ejer-go) · **drift:** #5635 Discord-sweep · guarded-merge slipper filer pr. spor (issue 24/9) · session-hygiejne (issue 24/9) · #5674 status-tavle genereret · #3556 merge queue.
12. **Hygiejne-blok (ejer 11/9):** #4812 PAT (ejer) → #5157 → budget FAIL AGENTS.md + FEATURE_STATUS.md → #5309/#5219 · #5218 · #4924 · GDD D-049+ (#5087).
13. 🔵 Akademi: #5145 (parkeret til U23/junior) · #4750. Design-rest #4622 → **Visuel identitet #5113** (først #5115). **Tailwind 4:** #5151 → #5152.
14. Spillerfund: #5630 (dit A/B) · #5636 · #5637 · #5634 · #5619 · #4702 #4875 #5030 #5200 #5201 #5382-#5391.

## Venteliste · langsigtet værdi (ejer 2/9)

1 design-kit/anti-slop · 2 drift/tempo · 3 rytterudvikling/træning + trupper (#4629 #4630 #4633 #3664 #3709 #4765 #4831 #4206 #5063 #4620) · 4 løbsmotor/taktik (#3855 #4599 #4600 #4611 #4612 #4614 #4596 #5074) · 5 dashboard/indbakke (#4985 #4984) · 6 planlægning (#3329 #3049 #2794) · 7 kalender (#4176 #4122 #4123) · 8 økonomi (#3732 #3360 #3720 #1441 #1310) · 9 fair play (#3131 #3818 #4537 #4268) · 10 vision (#1154 #1177 #1148 #1239 #5307 #5106). **Grundreglerne B/B2/C (ejer 28/8):** efter 27/9.

## Stående (viger aldrig)

**Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · mere fog of war · maks +1 pr. evne pr. dag. **Ejer 28/8 (låst):** løbsdage 1-baseret · afmeldt hold stiller ikke op · minimum 6, fladt · to regenereringer forbudt. **Balance:** #2557 ENESTE åbne. **Race engine:** ÉN v4; v3 låst fallback; flip ejer-only. **FROSSET:** #2217/#2218 · #4100.
