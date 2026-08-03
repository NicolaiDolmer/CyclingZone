# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> Ejer-godkendt 2026-07-11; omskrevet 23/7; **re-synket 3/8** efter fuld ugesweep (Discord 27/7-3/8 + Sentry/Railway/Supabase-triage + prod-metrikker): **14 nye issues #3190-#3203** (heraf 7 ejer-direktiver fra #feedback-from-dolmer), 9 evidens-kommentarer, 3 verificerede closes (#3052/#3130/#3180) → **~452 åbne**. Ejer-mandat (30/7): **LØS opgaverne — jag ikke tallet ~200.** Regel: ét spor gøres FÆRDIGT før næste startes. Status: 🔴 brand/deadline · 🟠 i gang · 🔵 ejer · ⚪ ikke startet. Budget ≤1.500 tok. Visuel udgave: [masterplan-artifact](https://claude.ai/code/artifact/e12714cc-8f93-482d-a87a-eba4e05e1635) (re-synket 3/8). Klassifikations-grundlag: [`backlog-priorities-2026-07-30.md`](audits/backlog-priorities-2026-07-30.md).

**Målt i prod 3/8:** 189 brugere (+28 på 4 dage) · 19 nye/7 d · WAU 32, DAU 8 · **1 abonnement (uændret)** · 176 rigtige hold · retention-kohorten 7-28 d: **83 % vender aldrig tilbage efter dag 1** (n=60) · S2 slutter søn 23/8. Konsekvens uændret og skærpet: anskaffelsen virker, fastholdelsen gør ikke — og indtægtskæden er stadig lukket (checkout pauset, /pro uden indgang, e-mail-loop slukket) mens en spiller aktivt spurgte "Is the pro already active?" (31/7).

## Stående spor (viger aldrig): stabilitet + fastholdelse
**Balance er rød:** #2731 maxRiderWinRate 0,67-0,75 vs mål 0,45 (siden 16/7) · #2557 hold-dominans — nu også spiller-fortælling ("Wander Riders tager os alle") · balance-drift-vagten meldte bånd-brud 30/7 + 2/8 + 3/8 · #3015 AI-ryttere restituerer aldrig · #3009 scorecards exiter grønt trods FAIL. **Dataintegritet:** ✅ 3/8: #3185-væksten stoppet (PR #3206 live — vagt-ghost-filter + #3119/#3122; post-verify: 4 historiske par, 0 nye, tomme enheder 553→0). Luk #3185 når morgendagens vagt-tick viser count=4.

