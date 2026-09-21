# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt regel 6/9: tre baner, aldrig flere.** 🔴 brand · 🟠 i gang · 🔵 ejer-go · ⚪ ikke startet. ≤1.500 tok. Spørg før omprioritering. Områdernes tilstand: `docs/FEATURE_REGISTRY.yml`. **Intentionen** ejes af GDD'en; MASTERPLAN ejer kun rækkefølgen.

**Reglen (ejer 6/9):** **Bane 1 deadline** = kun det der er låst til S4-cutover, fast rækkefølge, intet nyt ind. **Bane 2 forretning** = indtjening, kunder, fastholdelse; viger aldrig. **Bane 3 færdiggør** = alt over 70 % færdigt, tømmes FØR noget nyt startes. **Ejer-mandat 10/9:** færre fejl → 🔴 brand går foran alle baner. 649 åbne 21/9; rytme: [`WEEKLY_STEERING.md`](WEEKLY_STEERING.md).

## 🎯 Gør det lovede færdigt (ejer-godkendt 21/9; foran alt andet end brand)

Intet nyt startes før A+B er live.
**A · ejerens hånd:** 1 post catch-up #5429 · 2 "merge" #5169 · 3 flip `training_score_visible` + udmelding (#4851) · 4 Android-test → flip `training_mobile_table` → slet gammel gren (#3643) · 5 win-back #2760 inden 24/9.
**B · Claude, i rækkefølge:** 6 værdiskiftet #5443 · 7 S4-kalender synlig #5405 (efter #5169) · 8 træning pr. løbsdag live 28/9 (flip-dag, #5281) · 9 /roadmap = roadbooken #5387.
**Derefter:** roadbook-løfterne (Discord 15/9) først; så det vigtigste ELLER det hurtigst brugbare. Bølge 5-7 nås ikke samlet til 27-28/9: ejer-kort udestår. **Codex-lane:** forum-links #3517.

## 🔴 Brand (rettes før alt andet; intet merges uden ejer-go)

**#5323 Quad9 låser spillere HELT ude** (#5312): SERVFAIL på `up.railway.app`; de ramte forsvinder stille. ✅ #5324 måling (17/9) → aflæs Sentry → DNS-test FØR flytning (ejer).
**Rest:** **#5443 værdisystemet færdigt** (trin 1-3 før 27/9) · #4595 → epic #5162 · #5242 apiFetch PR 2 = 214 kaldsteder · #5288 · #5256 TTT-vægt · #5325.

## Bane 1 · S4-cutover 27-28/9 (rækkefølge ejer-godkendt 15/9; intet udskydes uden ejer-aftale)

