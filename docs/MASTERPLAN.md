# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt regel 6/9: tre baner, aldrig flere.** 🔴 brand · 🟠 i gang · 🔵 ejer-go · ⚪ ikke startet. ≤1.500 tok. Spørg før omprioritering. Områdernes tilstand: `docs/FEATURE_REGISTRY.yml` (#4921). **Intentionen** ejes af GDD'en: `docs/GAME_DESIGN_DOCUMENT.md` (D-001–D-048); MASTERPLAN ejer kun rækkefølgen. Spillerdata: `docs/audits/2026-09-10-*.md`.

**Reglen (ejer 6/9):** **Bane 1 deadline** = kun det der er låst til S4-cutover, fast rækkefølge, intet nyt ind. **Bane 2 forretning** = indtjening, kunder, fastholdelse; viger aldrig. **Bane 3 færdiggør** = alt over 70 % færdigt, tømmes FØR noget nyt startes. **Ejer-mandat 10/9: "der skal ikke længere komme fejl ofte"** → 🔴 brand går foran alle baner. **Målt 15/9:** 628 åbne (21 lukket i audit 15/9; 2 done-gated: #452, #3463).

## 🔴 Brand (rettes før alt andet; intet merges uden ejer-go)

**#5182** board-trinnet 72-93 % af race-finalization → rod-årsag til forsinkede løb #3624 (#5202/#5098 lukket 15/9). **15/9:** main rød 09:04-09:3x (fix #5258; postmortem `.claude/learnings/2026-09-15-*`; forward-guards: opdateret base før merge, migrationer mod ægte Postgres i CI). **Rest:** #4595 → epic #5162 (CYCLINGZONE-56 flad) · #5242 apiFetch PR 2 = 214 kaldsteder · #4872 rytterværdi står stille (9/9) · #5222 · #5256 TTT-vægt.

## Bane 1 · S4-cutover 27-28/9 (deadline; nul buffer). **Rækkefølge ejer-godkendt 15/9 kl. 11:2x** (bølger, ikke datoer; intet udskydes uden ejer-aftale)

1. 🟠 **Bølge 1 (kører):** #5169 → **140 løbsdage** (#4845) · #4851 træningsscore · #3668-rapport ✅ (PR #5260; ejer-valg: taktik/aggression egne evner, ingen PCM/alder fremadrettet, ingen rytter mister masse).
2. 🔵 **Bølge 2, små låste + udløser:** #4860 sponsorpris S4 + #4376 sponsor-base (Codex, ca. 3,0 mio. CZ$) · #5235 mobiltabel-fix → merge · #5211 Discord-hærdning → merge · **B4 #4847** samlet sweep ≥ kl. 20 + knap + G6 + trup-nøgle på `training_day_runs` · **#5236/#5237 tre hårde sessioner (ejer: leveres 15/9)** · B3.
3. ⚪ **Bølge 3, rytter-fundament (ÉN migration, ÉN spillerbesked):** rytter-fødsel uden PCM med egen prior + Holdarbejde/Lederskab som data (spec `2026-09-15-holdarbejde-og-lederskab-evner-design.md`) · `riders.squad` + loft pr. trup 12/10 (#4619) · migration: trup-backfill + taktik/aggression-fix + nye evner → dry-run → go-kort m. tal → ejer skriver besked → apply.
4. ⚪ **Bølge 4, kalender med trupper (FØR S4-generering, kun én gang):** trup-dimension i pakkeren · U23- + junior-katalog (Codex) · AI U23/junior-ryttere · felt-gate C1 · S4 dry-run → go-kort → #4270 apply (ejer). Spec `2026-09-15-u23-kalender-og-trup-datamodel-design.md` (#4620/#4621, alt live 28/9).
5. ⚪ **Bølge 5, træning færdig (live senest 28/9):** skader i løbsdage · program 7×5 (mockup først) · #5238 Åbnere · B6 træningssiden ÉN gang + hjælp (#4849) · #4852-#4854 · #4848.
6. ⚪ **Bølge 6, trup-flader:** Graduation Day-side (#2491, live senest 20/9, ugen før skiftet) · U23/junior-sider · udtagelse/standings/Youth races · præmie-gren.
7. 🔵 **Bølge 7, cutover-pakke:** #4592 inaktive (ejer godkender liste) → #452 → #4759 · Mandatet-flip #4857 (ejer-go) → #4859 → #4858 · v4 før flip (M12 · #4948; #4915 ejer-valg) → **v4-flip ejer-only** → #4916.
8. ⚪ **Efter apply:** Holdarbejde i v4 + mentorpar (bag flag, efter #3668-apply) · PCM-afkobling af al fødsel (#3458/#3512).

## Bane 2 · Forretning (viger aldrig; SSOT: [`GROWTH_STACK.md`](GROWTH_STACK.md))

Mål 2/10: ≥ 450 kr / ≥ 10 ✅ (Alunta 14/9: 659 kr / 18) · checkout ≥ 60 % ✅ · D7 ≥ 45 % (30 %) · aktive/7d ≥ 100 (90). **Tilgang + fastholdelse er flaskehalsen, ikke penge.**
8. ✅ **Spørgeskema #4943/#5121:** lukket 15/9 (34/246); ejeren poster forum-opslag + fog of war-afstemning selv.
9. 🟠 **Fastholdelse:** #5241 ét klik ✅ (mål ≥ 50 % måles ca. 28/9 i #4964) · #4346 anmeld handel ✅ 15/9 (patch note 7.275) · **#5259 beta-adgang** (ejer 15/9, opt-in, høj prio) · #5257 global handelsliste · #5130 (PR #5211) · #4751 · GDD D-037/D-038. #5107 fog of war på hold. late_fill 12 t beholdt (opfølger #5246).
10. 🟠 **Vækst-fundament:** **SEO** #5239 forside ✅ (bro; slutmål #5249 statisk + #5250 session-cookie) · #4067 rest · #3796 · #4811 · #4321 · **hastighed** #5177 (rest #5240, del i to) · #5055 · CWV-gate · **mobil** #1602 · #4982 · #5124 (#5235 fix-spor).
11. 🔵 **Mail:** #2760 win-back ✅ bygget (ejer-prosa + go ca. 21-24/9, 92 i segmentet) · #5045 → testmail → #5038 → flip pr. type. **Nøgleblok #4616** → #4608 → #4646. Billing-vagter #4514 · #4512 · #5051 LTV (#4645).
12. 🔴 **Spiller-kommunikation #428/#4820:** ejeren poster selv. #5033 chunk lag 3 (efter #4595).

## Bane 3 · Færdiggør (>70 %; tømmes før nyt)

13. 🟠 **Docs-SSOT:** #5088 matview-grants · #2259 78 backup-tabeller (48 MB, ejer-go til flyt).
14. **Hygiejne-blok (ejer 11/9):** #3069/#5153/#5155/#5158/#5176 ✅ → #4812 PAT (ejer) → #5157 drafts: #4736 lukket 15/9 · #3512 → egen designsession → #5085 CI marketing → #4924 worktrees.
15. 🔵 Akademi: #5145 (PR #5197 parkeret til U23/junior) · #4495 · #4213 · #4750. Design-rest #4622: #4627 · #4628 · #4813 · #4814 · #4815 · #4613 → **Visuel identitet #5113** (3D-first; først #5115 livery). **Tailwind 4-kæde:** #5150 ✅ → #5151 (+#3952) → #5152.
16. Drift: #4147 · #4866 · #4877/#4900 · #4867 · #4828/#4829 · #5017 · #5015 · #2423 (rør ikke).
17. Spillerfund: #4589 · #4702 · #4873 · #4875 · #4861 · #4981 · #4982 · #5075 · #5059 · #5030 · #5201 · #5200 · #5180 · #5179.

## Venteliste · langsigtet værdi (ejerens område-rækkefølge 2/9; **ejer 10/9: trupper U23/junior løftet fra 8 til 3, parret med træning**)

1 **design-kit/anti-slop** · 2 **drift/tempo** · 3 **rytterudvikling/træning + trupper U23/junior** som én pakke (#4629 · #4630 · #4633 · #3664 · #3709 · #4765 · #4831 · #4206 · #5063 · #4620/#4621) · 4 **løbsmotor/taktik** (#3855 · #4599/#4600 · #4611 · #4612 · #4614 · #4596 · #5074) · 5 **dashboard/indbakke/dag 1** (#4985 · #4984) · 6 **planlægning** (#3329 · #3049/#2794 · #4201) · 7 **kalender** (#4176 · #4103 · #4122 · #4123) · 8 **økonomi** (#3732 · #3360 · #3720 · #1441 · #1310) · 9 **fair play/roller** (#3131 · #3818 · #4537 · #4268) · 10 **vision** (#2359 · #1154 · #1177 · #1148 · #1239).

**Grundreglerne B/B2/C (ejer 28/8):** efter 27/9; kun rene FEJL rettes før.

## Stående (viger aldrig)

**Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · mere fog of war (6/9; eget GDD-kapitel) · maks +1 pr. evne pr. dag (5/9). **Ejer-beslutninger 27-28/8 (genåbn ikke):** løbsdage 1-baseret · afmeldt hold stiller ikke op · løbsdag = bindings-enhed · minimum 6, fladt · to regenereringer forbudt. **Balance:** #2557 ENESTE åbne. **Race engine:** ÉN v4; v3 låst fallback; flip ejer-only. **FROSSET:** #2217/#2218 · #4099/#4100 · #2960.
