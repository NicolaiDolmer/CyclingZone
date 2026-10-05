# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt regel 6/9: tre baner, aldrig flere.** 🔴 brand · 🟠 i gang · 🔵 ejer-go · ⚪ ikke startet. ≤1.500 tok. Spørg før omprioritering. Områdernes tilstand: `docs/FEATURE_REGISTRY.yml`. **Intentionen** ejes af GDD'en; MASTERPLAN ejer kun rækkefølgen. Færdigt står IKKE her (patch notes + git-log).

**Reglen:** 🔴 brand foran alt (10/9) · **gør det lovede færdigt** (21/9; dato først, ældste først, samme dato parallelt) · beta → alle før nyt · Bane 2 forretning viger aldrig · Bane 3 færdiggør (>70 %) før nyt. Rytme: [`OPERATING_PLAN.md`](OPERATING_PLAN.md) (ejer 3/10) og [`WEEKLY_STEERING.md`](WEEKLY_STEERING.md).

## 🔴 Brand (nu)

⚪ **#6156 form + formtoppe virker ikke i v4 siden 28/9** (spec `2026-10-04-form-og-formtoppe-i-v4-design.md`; bygges efter de øvrige motorpunkter; embargo på roadmappet). Trin 0 ✅ (#6157) · 🟠 #6129 anvendt 5/10 (7 blokerede efterkontrolleres) · 🟠 #5928 træthed 5x · 🟠 v2-etaper mod den endelige test · 🟠 #5912 tabte træningsdage 28/9 (svar i næste roadbook) · 🔵 #5897 217 bestyrelser.

## Uge 41 · rækkefølge