1. ✅ **Bølge 1** (score #4851 bag flag) · #3668 → #5268.
2. 🟠 **Bølge 2:** 🔵 **træningsdesign** (140 låst; måde B valgt 20/9 → #5169 venter "merge" → B4 #5264 ✅ bag flag → B3 #5281 flip-dagen) · ✅ mobil-træning #5397 + #5458 (beta).
3. 🟠 **Bølge 3, rytter-fundament:** ✅ fødsel uden PCM, `riders.squad`, evner som data (backfill + point-flyt #5268 ejer-gated) · #5269 · #5273.
4. ⚪ **Bølge 4, kalender m. trupper (FØR S4-generering):** 🟠 **S4-kalender synlig** (#5405, go pr. kørsel; frist 21/9 røget) · pakker pr. trup · generator A6 (U23-bånd variant A) → AI U23/junior-ryttere · #5327 arketype (#3512) m. #5269 · C1 · dry-run → go → #4270 apply (ejer).
5. ⚪ **Bølge 5, træning færdig (28/9):** skader i løbsdage · program 7×5 (mockup først) · #5238 Åbnere · B6 træningssiden én gang (#4849) · #4852-#4854 · #4848.
6. ⚪ **Bølge 6, trup-flader:** Graduation Day (#2491, frist røget) · U23/junior-sider · udtagelse/standings/Youth races · præmie-gren.
7. 🔵 **Bølge 7, cutover:** #4592 → #452 → #4759 · Mandatet-flip #4857 (ejer-go) → #4859 → #4858 · v4 (M12 · #4948) → **flip ejer-only** → #4916.
8. ⚪ **Efter apply:** Holdarbejde i v4 + mentorpar (bag flag) · #3458/#3512.

## Bane 2 · Forretning (viger aldrig; SSOT: [`GROWTH_STACK.md`](GROWTH_STACK.md))

Mål 2/10: ≥ 450 kr / ≥ 10 ✅ (Alunta 14/9: 659 kr / 18) · checkout ≥ 60 % ✅ · D7 ≥ 45 % (30 %) · aktive/7d ≥ 100 (90). **Tilgang + fastholdelse er flaskehalsen, ikke penge.**
8. Ejeren poster forum-opslag + fog of war-afstemning (#4943 ✅).
9. 🟠 **Fastholdelse:** #5241 måles 28/9 (#4964) · #5282 transfer-ring · #5320 · #4751 · #3517 forum-links (3. ønske) · #5107 fog of war · late_fill (#5246).
10. 🟠 **Vækst-fundament:** **måling først** #5304 #5310 #5305 #5306 · **SEO** #5249 statisk + #5250 session-cookie · rest #4067 #3796 #4811 #4321 · **hastighed** #5177 #5055 CWV-gate · **mobil** #1602 #4982 #5131. Uge-blok: 2 handlinger + 1 måling.
11. 🔵 **Mail:** #2760 win-back bygget bag flag; tekst v2 rettes m. ejeren → dry-run → send-go inden 24/9 · #5045 → testmail → #5038 → flip pr. type. **Nøgleblok #4616** → #4608 → #4646. Billing-vagter #4514 · #4512.
12. 🔴 **Spiller-kommunikation #428/#4820:** ejeren poster selv. #5033 (efter #4595).

## Bane 3 · Færdiggør (>70 %)

13. 🟠 #2259 backup-tabeller (ejer-go til flyt).
14. **Hygiejne-blok (ejer 11/9):** #4812 PAT (ejer) → #5157 (#3512 → #5327) → budget FAIL AGENTS.md + FEATURE_STATUS.md → #5309/#5219 · #5218 · #4924 · GDD D-049+ (#5087) + registry DM v1.
15. 🔵 Akademi: #5145 (PR #5197 parkeret til U23/junior) · #4750. Design-rest #4622 (#4627 · #4628 · #4813-#4815 · #4613) → **Visuel identitet #5113** (3D-first; først #5115 livery). **Tailwind 4:** #5151 (+#3952) → #5152.
16. Drift: #4867 #4829 · #2423 (rør ikke).
17. Spillerfund: #4702 #4875 #4982 #5075 #5059 #5030 #5200 #5201 · 18/9: #5382-#5391 #5180 #5179 · uge 38: `audits/2026-09-17-*.md`. Rating-regel: #5351.

## Venteliste · langsigtet værdi (ejer 2/9; 10/9: trupper løftet til 3, parret med træning)

1 **design-kit/anti-slop** · 2 **drift/tempo** · 3 **rytterudvikling/træning + trupper U23/junior** (#4629 #4630 #4633 #3664 #3709 #4765 #4831 #4206 #5063 #4620) · 4 **løbsmotor/taktik** (#3855 #4599 #4600 #4611 #4612 #4614 #4596 #5074) · 5 **dashboard/indbakke/dag 1** (#4985 #4984) · 6 **planlægning** (#3329 #3049 #2794) · 7 **kalender** (#4176 #4122 #4123) · 8 **økonomi** (#3732 #3360 #3720 #1441 #1310) · 9 **fair play/roller** (#3131 #3818 #4537 #4268) · 10 **vision** (#1154 #1177 #1148 #1239 #5307 #5106).

**Grundreglerne B/B2/C (ejer 28/8):** efter 27/9; kun rene FEJL rettes før.

## Stående (viger aldrig)

**Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · mere fog of war · maks +1 pr. evne pr. dag. **Ejer-beslutninger 28/8 (låst):** løbsdage 1-baseret · afmeldt hold stiller ikke op · løbsdag = bindings-enhed · minimum 6, fladt · to regenereringer forbudt. **Balance:** #2557 ENESTE åbne. **Race engine:** ÉN v4; v3 låst fallback; flip ejer-only. **FROSSET:** #2217/#2218 · #4100.
