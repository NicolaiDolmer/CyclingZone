# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt regel 6/9: tre baner, aldrig flere.** 🔴 brand · 🟠 i gang · 🔵 ejer-go · ⚪ ikke startet. ≤1.500 tok. Spørg før omprioritering. Områdernes tilstand: `docs/FEATURE_REGISTRY.yml`. **Intentionen** ejes af GDD'en; MASTERPLAN ejer kun rækkefølgen. Færdigt står IKKE her (patch notes + git-log).

**Reglen:** 🔴 brand foran alt (10/9) · **gør det lovede færdigt** (21/9; dato først, ældste først, samme dato parallelt) · beta → alle før nyt · Bane 2 forretning viger aldrig · Bane 3 færdiggør (>70 %) før nyt. Rytme + kanal-split + seks spor: [`OPERATING_PLAN.md`](OPERATING_PLAN.md) (ejer 3/10) og [`WEEKLY_STEERING.md`](WEEKLY_STEERING.md). Ejer-godkendt 1/10; status-synk 3/10 (audit + Discord).

## 🔴 Brand (nu)

⚪ #6095 gem af etapetaktik overskriver alle etapers intentioner (spillerdata tabt, Giro) · ⚪ #5860 entry-generatoren dobbeltbooker stadig (Sentry 1-3/10, ejer 3/10) · 🔵 #6129 kompensation for tabte træningsdage (#6061-forebyggelse live 3/10; ejer-go på genberegnet hash) · 🟠 #6115 tilbud annulleres ved holdskifte (Codex; data repareret 3/10) · 🟠 #5928 træthed 5x · 🟠 v2-etaper mod den endelige test · 🟠 #5912 tabte træningsdage 28/9 (genoprettet 1/10; mangler svarudkast til spillerne) · 🔵 #5897 217 bestyrelser (kort søn).

## Bane 1 · Træning færdig (ejer 1/10: "så hurtigt som muligt")

🔵 **Flip-liste beta → alle** (flip lukker alle i samme tur): `training_train_now` (#6006/#6027/#4847) · `training_fatigue_rules` (#4854) · `training_programs` (#4629, #5932) · `training_groups` (#6000) · `season_matrix_mobile` (#5124) · dagvalg #5685 · prognose #5933 · auto-hvile #5620 · historik #5947. **Træningspakke man 5/10:** #6035 (PR #6053) · #6123 nulstil til holdprogram · #6060 · #5915 løbsdag-numre · #5485 · **lovet:** #5965 analyse. Derefter #5949 · #5630 · #5539 · #5911 < 2 min (kun delvist).

🔵 **Udvikling 2.0 [#6110](https://github.com/NicolaiDolmer/CyclingZone/issues/6110) (ejer 3/10, S4):** design søn 4/10-man 5/10 (kort D1-D7, ét ad gangen) → byg uge 41 (6.-10/10): kurve B #3564 · løbsdag + rolle #5950 · tilbagegang/løbsbremse #6109 (klar før S4→S5) · én kurve for AI/frie #6059. Spec `2026-10-03-udvikling-2-design.md`.

## Bane 1 · Lovet til spillerne (dato først)

27/9: ⚪ #5831 besked til hold (kun holdsiden). 28/9: ⚪ #5917 transferliste → U23. 30/9: ⚪ #5979 påmindelser kommer igen (S4). 1/10: #6035 (se træning). 2/10: ⚪ #6060 kopiér en dags plan (egomadsen).

## Release-gate (beta → "færdigt spil", ejer 30/9)

1. **Stabilitet:** 0 brand i 7 dage · aftentræning < 2 min (#5911) · #5900 · #5904 · #5905 · chunk #5162 · Supabase-stabilisering #5893 (#6103 lukket 3/10; tilbage #6102 #6104 #6105) · API på eget domæne. 2. **Motor:** v4-drift-vagt grøn · v2-etaper holder mod testen · #5978 · #5951 · #4914. 3. **Træning:** alle beta-features til alle. 4. **Økonomi:** #5916 · #5842 · #5443-tjekliste ajourført. 5. **Fastholdelse:** #4964. 6. **Mobil:** #5131. 7. **Billing:** #4514 · #4512 · #4511 · #6062 periode uden faktura.

## Bane 2 · Forretning (SSOT: [`GROWTH_STACK.md`](GROWTH_STACK.md))

D7 ≥ 45 % · aktive/7d ≥ 100. Måling #5305 · SEO #5249 #5250 · billing #4514 #4512 · #6047 Malwarebytes blokerer cyclingzone.org (indberet 3/10) · spiller-kommunikation #428/#4820 (ejeren poster selv).

## Bane 3 · Færdiggør

#6081 merge-køen melder rød for tidligt · #5692 matview-lås · #5792 smoke · #2259 backup-tabeller · #5678 · #5681 · #3556 · #5507 · #4812 → #5157 · #5151 → #5152 · #5113 (først #5115) · #6064/#6065 bølge-værn · #5145 (parkeret).

## Ejer-beslutninger (ét kort ad gangen)

**Søn 4/10-man 5/10:** Udvikling 2.0 D1-D7 (#6110) · Mentale evner #5268 (A: eksisterende ryttere røres ikke, 0 ratingfald · B: ratingneutral omregning) · #5827 point-flyt (følger #5268) · fast søndagstidspunkt for værdikørslen (#5842; kører kl. 06 indtil da) · #5833 pause mellem sæsoner til S5 · #6129 kompensation for tabte træningsdage (16 ryttere/130 slots). **Ny triage man 5/10:** Discord-fund #6122-#6126.

## Skubbet til S5 (meldt ud) + venteliste

TTT #3463 (+ følgesager #4915) · ungdoms-op/nedrykning · taktik-epic #5575 lag 2-4 · omdømme for nation/klub #4957 og løb/personale #5106.

## Stående (viger aldrig)

**Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · synlige ratings falder aldrig uden ejerens vidende · maks +1 pr. evne pr. dag. **Ejer 28/8 (låst):** løbsdage 1-baseret · afmeldt hold stiller ikke op · minimum 6, fladt · to regenereringer forbudt. **Race engine:** ÉN v4 (on siden 28/9); flip af regler ejer-only. **FROSSET:** #2217/#2218 · #4100.