## 1 · NU-BØLGE (denne uge)
1. ✅ **S2-dataintegritet FÆRDIG 3/8:** #3119+#3122+#3185-fixet live og post-verificeret (PR #3206). #3120-dry-run: **0 point/0 kr at modregne** → anbefalet luk uden mutation (ejer-ja udestår).
2. 🔵→🟠 **Penge-kæden (ejer-gates → kode):** #2813 go-live-gates (support-mail · moms-tjek i Alunta · `CHECKOUT_PAUSED`-flip) → **#3104 etape D** /pro-indgang → **#2736 fornyelses-webhook FØR ~24/8** (eneste kunde mister ellers Pro) → #2853 e-mail-loop (3 tekster + 2 nøgler) → #2816/#2817/#2820.
3. 🔴 **Sæsonslut 23/8 (20 dage):** #3038 season-end-spærren · #3036 countback · **#1688 pulje-bevidst op/nedrykning (kodens eget HARD-GATE for S3)** · **#1150 kontraktudløb skal VIRKE ved skiftet (ejer-direktiv 3/8: "kontrakter skal virke efter intentionen" — 807 ryttere udløber efter S2; design-valg frigivelse vs. tvangs-genforhandling først)** · #2916 opsætning bæres ikke over · #2752/#2361 skiftet som oplevelse.
4. 🟠 **Fair play:** fundament #3132 verificeret live 3/8 (581 events; kun privatlivstekst-gate tilbage) → #3133+#3134 ∥ #3135+#3136+#3137 → #3138 → #3139 (+#3184 som del I). #3153 manuel review.
5. 🟠 **Frisk mobil-regression:** [#3194](https://github.com/NicolaiDolmer/CyclingZone/issues/3194) fixet + testet 3/8 — **PR #3207 afventer ejerens visuelle go** (screenshots leveret i chat).

## 2 · EJER-DIREKTIV-SPORET (nyt 31/7-3/8 — rækkefølge kræver ejer-ja)
Fra #feedback-from-dolmer: **#3196** samlet vækst-dashboard (DAU/WAU/MAU-grafer, D1/D7/D30-trends, LTV, attribution, NPS; lås analytics-RPC'er samtidig) · **#3197** resultat-fladen (vælgere + egen kontekst som default + resultater først) · **#3198** økonomi-audit (komplethed/korrekthed af oversigter, forecast, historik — kendte huller #2913/#2840/#2793/#2926/#2912 indgår) · **#3199/#3200** in-game forum m. polls + spiller-beskeder (design-samtale først) · **#3201** admin-notifikation ved spillerbeskeder (+#2739 ping-fixet) · **#2792** AI ud af global rank (høj, sammen med #3193) · **#2758** daglig Discord→GitHub-automation (design klar på issuet, afventer go).

## 3 · AUGUST — vækst oven på et tæt spand
16. ⚪ Fable-sporet: #2822 benchmark · #1369 retention-arkitektur · #1140 første 20 min · #2824 synlighed/SEO · #2823 fleet-playbook. **Aktiverings-hullet:** #3007 (61 hold har aldrig budt) · #2182 · #3067 · #3187/#3188 dead-clicks (verificér #3189 Clarity-bot-støj først).
17. ⚪ Onboarding: #1569 + #2045 (19 % ser nogensinde et løbsresultat) · velkomstmail venter kun på e-mail-loop.
18. ⚪ #1173 referral + #2236 outreach + #2759 ads (løbende, ikke begivenhedsbundet).
19. ⚪ #62/#91/#2180 daglig rytme · 20. ⚪ #2443/#1602/#2445 menu + mobil · #2009/#2448 · #2810 · 21. ⚪ #2698/#2262/#1974 progression · #2887 (nu m. genansættelses-bug) · #2699 akademi-nerf (ejer-udskudt) · #2084/#1299/#1301 · 22. ⚪ #2042 login-væg (A-delen billig; hører til #2824).

## 4 · EFTER AUGUST
Vægtning (ejer): simulerings-dybde > polish > indholds-bredde. 23. Træning/ungdom #2492 m.fl. · 24. Kontrakt-liv #1150/#1310 (**udløbs-håndhævelsen FLYTTET FREM til NU-bølge pkt. 3, ejer 3/8**; resten — krav/klausuler/lån — forbliver her) · 25. Motor-dybde #2476/#2410/#2416/#2412 · 26. Værdi-kæden #2667/#2669/#1281/#2452/#2670 · 27. #2477 · 28. Skalering #323/#1375 (~300 brugere) · 29. #1441 · 30. Socialt lag #2209/#935 (**løftet af ejer-direktiv 3/8 → #3199/#3200 er v1**) · 31. Brand #481/#671 + SEO · 32. #955 · 33. #2462.

## Ops/community-sidestrøm (subagent, aldrig hovedspor)
#2758 (nu ejer-krævet automatisk) · #2460 · #2440 · #2409/#2423 · #2511 · #2572 · AI-audit #2689 · Railway MCP re-auth (fundet 3/8) · Supabase-hærdning: #3124 matviews · is_admin anon · #929 leaked-password (genbekræftet 3/8) · #2830/#2901/#2858.

**FROSSET:** #2217/#2218. **Parkeret:** #1712 (≥300) · #1941 · #450 · live-taktik/replay.

## 5 · 2027-HORISONT (vision — bevidst ikke i kø)
Verdenshistorik/klubmuseum · #1154 · #934 · #1113 · #1099 · #935 · #2222 · #26 · #938 · #1108 · #1146 · #50.
