# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt regel 6/9: tre baner, aldrig flere.** 🔴 brand · 🟠 i gang · 🔵 ejer-go · ⚪ ikke startet. ≤1.500 tok. Spørg før omprioritering. Områdernes tilstand: `docs/FEATURE_REGISTRY.yml` (#4921). **Intentionen** ejes af GDD'en: `docs/GAME_DESIGN_DOCUMENT.md` (D-001–D-048); MASTERPLAN ejer kun rækkefølgen. Spillerdata: `docs/audits/2026-09-10-*.md`.

**Reglen (ejer 6/9):** **Bane 1 deadline** = kun det der er låst til S4-cutover, fast rækkefølge, intet nyt ind. **Bane 2 forretning** = indtjening, kunder, fastholdelse; viger aldrig. **Bane 3 færdiggør** = alt over 70 % færdigt, tømmes FØR noget nyt startes. **Ejer-mandat 10/9: "der skal ikke længere komme fejl ofte"** → 🔴 brand går foran alle baner. **Målt 14/9:** 620 åbne (3 done-gated, 18 lukket i audit 14/9).

## 🔴 Brand (rettes før alt andet; intet merges uden ejer-go)

**Dagbølge 14/9 (wf_d3c0d357):** #5182 board-trinnet 72-93 % af race-finalization → rod-årsag til forsinkede løb #3624 · #5202 ny kaptajn når kaptajnen er udgået · #5098 holdudtagelse nulstilles ved etapeskift (verificér først). **Rest:** #4595 → epic #5162 (spor 1-5 merget; prod-måling CYCLINGZONE-56 efter #5173) · #5089 429-byger (post-verify) · #5242 apiFetch-wiring · #4872 rytterværdi står stille (9/9). #4959 lukket 14/9 (0 puljer over 24).

## Bane 1 · S4-cutover 27-28/9 (deadline; nul buffer)

1. ✅ **Løbssiden som faner** #4913 (7/9).
2. 🟠 **v4 før flip** (`RACE_ENGINE_RULES.md` §9): §7b grønne undtagen favorit-win-rate 62,6 % (ejer-gated: aldrig straf af styrke). Rest: M12 grupetto · #4915 TTT (ejer-valg) · #4948 raceDay-hjælp.
3. 🔵 **v4-flip** (ejer-only) → #4916 følg løbet live.
4. 🔵 **S4-kalender:** #4270 apply (ejer) · #4845 kalenderpakker (PR #5169 klar) · #4203 (done-gated).
5. 🟠 **Træning pr. løbsdag #4850** (live senest 28/9; skemaets nr. 1): **#4846 tick pr. løbsdag i dagbølgen 14/9 bag flag** → #4847 → #4851 → #4852/#4853/#4854 → #4848 → #4849. #4801 · #4874 i pakken. #5076 + #5064 som help-tekst i #4849. Efter #5205: #5236/#5237/#5238.
6. 🔵 **Bestyrelsen: Mandatet-flip** (27/9): #4857 (ejer-go) → #4859 → #4858. Videre design: GDD D-040/D-041.
7. 🔵 **Cutover-pakke:** #4592 inaktive (ejer godkender liste) → #452 → #4759 · #4619 · #4860 sponsorpris S4 · #4376 sponsor-base ved oprykning.

## Bane 2 · Forretning (viger aldrig; SSOT: [`GROWTH_STACK.md`](GROWTH_STACK.md))