Alt parallelt: løbsmotor-pakken (byg bag `orders_gc_v3`, flip ejer-only: 🟠 i lane: #6187 · #6185 del 1 · #6137 · venter på v3: #3460 halv støtte · #6185 del 2 · efter #6187: #5978 (svært af sted + snor) → #6201 (bjerg 6-12, loft 16) · #6199+#6200 aftalt (kat. 3-mål mangler) · design mangler: #2557 · Arbejd+loft · #6186 #5059; #6156 efter) · **Supabase-stabilisering (#5893):** ① staging færdig #5904 (Claude) samtidig med ② timeout-diagnose #6184 (PR #6196 synkes) + #5878 → ③ tunge kald på staging (måling #6184): liveness-tælling · rangliste ved hændelse #5692 (før 25/10) · #3511 · #6102 (PR #6136, ejer-kør) · Realtime → ④ ved siden af: #4269 (ejer opretter token) · #6104 · #6105 · #708 (Codex, før 30/10). Venter på ①: #6134 jobkø · #5911 · træningspakken + beta→alle · Udvikling 2.0 (+#4765) · Holdarbejde-opfyldning (#5268 A, 7.739 NULL) · løfter #5831 #5917 #5979 #6060 · #4714 (beslut + indfør) · #5940 + #5916 · #6138 · #6210 maks +1 · #6212 patch notes · #6062 · #6121 privacy · roadmap #6174 #6175 #6172 #6165 #6164 · #6053. **Før S5 (25/10):** #6109 · #5865 · #5842 · #5833 afstemning · ungdoms-upkeep 0 i S5 meldes ud. **Uge 43-46:** #6190.

## Roadmap · Planned (spejles i `roadmap_items.sort_order`)

**Next:** stabilitet (#5878 #6184 #5911) · #3984 · #4522 · #4714 · #5833 · #2887 B · #6190 · #5831 · #5917 · #6060 · #1140 · #5105 · #3813 · #5981 · #5074 · #5238 · #5865 · #5131 · race sharpener · værdier uden potentiale. **Later:** #1177 · #2887 A · #2768 · #5573 · #4620 · #5113 · #5101 · #5575 · #5574 · #3463 · #6125 · #2176 · #4957 · #5106 · #3374 · #3513 · #2223 · #2161. #6203 søgning · #6204 admin · #6205 sync. **Not planned for 2026:** [`2026-10-05-2027-list.md`](superpowers/plans/2026-10-05-2027-list.md). **Næste roadbook-opslag:** #5268-historien · #5912-svar · upkeep 0 · #5833-afstemning.

## Bane 1 · Træning færdig (ejer 1/10: "så hurtigt som muligt")

🔵 **Flip-liste beta → alle** (flip lukker alle i samme tur): `training_train_now` (#6006/#6027/#4847) · `training_programs` (#4629) · `training_groups` (#6000) · `season_matrix_mobile` (#5124) · `race_role_scope_choice` (#6095) · historik #5947. **Træningspakke man 5/10:** #6035 (PR #6053) · #6123 nulstil til holdprogram · #6060 · #5915 løbsdag-numre · #5485 · **lovet:** #5965 analyse. Derefter #5949 · #5630 · #5539 · #5911 < 2 min (kun delvist).

🔵 **Udvikling 2.0 [#6110](https://github.com/NicolaiDolmer/CyclingZone/issues/6110) (ejer 3/10, S4):** design søn 4/10-man 5/10 (kort D1-D7, ét ad gangen) → byg uge 41 (6.-10/10): kurve B #3564 · løbsdag + rolle #5950 · tilbagegang/løbsbremse #6109 (klar før S4→S5) · én kurve for AI/frie #6059. Spec `2026-10-03-udvikling-2-design.md`.

## Bane 1 · Lovet til spillerne (dato først)

31/8 #4522 · 19/8+15/9 #3984 · 27/9 #5831 · 28/9 #5917 · 30/9 #5979 #5940 · 1/10 #6035 · 2/10 #6060 · 3/10 #6209 omdømme · 4/10 #4714 (rækkefølge = roadmap).

## Release-gate (beta → "færdigt spil", ejer 30/9)

1. **Stabilitet:** 0 brand i 7 dage · #5911 < 2 min · #5904 · #6134  · chunk #5162 · Supabase-stabilisering #5893 (#6102 #6104 #6105) · API på eget domæne. 2. **Motor:** #6156 · v4-drift-vagt grøn · v2-etaper holder mod testen · #5978 · #5951 · #4914. 3. **Træning:** alle beta-features til alle. 4. **Økonomi:** #5916 · #5842 · #5443-tjekliste ajourført. 5. **Fastholdelse:** #4964. 6. **Mobil:** #5131. 7. **Billing:** #4514 · #4512 · #4511 · #6062 periode uden faktura.

## Bane 2 · Forretning (SSOT: [`GROWTH_STACK.md`](GROWTH_STACK.md))

D7 ≥ 45 % · aktive/7d ≥ 100. Måling #5305 · SEO #5249 #5250 · billing #4514 #4512 · #6047 · spiller-kommunikation #428/#4820 (ejeren poster selv).

## Bane 3 · Færdiggør

#6081 merge-køen melder rød for tidligt · #5692 (rest: sæsonskiftets refresh, se uge 41) · #5792 smoke + #6132 + #6120 · #2259 backup-tabeller · #5678 · #5681 · #3556 · #5507 · #4812 → #5157 · #5151 → #5152 · #5113 (først #5115) · #6064/#6065 bølge-værn · #5145 (parkeret).

## Ejer-beslutninger (ét kort ad gangen)

**Åbne:** Udvikling 2.0 D1-D7 + #4765 (#6110) · #5842 (før 25/10) · #5878 compute · #4269 token · kort F statusfejl · #6122 bestyrelse. **Afgjort 5/10:** #6187 · #6185 · #6137 · #3460 · #5978 · #6201 (se issues) · #6134 venter staging · #5981 A · #2887 B/A · #5268 A.

## Skubbet til S5 (meldt ud) + venteliste

TTT #3463 (+ følgesager #4915) · ungdoms-op/nedrykning · taktik-epic #5575 lag 2-4 · omdømme for nation/klub #4957 og løb/personale #5106.

## Stående (viger aldrig)

**Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · synlige ratings falder aldrig uden ejerens vidende · maks +1 pr. evne pr. dag. **Ejer 28/8 (låst):** løbsdage 1-baseret · afmeldt hold stiller ikke op · minimum 6, fladt · to regenereringer forbudt. **Race engine:** ÉN v4 (on siden 28/9); flip af regler ejer-only. **FROSSET:** #2217/#2218 · #4100.
