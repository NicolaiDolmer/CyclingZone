# Økonomi-sammenhæng — design (2026-06-21)

> Udvider/opdaterer [`2026-06-17-okonomi-redesign-1441-design.md`](2026-06-17-okonomi-redesign-1441-design.md) med ejer-beslutninger fra 2026-06-21-design-session + integration af tilstødende systemer (fans, omdømme, lande, merchandise, faciliteter), så økonomien bygges som ÉT sammenhængende spil — ikke isolerede features.
> Refs #1441 (epic), #1607 (præmie), #1099/#1112/#844 (omdømme), #1113 (fans), #1149/#930 (faciliteter/staff), #933 (sponsor-økonomi), #934 (landshold).
> **Status:** DESIGN — ejer-godkendte beslutninger A–C + omdømme-forening (2026-06-21). Ingen konstanter ændret her. Simulér-før-ship gælder hele vejen.

## 0. Allerede bygget (vi udvider, starter ikke forfra)
- **Fase 1 anti-inflation SHIPPET** (#1442): upkeep-gold-sink (sæson-start, division-skaleret D1 440k/D2 140k/D3 40k) + sponsor-retune + hård gældsbund (#97) + `moneySupplyScorecard`.
- **Akademi-MVP** (#1308): første gold-sink i drift (5000/plads/sæson, opgraderbart facilitet-niveau). P2W-grænse afgjort (#1142: premium = info/præsentation/convenience, aldrig sportslig fordel).
- **Lande-system Slice 1** (#844): 138 nationer, 3 akser (fødselsrate/talent/omdømme).
- **Net-mål** (fra 2026-06-17): progressiv kurve D1≈0 · D2 +0–20k · D3 +0–30k (anti-snowball).

## 1. Ejer-beslutninger 2026-06-21 (LÅST)
- **A — Mål-net:** ~break-even for et kompetent hold (5-sæsons saldo i 0,8–1,3× start). Behold den progressive kurve (D3 lille +buffer = anti-snowball). Overlevelse = god ledelse, ikke at vinde.
- **B — Sponsor:** fuld forhandlbar. Tilbud = garanteret base + kontraktlængde (1–3 sæsoner) + bløde **AKTIVITETS-mål** (fx fuld kalender/fuld trup), IKKE resultat-bonus. Modbud = senere fase.
- **C — Præmie:** fladere fordeling (komprimér GC-top, vægt mod etapesejre + holdklassement). NIVEAU **kalibreres via harness** til break-even — gættes ikke.
- **Omdømme↔økonomi:** omdømme er **Football-Manager-agtig optjent standing**, IKKE XP/streaks/login (det forblev fjernet, #1139). Det optjenes KUN via sportslig præstation + aktivitet og driver økonomien lovligt.

## 2. To-lags-modellen
### 🔵 Drifts-lag (break-even) — "kan jeg overleve?"
Sponsor = **stadion-indtægt**. Base skaleret af **klub-omdømme** (division + resultat-historik) + **aktivitet** (løbsdage, fuld trup, fuld kalender). Stabil, forudsigelig, **ikke resultat-koblet** (anti-divergens). Upkeep (shippet) = den løbende sink. Sammen → ~break-even ved god ledelse.
### 🟢 Ambitions-lag (vækst) — "hvordan rykker jeg op?"
Præmie (resultater, fladere) → finansierer engangs-**gold-sinks**: facilitet-/staff-opgraderinger (#1149/#930 — akademi, træning, scouting, medicin, commercial, operationer). At vinde lader dig investere; opgraderingerne trækker penge UD (anti-inflation) + gør holdet bedre.

## 3. Omdømme-motoren (FM-model) — doktrin-forening
Doktrinen (2026-06-08) forbød XP/streaks/login-grind-magt. FM-omdømme er optjent sportslig standing → må gerne drive økonomien. Ren split:

| Omdømme-type | Optjenes via | Driver |
|---|---|---|
| **Klub** | resultater, standing, historik | sponsor-interesse + tilbuds-kvalitet (stadion-basen) — **den økonomiske driver** |
| **Rytter** (#1099) | sejre, monuments, GC, titler, landshold | transfer-værdi + løn-krav + fan-tiltrækning |
| **Manager** (#1112) | karriere-resultater | rekrutterings-troværdighed + board-tillid + kosmetisk karrierehistorik (**ikke** direkte kontant/lånekapacitet) |
| **Nation** (#844) | nationens samlede resultater | talent-generering + national identitet |

**Anti-snowball-værn:** (1) omdømme henfalder langsomt uden resultater; (2) det driver sponsor-*adgang/tier* + base-niveau — moderat skalering, ikke runaway-multiplikator; (3) pengemængde-invarianten (kontant-vækst < rytter-værdi-vækst) binder stadig; (4) break-even-mål + fladere præmie + D3-buffer modvirker divergens.

## 4. Tilstødende systemer — hvor de slotter
| System | Issue | Lag | Rolle |
|---|---|---|---|
| Fans (vokser m. resultater + Living-World-feed #1147) | #1113 | 🔵→🟢 | forstærker klub-omdømme → sponsor; senere → merchandise-indtægt |
| Merchandise | #1113, brand-DNA | 🟢/senere | ny indtægt (fans→salg); Fase 4/5, federer af fans + brand |
| Lande/nationalitet (hjemlandsvalg #1108 → board-DNA #1239) | #844, #934 | 🔵 | nation-omdømme → sponsor-præference; national identitet → board-mål |
| Faciliteter/staff | #1149, #930 | 🟢 | de store engangs-gold-sinks præmien betaler for |
| Race-prestige (større løb = større pulje) | LAUNCH_ROADMAP | 🟢 | skalerer præmie-puljen (ambitions-lag) |

## 5. Faseplan
- **Fase 1 ✅ (shippet):** upkeep + sponsor-retune + gældsbund + scorecard (#1442).
- **Fase 2 (næste):** (a) forhandlbare sponsor-kontrakter (base + længde + aktivitets-mål, tier'et af **klub-omdømme-proxy** = division + resultat-historik + løbsdage, indtil fuld renown-motor); (b) fladere præmie-kurve; (c) **harness-kalibrering** af præmie-niveau + sponsor-base til break-even; (d) pengemængde-/inflations-scorecard udvidet.
- **Fase 3:** facilitet/staff gold-sink-opgraderingstræer (#1149/#930); fans-fundament (#1113 — sponsor/moral, ikke revenue endnu); fuld renown-motor (#1099/#1112/#844 Slice 3a→3b).
- **Fase 4:** lande/landshold (#934); merchandise (fans→salg); modbuds-forhandling; gæld-konsekvensmodel (#97 dyb).

## 6. Simulér-før-ship-gates (per [[feedback_simulate_before_ship_balance]])
- `moneySupplyScorecard` (multi-sæson: net-mål pr. division, Gini/divergens, emergency-loan-bound, konservering).
- `prizeDistributionScorecard` (median 5-sæsons saldo i 0,8–1,3× start; ingen division median-net < −30k).
- **Inflations-scorecard** (pengemængde vs mål-kurve) — bygges i Fase 2 (mangler i dag).
- FM-omdømme→sponsor: **divergens-monitor** (Gini må ikke stige efter koblingen aktiveres).

## 7. Åbne ejer-gates (afklares når Fase 2 starter)
- Aktivitets-driver: er "løbsdage + fuld trup + fuld kalender" de rigtige aktivitets-mål for sponsor-basen? (justérbart i harness)
- Klub-omdømme-proxy-formel (Fase 2) → fuld renown-motor (Fase 3) — rækkefølge OK?
- #1108 (manager vælger hjemland) som near-term enabler for nation-identitet + board-DNA national-affinitet (#1239)?