Mål 2/10: ≥ 450 kr / ≥ 10 ✅ (Alunta 14/9: 659 kr / 18) · checkout ≥ 60 % ✅ · D7 ≥ 45 % (30 %) · aktive/7d ≥ 100 (90). **Tilgang + fastholdelse er flaskehalsen, ikke penge.**
8. 🟠 **Spørgeskema #4943/#5121:** lukker 14/9 kl. 23:59; 214 skubbet 11/9; opsummering 15/9. Fog of war-afstemning: `docs/drafts/forum-poll-fog-of-war-2026-09-10.md` (ejeren poster).
9. 🟠 **Fastholdelse (dagbølge 14/9):** #5103 onboarding trin 4 kræver spillerhandling · #5130 Discord-velkomst i indbakken + link (#427) · løfter #4821 flyt forumtråd · #4346 anmeld handel. Derefter #4964 launch-kohorte 28,6 % (ejer-valg) → #5241 ét klik · #4751 social-rest · #4235 forum vs Discord (15/9) · GDD D-037/D-038. #5107 fog of war på hold (26 % imod).
10. 🟠 **Vækst-fundament:** **SEO** #4067 marketing (dagbølge; rettelser #5239) · #3796 · #4811 · #4321 · **hastighed** #5177 merget (rest #5240) · #5055 · CWV-gate · **mobil** #1602 · #4982 · #5124 (#5235); #5123/#5122 merget.
11. 🔵 **Mail:** #5045 → testmail → #5038 ejer-trin → flip pr. type → #2760 win-back (trin 5). **Nøgleblok #4616** → Pro i euro #4608 → #4646. Billing-vagter #4514 · #4512 · #5051 LTV (dagbølge, m. forward-guard #4645).
12. 🔴 **Spiller-kommunikation #428/#4820:** ejeren poster selv. #5033 chunk lag 3 (efter #4595).

## Bane 3 · Færdiggør (>70 %; tømmes før nyt)

13. 🟠 **Docs-SSOT:** #5088 matview-grants · #2259 78 backup-tabeller (48 MB, ejer-go til flyt).
14. **Hygiejne-blok (ejer 11/9):** #3069 ✅ → #5153 ✅ (14/9) → #5176 rest 3 definer-WARN + CodeQL #360/#361 (dagbølge, frist 18/9) → #4812 PAT (ejer) → #5155 ✅ (lukkesession 14/9) → #5157 drafts #3512/#4736 (ejer: færdig eller luk) → #5085 CI marketing → #5158 ✅ (TS A+, konverteringsspor pr. bølge) → #4924 worktrees.
15. 🔵 Akademi: #5145 (PR #5197 parkeret til U23/junior) · #4495 · #4213 · #4750. Design-rest #4622: #4627 · #4628 · #4813 · #4814 · #4815 · #4613 → **Visuel identitet #5113** (3D-first; først #5115 livery). **Tailwind 4-kæde:** #5150 ✅ → #5151 (+#3952) → #5152.
16. Drift: #4147 · #4866 · #4877/#4900 · #4867 · #4828/#4829 · #5017 · #5015 · #2423 (rør ikke).
17. Spillerfund: #4589 · #4702 · #4873 · #4875 · #4861 · #4981 · #4982 · #5075 · #5059 · #5030 · #5201 · #5200 · #5180 · #5179.

## Venteliste · langsigtet værdi (ejerens område-rækkefølge 2/9; **ejer 10/9: trupper U23/junior løftet fra 8 til 3, parret med træning**)

1 **design-kit/anti-slop** · 2 **drift/tempo** · 3 **rytterudvikling/træning + trupper U23/junior** som én pakke (#4629 · #4630 · #4633 · #3664 · #3709 · #4765 · #4831 · #4206 · #5063 · #4620/#4621) · 4 **løbsmotor/taktik** (#3855 · #4599/#4600 · #4611 · #4612 · #4614 · #4596 · #5074) · 5 **dashboard/indbakke/dag 1** (#4985 · #4984) · 6 **planlægning** (#3329 · #3049/#2794 · #4201) · 7 **kalender** (#4176 · #4103 · #4122 · #4123) · 8 **økonomi** (#3732 · #3360 · #3720 · #1441 · #1310) · 9 **fair play/roller** (#3131 · #3818 · #4537 · #4268) · 10 **vision** (#2359 · #1154 · #1177 · #1148 · #1239).

**Grundreglerne B/B2/C (ejer 28/8):** efter 27/9; kun rene FEJL rettes før.

## Stående (viger aldrig)

**Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · mere fog of war (6/9; eget GDD-kapitel) · maks +1 pr. evne pr. dag (5/9). **Ejer-beslutninger 27-28/8 (genåbn ikke):** løbsdage 1-baseret · afmeldt hold stiller ikke op · løbsdag = bindings-enhed · minimum 6, fladt · to regenereringer forbudt. **Balance:** #2557 ENESTE åbne. **Race engine:** ÉN v4; v3 låst fallback; flip ejer-only. **FROSSET:** #2217/#2218 · #4099/#4100 · #2960.
