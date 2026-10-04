# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt regel 6/9: tre baner, aldrig flere.** 🔴 brand · 🟠 i gang · 🔵 ejer-go · ⚪ ikke startet. ≤1.500 tok. Spørg før omprioritering. Områdernes tilstand: `docs/FEATURE_REGISTRY.yml`. **Intentionen** ejes af GDD'en; MASTERPLAN ejer kun rækkefølgen. Færdigt står IKKE her (patch notes + git-log).

**Reglen:** 🔴 brand foran alt (10/9) · **gør det lovede færdigt** (21/9; dato først, ældste først, samme dato parallelt) · beta → alle før nyt · Bane 2 forretning viger aldrig · Bane 3 færdiggør (>70 %) før nyt. Rytme + kanal-split + seks spor: [`OPERATING_PLAN.md`](OPERATING_PLAN.md) (ejer 3/10) og [`WEEKLY_STEERING.md`](WEEKLY_STEERING.md). Ejer-godkendt 1/10; status-synk 3/10 (audit + Discord).

## 🔴 Brand (nu)

⚪ **#6156 form + formtoppe virker ikke i v4 siden 28/9** (ejer 4/10: byg starter man 5/10; spec `2026-10-04-form-og-formtoppe-i-v4-design.md`). Kører som **løbsmotor-pakke, 4 laner**: #6156 · udbrud/jagt #5951 #5978 · genmål i v4 #3460 #5059 #2557 #3426 #3965 #5907 · kalibrering #4914 #4197 #5515. **Trin 0 først:** tjek hvad der allerede er løst + kvaliteten af de 22 motorændringer siden flippet · 🔵 #6129 kompensation for tabte træningsdage (#6061-forebyggelse live 3/10; ejer-go på genberegnet hash) · 🔵 #6115 tilbud annulleres ved holdskifte (PR #6128 klar til go-kort; data repareret 3/10) · 🟠 #5928 træthed 5x · 🟠 v2-etaper mod den endelige test · 🟠 #5912 tabte træningsdage 28/9 (genoprettet 1/10; mangler svarudkast til spillerne) · 🔵 #5897 217 bestyrelser (kort søn).

## Uge 41 · rækkefølge (ejer 4/10)

1 løbsmotor-pakken (start man 5/10) · 2 go-kort #6128 + #6053 · **🟠 roadmap-hub #5387 bygges nu** (5 spor #6149-#6152 + #6154; spec + plan `superpowers/*/2026-10-04-roadmap-hub*`; indfrier løftet 30/9 om status, når ting er live) · **stabilitet rykker op** (ejer: infrastrukturen skal fungere fantastisk igen; Codex om natten, se release-gate 1) · løfter · beta → alle · Udvikling 2.0 · betaling. Én bølge ad gangen: Claude om dagen, Codex om natten. Overblik: `pr-screens/roadmap-4-10/samlet-plan-uge41.png`.

## Bane 1 · Træning færdig (ejer 1/10: "så hurtigt som muligt")

🔵 **Flip-liste beta → alle** (flip lukker alle i samme tur): `training_train_now` (#6006/#6027/#4847) · `training_programs` (#4629) · `training_groups` (#6000) · `season_matrix_mobile` (#5124) · dagvalg #5685 · historik #5947. **Træningspakke man 5/10:** #6035 (PR #6053) · #6123 nulstil til holdprogram · #6060 · #5915 løbsdag-numre · #5485 · **lovet:** #5965 analyse. Derefter #5949 · #5630 · #5539 · #5911 < 2 min (kun delvist).

🔵 **Udvikling 2.0 [#6110](https://github.com/NicolaiDolmer/CyclingZone/issues/6110) (ejer 3/10, S4):** design søn 4/10-man 5/10 (kort D1-D7, ét ad gangen) → byg uge 41 (6.-10/10): kurve B #3564 · løbsdag + rolle #5950 · tilbagegang/løbsbremse #6109 (klar før S4→S5) · én kurve for AI/frie #6059. Spec `2026-10-03-udvikling-2-design.md`.

## Bane 1 · Lovet til spillerne (dato først)

27/9: ⚪ #5831 besked til hold (kun holdsiden). 28/9: ⚪ #5917 transferliste → U23. 30/9: ⚪ #5979 påmindelser kommer igen (S4). 1/10: #6035 (se træning). 2/10: ⚪ #6060 kopiér en dags plan (egomadsen).

## Release-gate (beta → "færdigt spil", ejer 30/9)

1. **Stabilitet:** 0 brand i 7 dage · aftentræning < 2 min (#5911) · #5904 · #6134 (rest af #5900; #5900 + #5905 done) · chunk #5162 · Supabase-stabilisering #5893 (#6103 lukket 3/10; tilbage #6102 #6104 #6105) · API på eget domæne. 2. **Motor:** #6156 · v4-drift-vagt grøn · v2-etaper holder mod testen · #5978 · #5951 · #4914. 3. **Træning:** alle beta-features til alle. 4. **Økonomi:** #5916 · #5842 · #5443-tjekliste ajourført. 5. **Fastholdelse:** #4964. 6. **Mobil:** #5131. 7. **Billing:** #4514 · #4512 · #4511 · #6062 periode uden faktura.

## Bane 2 · Forretning (SSOT: [`GROWTH_STACK.md`](GROWTH_STACK.md))

D7 ≥ 45 % · aktive/7d ≥ 100. Måling #5305 · SEO #5249 #5250 · billing #4514 #4512 · #6047 Malwarebytes blokerer cyclingzone.org (indberet 3/10) · spiller-kommunikation #428/#4820 (ejeren poster selv).

## Bane 3 · Færdiggør

#6081 merge-køen melder rød for tidligt · #5692 matview-lås (PR #6153 draft: SQL lægges i prod først, ejer-go) · #5792 smoke + #6132 + #6120 (blokeret på filmandat; nyt mandat i plan-fil) · #2259 backup-tabeller · #5678 · #5681 · #3556 · #5507 · #4812 → #5157 · #5151 → #5152 · #5113 (først #5115) · #6064/#6065 bølge-værn · #5145 (parkeret).

## Ejer-beslutninger (ét kort ad gangen)

**Søn 4/10-man 5/10:** Udvikling 2.0 D1-D7 (#6110) · Mentale evner #5268 (A: eksisterende ryttere røres ikke, 0 ratingfald · B: ratingneutral omregning) · #5827 point-flyt (følger #5268) · fast søndagstidspunkt for værdikørslen (#5842; kører kl. 06 indtil da) · #5833 pause mellem sæsoner til S5 · #6129 kompensation for tabte træningsdage (16 ryttere/130 slots). **Ny triage man 5/10:** Discord-fund #6122-#6126.

## Skubbet til S5 (meldt ud) + venteliste

TTT #3463 (+ følgesager #4915) · ungdoms-op/nedrykning · taktik-epic #5575 lag 2-4 · omdømme for nation/klub #4957 og løb/personale #5106.

## Stående (viger aldrig)

**Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · synlige ratings falder aldrig uden ejerens vidende · maks +1 pr. evne pr. dag. **Ejer 28/8 (låst):** løbsdage 1-baseret · afmeldt hold stiller ikke op · minimum 6, fladt · to regenereringer forbudt. **Race engine:** ÉN v4 (on siden 28/9); flip af regler ejer-only. **FROSSET:** #2217/#2218 · #4100.
