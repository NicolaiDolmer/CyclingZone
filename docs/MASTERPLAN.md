# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt regel 6/9: tre baner, aldrig flere.** 🔴 brand · 🟠 i gang · 🔵 ejer-go · ⚪ ikke startet. ≤1.500 tok. Spørg før omprioritering. Områdernes tilstand: `docs/FEATURE_REGISTRY.yml`. **Intentionen** ejes af `docs/GAME_DESIGN_DOCUMENT.md` (D-001+); MASTERPLAN ejer kun rækkefølgen.

**Reglen (ejer 6/9):** **Bane 1 deadline** = kun det der er låst til S4-cutover, fast rækkefølge, intet nyt ind. **Bane 2 forretning** = indtjening, kunder, fastholdelse; viger aldrig. **Bane 3 færdiggør** = alt over 70 % færdigt, tømmes FØR noget nyt startes. **Ejer-mandat 10/9: "der skal ikke længere komme fejl ofte"** → 🔴 brand går foran alle baner. **Målt 17/9 em:** 637 åbne; rytme: [`WEEKLY_STEERING.md`](WEEKLY_STEERING.md); udestående ejer-kort i NOW.

## 🔴 Brand (rettes før alt andet; intet merges uden ejer-go)

**#5323 Quad9 låser spillere HELT ude** (#5312): SERVFAIL på `up.railway.app`; de ramte forsvinder stille. ✅ #5324 måling merget 17/9 → aflæs Sentry 19/9 → DNS-test (`nslookup api.cyclingzone.org 9.9.9.9`) FØR flytning (ejer).
**Rest:** #4595 → epic #5162 (CYCLINGZONE-56 flad) · #5242 apiFetch PR 2 = 214 kaldsteder · ✅ #5322 · #5296 welcome-mail 0 (verify, formentlig vagten) · #5301 afmelding usynlig · #5288 baroudeur-loft · #5222 · #5256 TTT-vægt · #5325.

## Bane 1 · S4-cutover 27-28/9 (bølge-rækkefølge ejer-godkendt 15/9; intet udskydes uden ejer-aftale)

