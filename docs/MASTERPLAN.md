# MASTERPLAN — prioriteret rækkefølge (SSOT for rækkefølgen)

> **Ejer-godkendt regel 6/9: tre baner, aldrig flere.** 🔴 brand · 🟠 i gang · 🔵 ejer-go · ⚪ ikke startet. ≤1.500 tok. Spørg før omprioritering. Områdernes tilstand: `docs/FEATURE_REGISTRY.yml`. **Intentionen** ejes af GDD'en; MASTERPLAN ejer kun rækkefølgen. Færdigt står IKKE her (patch notes + git-log).

**Reglen:** 🔴 brand foran alt (10/9) · **gør det lovede færdigt** (21/9; dato først, ældste først, samme dato parallelt) · beta → alle før nyt · Bane 2 forretning viger aldrig · Bane 3 færdiggør (>70 %) før nyt. Rytme: [`WEEKLY_STEERING.md`](WEEKLY_STEERING.md). Ejer-godkendt 1/10 (side-session).

## 🔴 Brand (nu)

🟠 #6006 Train now træner 1/5 af truppen (PR #6008) · 🟠 #6004 retry-loop 41.000 fejl/døgn (PR #6005) · 🟠 #6009 dobbelt løb samme løbsdag blokerer træning (+ #5860) · 🟠 #5928 træthed 5x · 🔵 #5912 tabte træningsdage 28/9 inkl. juniorer (kort) · 🔵 #5897 217 bestyrelser (kort).

## Bane 1 · Træning færdig (ejer 1/10: "så hurtigt som muligt", i dag)

🟠 #5915 rapportens "unavailable" + fold ud/sortér/gennemsnit · 🔵 Train now kan trykkes hele dagen og giver respons hver gang (beslutning 4/I4 = ejer-kort) · 🔵 flip til alle efter aftentjek 20.05: `training_train_now` (efter #6006), `training_program_cells`, `training_fatigue_rules`, `training_daily_receipt`, `training_programs` · ⚪ #6000 grupper (PR #6001) · rytter → program-rækkefølge · #5949 · #5929 · #5947 · #5630/#5685 · #5911 lukkes når 20.05-tjekket holder. **Venter til man/tir (lovet):** #5965 analyse af udviklingsfart.

## Bane 1 · Lovet til spillerne (dato først)

28/9: 🟠 #5944 ungdomsfravalg (PR #6007, senest 4/10) · 🟠 #5956 bjergpoint (PR #6003, ejer-merge) · ⚪ #5917 transferliste → U23. 27/9: ⚪ #5831 besked til hold (kun holdsiden). 30/9: 🟠 GC-reaktion #6002 (merge efter kalibreringsrapport til ejeren) · 🔵 omdømme-flip `rider_reputation_enabled` (backfill-kort) · ⚪ #5979 påmindelser kommer igen (S4). 1/10: #6000.

## Release-gate (beta → "færdigt spil", ejer 30/9)

1. **Stabilitet:** 0 brand i 7 dage · aftentræning < 2 min (#5911) · #5900 · #5904 · #5905 · chunk #5162 · API på eget domæne (api.cyclingzone.org). 2. **Motor:** v4-drift-vagt grøn · #5957 · #5978 · #5951 · #4914. 3. **Træning:** alle beta-features til alle. 4. **Økonomi:** #5916 · #5842 · #5443-tjekliste ajourført. 5. **Fastholdelse:** #4964. 6. **Mobil:** #5124 · #5131. 7. **Billing:** #4514 · #4512 · #4511.

## Bane 2 · Forretning (SSOT: [`GROWTH_STACK.md`](GROWTH_STACK.md))

D7 ≥ 45 % · aktive/7d ≥ 100. Måling #5241 #5305 #5310 #5306 · win-back #2760 · SEO #5249 #5250 · mail #5045 → #5038 · billing #4514 #4512 · spiller-kommunikation #428/#4820 (ejeren poster selv).

## Bane 3 · Færdiggør

#5692 matview-lås · #5792 smoke · #2259 backup-tabeller · #5678 · #5681 · #3556 · #5507 · #4812 → #5157 · #5151 → #5152 · #5113 (først #5115) · #5145 (parkeret).

## Ejer-beslutninger (ét kort ad gangen)

**2/10:** mentale evner #5268 (A: eksisterende ryttere røres ikke, 0 ratingfald · B: ratingneutral omregning) · **næste styring:** fast søndagstidspunkt for værdikørslen (#5842; kører kl. 06 indtil da) · #5833 pause mellem sæsoner til S5 · #5829 mobil sæsonmatrix A/B · #5827 point-flyt (følger #5268).

## Skubbet til S5 (meldt ud) + venteliste

TTT #3463 · ungdoms-op/nedrykning · taktik-epic #5575 lag 2-4 · omdømme for nation/klub #4957 og løb/personale #5106.

## Stående (viger aldrig)

**Doktrin:** styrke straffes ALDRIG · 1 rytter = 1 løb pr. LØBSDAG · simulér-før-ship · et gulv er aldrig en godkendelse · synlige ratings falder aldrig uden ejerens vidende · maks +1 pr. evne pr. dag. **Ejer 28/8 (låst):** løbsdage 1-baseret · afmeldt hold stiller ikke op · minimum 6, fladt · to regenereringer forbudt. **Race engine:** ÉN v4 (on siden 28/9); flip af regler ejer-only. **FROSSET:** #2217/#2218 · #4100.
