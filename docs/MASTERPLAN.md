# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt regel 6/9: tre baner, aldrig flere.** 🔴 brand · 🟠 i gang · 🔵 ejer-go · ⚪ ikke startet. ≤1.500 tok. Spørg før omprioritering. Områdernes tilstand: `docs/FEATURE_REGISTRY.yml` (#4921). **Intentionen** (hvad spillet skal være) ejes af GDD'en: `docs/GAME_DESIGN_DOCUMENT.md` (D-001–D-048); MASTERPLAN ejer kun rækkefølgen. Spillerdata: `docs/audits/2026-09-10-*.md`.

**Reglen (ejer 6/9):** **Bane 1 deadline** = kun det der er låst til S4-cutover, fast rækkefølge, intet nyt ind. **Bane 2 forretning** = indtjening, kunder, fastholdelse; viger aldrig. **Bane 3 færdiggør** = alt over 70 % færdigt, tømmes FØR noget nyt startes. **Ejer-mandat 10/9: "der skal ikke længere komme fejl ofte"** → 🔴 brand går foran alle baner. **Målt 11/9:** 633 åbne (18 done-gated).

## 🔴 Brand (rettes før alt andet; bølge startet 10/9 kl. 13:10, intet merges uden ejer-go)

#4595 chunk-fejl: lag 3 = PR #5139, holdes til Codex-audit (`docs/drafts/codex-audit-prompt-chunk-errors-2026-09-11.md`) · #4959 merget 11/9, puljer 9/13 frie 12-13/9 · #4872 rytterværdi står stille (9/9). Merget 10/9: #5097 #5100 #5099 #5073.

## Bane 1 · S4-cutover 27-28/9 (deadline; nul buffer)

1. ✅ **Løbssiden som faner** #4913 (7/9).
2. 🟠 **v4 før flip** (`RACE_ENGINE_RULES.md` §9): §7b grønne undtagen favorit-win-rate 62,6 %. Rest: favorit-win-rate · M12 grupetto · #4915 TTT (ejer-valg) · #4948 raceDay-hjælp.
3. 🔵 **v4-flip** (ejer-only) → #4916 følg løbet live.
4. 🔵 **S4-kalender:** #4270 apply (ejer) · #4845 kalenderpakker · #4203 (done-gated).
5. 🟠 **Træning pr. løbsdag #4850** (live senest 28/9; skemaet: træning = "fungerer dårligst" 17 af 36, og "løb udvikler rytterne" er skemaets nr. 1): #4846 → #4847 → #4851 → #4852/#4853/#4854 → #4848 → #4849. #4801 · #4874 i pakken. #5076 formdyk-forklaring + #5064 scouting-niveauer som help-tekst i #4849.
6. 🔵 **Bestyrelsen: Mandatet-flip** (27/9): #4857 (ejer-go) → #4859 → #4858. Videre design: GDD D-040/D-041.
7. 🔵 **Cutover-pakke:** #4592 inaktive (ejer godkender liste) → #452 → #4759 · #4619 · #4860 sponsorpris S4 · #4376 sponsor-base ved oprykning.

## Bane 2 · Forretning (viger aldrig; SSOT: [`GROWTH_STACK.md`](GROWTH_STACK.md))

Mål 2/10: ≥ 450 kr / ≥ 10 · checkout ≥ 60 % · D7 ≥ 45 % · aktive/7d ≥ 100 (målt 7/9: 90).
8. 🟠 **Spørgeskema #4943:** 27 gennemført, admin-side live. Fund: ungdom+træning øverst; veto > 20 % på delte programmer, AI-bud, indbakke-transfers; Pro må aldrig give fordel. Luk ved 40 eller 15/9. Fog of war-afstemning: `docs/drafts/forum-poll-fog-of-war-2026-09-10.md` (ejeren poster).
9. 🔵 **Mail:** #5045 → testmail → #5038 ejer-trin (Resend-webhook, DMARC) → flip pr. type → #2760 win-back.
10. 🔵 **Nøgleblok #4616** → Pro i euro #4608 → #4645 → #4646 · #4074 · #4005. **Billing-vagter** #4514 · #4512. **#5051** LTV-fejl (high).
11. 🔴 **Spiller-kommunikation #428/#4820:** ejeren poster selv. Hængende løfter: #4346 anmeld-handel (27/8) · flyt forumkategori ("senest 10/9"). #4964 launch-kohorte 28,6 % (ejer-valg) · #5033 chunk lag 3 (efter #4595).
12. 🟠 **Vækst-fundament (ejer 10/9):** **SEO/markedsføring** #4067 · #3796 · #4811 · #4321 · **hastighed** #5055 · perf-gate/Core Web Vitals · **mobil hele sitet** #1602 · #4982 · #4613. **Fastholdelse:** #4751 · #4821 · #4235 · GDD D-037/D-038.