1. ✅ **Bølge 1:** #4851 score (flag beta) · #3668 → #5268.
2. 🟠 **Bølge 2:** ✅ #5236/#5237 · ✅ #5211 · 🔵 **træningsdesign-session** (#5267 tick-akse, B3 #5281 + B4 #5264 merges sammen bagefter, #5169) · ✅ sponsor #5336 (17/9; #4860/#4376 done) · ✅ #5235 mobil (#5124).
3. 🟠 **Bølge 3, rytter-fundament:** ✅ #5278 fødsel uden PCM · ✅ #5283 generator-test · ✅ #5279 `riders.squad` (backfill ejer-gated) · ✅ #5280 evner som data (point-flyt #5268 ejer-gated) · #5269 · #5273.
4. ⚪ **Bølge 4, kalender m. trupper (FØR S4-generering):** **U23-filter i seniorlæserne** (unblocker #5262 katalog, draft grøn) · ✅ #5272 · pakker pr. trup · **#5376 U23-fødselsbånd (designkort, blokerer)** → AI U23/junior-ryttere · #5327 arketype (#3512) m. #5269 · C1 · dry-run → go → #4270 apply (ejer). Spec `2026-09-15-u23-*.md`.
5. ⚪ **Bølge 5, træning færdig (28/9):** skader i løbsdage · program 7×5 (mockup først) · #5238 Åbnere · B6 træningssiden én gang (#4849) · #4852-#4854 · #4848.
6. ⚪ **Bølge 6, trup-flader:** Graduation Day (#2491, senest 20/9) · U23/junior-sider · udtagelse/standings/Youth races · præmie-gren.
7. 🔵 **Bølge 7, cutover:** #4592 → #452 → #4759 · Mandatet-flip #4857 (ejer-go) → #4859 → #4858 · v4 (M12 · #4948) → **flip ejer-only** → #4916.
8. ⚪ **Efter apply:** Holdarbejde i v4 + mentorpar (bag flag) · #3458/#3512.

## Bane 2 · Forretning (viger aldrig; SSOT: [`GROWTH_STACK.md`](GROWTH_STACK.md))

Mål 2/10: ≥ 450 kr / ≥ 10 ✅ (Alunta 14/9: 659 kr / 18) · checkout ≥ 60 % ✅ · D7 ≥ 45 % (30 %) · aktive/7d ≥ 100 (90). **Tilgang + fastholdelse er flaskehalsen, ikke penge.**
8. ✅ Spørgeskema #4943 lukket 15/9; ejeren poster forum-opslag + fog of war-afstemning selv.
9. 🟠 **Fastholdelse:** #5241 ét klik ✅ (måles 28/9, #4964) · #4346 anmeld handel ✅ · #5284 admin-fairplay ✅ 17/9 · #5282 transfer-ring · #5320 · **#5259 beta-adgang** (ejer 15/9, opt-in, høj prio) · #5257 global handelsliste · #4751 · #3517 forum-links (3. ønske) · #5107 fog of war · late_fill (#5246).
10. 🟠 **Vækst-fundament:** **måling først** #5304 #5310 #5305 #5306 · **SEO** #5239 ✅ → #5249 statisk + #5250 session-cookie · rest #4067 #3796 #4811 #4321 · **hastighed** #5177 #5240 #5055 CWV-gate · **mobil** #1602 #4982 #5131. Uge-blok: 2 handlinger + 1 måling (`drafts/growth-s4-launch-2026-09-17.md`).
11. 🔵 **Mail:** #2760 win-back bygget bag flag; tekst v2 rettes m. ejeren → dry-run → send-go inden 24/9 · #5045 → testmail → #5038 → flip pr. type. **Nøgleblok #4616** → #4608 → #4646. Billing-vagter #4514 · #4512.
12. 🔴 **Spiller-kommunikation #428/#4820:** ejeren poster selv. #5033 (efter #4595).

## Bane 3 · Færdiggør (>70 %; tømmes før nyt)

13. 🟠 **Docs-SSOT:** ✅ #5088 · #2259 backup-tabeller (ejer-go til flyt).
14. **Hygiejne-blok (ejer 11/9):** #4812 PAT (ejer) → #5157 (#3512 → #5327) → budget FAIL AGENTS.md + FEATURE_STATUS.md → #5309/#5219 · ✅ #5094 · #5218 · ✅ #5326 · ✅ #5085 → #4924 · ✅ #5328 · ✅ #5329 · GDD D-049+ (#5087) + registry DM v1.
15. 🔵 Akademi: #5145 (PR #5197 parkeret til U23/junior) · #4750. Design-rest #4622 (#4627 · #4628 · #4813-#4815 · #4613) → **Visuel identitet #5113** (3D-first; først #5115 livery). **Tailwind 4-kæde:** #5150 ✅ → #5151 (+#3952) → #5152.
16. Drift: #4867 #4829 · ✅ #5091 #5092 · #5093 (ejer 18/9: CI-guard) · #2423 (rør ikke).
17. Spillerfund: #4702 #4875 #4982 #5075 #5059 #5030 #5200 (✅ #4981 #5201) #5180 #5179 · uge 38 (18): `audits/2026-09-17-*.md`. Rating-regel: #5351.

## Venteliste · langsigtet værdi (ejer 2/9; 10/9: trupper løftet til 3, parret med træning)

1 **design-kit/anti-slop** · 2 **drift/tempo** · 3 **rytterudvikling/træning + trupper U23/junior** (#4629 #4630 #4633 #3664 #3709 #4765 #4831 #4206 #5063 #4620) · 4 **løbsmotor/taktik** (#3855 #4599 #4600 #4611 #4612 #4614 #4596 #5074) · 5 **dashboard/indbakke/dag 1** (#4985 #4984) · 6 **planlægning** (#3329 #3049 #2794) · 7 **kalender** (#4176 #4122 #4123) · 8 **økonomi** (#3732 #3360 #3720 #1441 #1310) · 9 **fair play/roller** (#3131 #3818 #4537 #4268) · 10 **vision** (#1154 #1177 #1148 #1239 #5307 #5106).

**Grundreglerne B/B2/C (ejer 28/8):** efter 27/9; kun rene FEJL rettes før.

## Stående (viger aldrig)

**Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · mere fog of war · maks +1 pr. evne pr. dag. **Ejer-beslutninger 28/8 (låst):** løbsdage 1-baseret · afmeldt hold stiller ikke op · løbsdag = bindings-enhed · minimum 6, fladt · to regenereringer forbudt. **Balance:** #2557 ENESTE åbne. **Race engine:** ÉN v4; v3 låst fallback; flip ejer-only. **FROSSET:** #2217/#2218 · #4100.