## Bane 3 · Færdiggør (>70 %; tømmes før nyt)

13. Lukkesession: se 15b (#5155).
14. 🟠 **Docs-SSOT:** #5088 matview-grants · #2259 78 backup-tabeller (48 MB, ejer-go til flyt).
15. 🟠 #4921 feature-register · #4918/#4919/#4920 bølge-drift → **#5142 wave.js-standard** · #5004 preflight anti-slop.
15b. 🔴 **Hygiejne-blok (ejer 11/9, fast rækkefølge):** #3069 rød vagt (48 t) → #5153 advisors (7-dages regel) → #4812 PAT (ejer) → ejer-valg #5154 PITR + #5156 CodeRabbit → #5155 prioritets-regel + lukkesession → #5157 drafts → #5085 CI marketing → #5158 TS-retning (ejer-valg) → #4924 worktrees.
16. 🔵 Akademi: #4495 · #4213 · #4750 · #4423/#4418 (done-gated). Design-rest #4622: #4627 · #4628 · #4813 · #4814 · #4815 · #4613 → **Visuel identitet #5113** (3D-first; først #5115 livery). **Tailwind 4-kæde (ejer 11/9):** #5150 → #5151 (+#3952) → #5152, efter Codex-audit af chunk-forløbet (#5139 holdes).
17. Drift: #4147 · #4866 · #4869 · #4877/#4900/#4899/#4896/#4903 · #4867 · #4828/#4829 · #5017 · #5015 · #2423 (rør ikke).
18. Spillerfund: #4589 · #4702 · #4873 · #4875 · #4861 · #4981 · #4982 · #4983 · #5075 · #5059 sprint-tog gated · #5030 puncheur-opskrift.

## Venteliste · langsigtet værdi (ejerens område-rækkefølge 2/9; **ejer 10/9: trupper U23/junior løftet fra 8 til 3, parret med træning**, på spillerdata)

1 **design-kit/anti-slop** · 2 **drift/tempo** · 3 **rytterudvikling/træning + trupper U23/junior** som én pakke (#4629 · #4630 · #4633 · #3664 · #3709 · #4765 · #4831 · #4206 · #5063 træningslejr · #4620/#4621; roadmap nr. 2, skema nr. 1+3) · 4 **løbsmotor/taktik** (#3855 · #4599/#4600 · #4611 · #4612 · #4614 · #4596 · #5074 peak-planlægning) · 5 **dashboard/indbakke/dag 1** (#4985 · #4984) · 6 **planlægning** (#3329 · #3049/#2794 · #4201) · 7 **kalender** (#4176 · #4103 · #4122 · #4123) · 8 **økonomi** (#3732 · #3360 · #3720 · #1441 · #1310) · 9 **fair play/roller** (#3131 · #3818 · #4537 · #4268) · 10 **vision** (#2359 · #1154 · #1177 mentor D-026–031 · #1148 egen avl · #1239 identitet).

**Grundreglerne B/B2/C (ejer 28/8):** efter 27/9; kun rene FEJL rettes før.

## Stående (viger aldrig)

**Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · mere fog of war (6/9; eget GDD-kapitel, ejer 10/9) · maks +1 pr. evne pr. dag (5/9). **Ejer-beslutninger 27-28/8 (genåbn ikke):** løbsdage 1-baseret · afmeldt hold stiller ikke op · løbsdag = bindings-enhed · minimum 6, fladt · to regenereringer forbudt. **Balance:** #2557 ENESTE åbne. **Race engine:** ÉN v4; v3 låst fallback; flip ejer-only. **FROSSET:** #2217/#2218 · #4099/#4100 · #2960.
