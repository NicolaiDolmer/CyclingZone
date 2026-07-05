# Langsigtet økonomi Fase 3 — "Byg dit imperium" (faciliteter/staff, kontrakt-livscyklus, op/nedryknings-økonomi, legibility)

> Design-doc · 2026-07-05 · ejer-godkendt i brainstorm-session samme dag.
> Bygger på det låste to-lags-design [`2026-06-21-economy-coherence-design.md`](2026-06-21-economy-coherence-design.md) (drifts-lag break-even ✅ / ambitions-lag) og [`2026-06-17-okonomi-redesign-1441-design.md`](2026-06-17-okonomi-redesign-1441-design.md).
> Refs: [#1441](https://github.com/NicolaiDolmer/CyclingZone/issues/1441) (epic) · [#1149](https://github.com/NicolaiDolmer/CyclingZone/issues/1149)/[#930](https://github.com/NicolaiDolmer/CyclingZone/issues/930) (faciliteter/staff) · [#1310](https://github.com/NicolaiDolmer/CyclingZone/issues/1310) (kontrakt-pakke) · [#1677](https://github.com/NicolaiDolmer/CyclingZone/issues/1677) (frigiv rytter) · [#1980](https://github.com/NicolaiDolmer/CyclingZone/issues/1980) (op/nedryknings-økonomi) · [#986](https://github.com/NicolaiDolmer/CyclingZone/issues/986) (økonomiside-rework) · [#1142](https://github.com/NicolaiDolmer/CyclingZone/issues/1142) (P2W-grænse) · [#1099](https://github.com/NicolaiDolmer/CyclingZone/issues/1099) (rytter-omdømme).
> **Status:** DESIGN — ejer-godkendt 2026-07-05. Simulér-før-ship gælder hele vejen (ingen konstanter shippes uden harness-bevis).

## 0. Research-grundlag + problem

Research-syntese (game-economy-litteratur + Rise of Industry-postmortem + mobile-economy-praksis) holdt op mod live-koden. Fundamentet er stærkt: Fase 1 (upkeep-sink, præmie ÷20, hårdt gældsloft m. tvangssalg) og Fase 2 (renown-skaleret sponsor + forhandlbare kontrakter, harness-kalibreret W_RESULTS=0,45 / MAX_MULTIPLIER=1,40 med faldende Gini) er shippet, og simulerings-disciplinen (`moneySupplyScorecard`, `prizeDistributionScorecard`, `economyCalibrationSweep`) er på plads.

De verificerede gaps, som Fase 3 lukker:

| Research-princip | Status i dag |
|---|---|
| **"Infinite wallet"** — meningsfuld brug af overskud | ❌ Ambitions-laget har indtægt (præmier) men INGEN sinks. Veldrevet hold → hamstring → disengagement. Det brændende hul. |
| **Optimal-path-problemet** — flere gyldige strategier | ❌ Skal designes ind fra dag 1 i facilitets-systemet (ikke lineær upgrade-liste). |
| **Feedback-loop/klarhed** — "spillere der ikke forstår hvorfor de taber penge, quitter" | ⚠️ #986: intet forecast, ingen flaskehals-indikator; sæsonstart trækker løn+upkeep+renter i ét usynligt slag. |
| **Tid-som-valuta** — alt prissat i tid-at-tjene | ⚠️ Findes ikke som designdisciplin; indføres her (§2.4). |
| **Løbende spændings-fornyelse** | ❌ Løn frossen for evigt ved signering → langtidshold har færre og færre svære valg. |
| **Op/nedryknings-økonomi** | ⚠️ Nedrykker fra D1 (440k upkeep / 600k+ sponsor) lander hårdt på D2-vilkår m. D1-lønbudget → dødsspiral-risiko. |
| Taps/sinks-balance, én valuta, tillid til værdi | ✅ Løst i Fase 1–2; må ikke regressere. |

## 1. Ejer-beslutninger 2026-07-05 (LÅST)

| # | Beslutning |
|---|---|
| **Prioritet** | Faciliteter/staff først (Slice A); legibility + faldskærm derefter. |
| **Facilitets-dybde** | **Fuldt træ + navngivet staff** i første version (5 spor × 5 tiers + 1 ansættelig chef pr. spor). |
| **Kontrakter** | **Fuld livscyklus**: udløb efter 1–3 sæsoner + genforhandling til aktuel markedsværdi-baseret løn. |
| **Faldskærm** | **Ja, 1 sæson**: nedrykker beholder 50% af sponsor-base-forskellen i 1 sæson (konstant kalibreres i harness). |

## 2. Slice A — Faciliteter + staff (det store gold-sink, flagskibet)

### 2.1 Facilitets-spor (5 spor × 5 tiers)

| Spor | Effekt | Note |
|---|---|---|
| **Træningscenter** | Træningseffekt-bonus (multiplikator på eksisterende trænings-motor) | Skal respektere akademi-rekalibreringens caps (#2082/#1938: sæson-budget-cap + daglig +1-cap) — bonussen udvider IKKE hårde caps, den forbedrer udnyttelse under dem. |
| **Scouting-netværk** | Bedre info om ryttere/ungdoms-intake (attribut-synlighed, potentiale-estimater) | Info-fordel købt for in-game CZ$ er OK; #1142-P2W-grænsen gælder KUN rigtige penge (premium = info/convenience, aldrig sportslig fordel). Kobler til rytterprofil-rework'ets scouting-fane (#2000-rest). |
| **Medicinsk afdeling** | Hurtigere form-genopretning; lavere skadesrisiko når skades-systemet lander | Effekt-krog defineres nu, aktiveres i takt med form/skade-motoren. |
| **Akademi-udvidelse** | Flere akademi-slots (ud over 8) + bedre intake-kvalitet | Bygger på #1308; drift pr. slot (5k) fortsætter og skalerer sinket naturligt. |
| **Kommerciel afdeling** | Lille sponsor-multiplikator, hårdt loftet | **Anti-runaway-invariant:** kalibreret så tilbagebetalingstid ≥ ~4 sæsoner ved fuldt udbygget — aldrig selvfinansierende hurtigere. Forbereder merchandise-krogen (#1113, Fase 4) uden at bygge den. |

- Hver tier: engangs-pris (gold-sink) + løbende tier-upkeep (mindre, løbende sink).
- **Nedgradering:** ikke muligt (investering er committed) — men tier-upkeep er kalibreret lavt nok til at det aldrig vælter et hold alene (fanges af §5-gates).

### 2.2 Navngivet staff (1 chef pr. spor)

- 5 roller: sportsdirektør (træning), chefscout, læge, akademichef, kommerciel direktør.
- Hver kandidat har **kvalitets-tier (1–5) + sæsonløn** (løbende sink, betales i sæsonstart-payroll som nyt idempotent debit-step, samme mønster som upkeep/academy-drift i `processSeasonStart`).
- **Facilitet = kapacitet, staff = udnyttelsesgrad:** effektiv bonus = f(facilitets-tier, staff-tier) — begge kræves for fuld effekt; giver to adskilte beslutninger og to sinks.
- Staff-tier gated af facilitets-tier (kan ikke ansætte tier-5-chef til tier-1-facilitet) — forhindrer at staff alene bliver en genvej.
- Kandidat-generering fra kurateret navne-pulje (samme disciplin som sponsor-navnene: fiktive, anti-AI-slop, ingen ægte personer). Ansæt/fyr: fyring koster resterende sæsonløn (sink + friktion).
- Slice A-staff er **økonomi + multiplikator**; dyb staff-personlighed/udvikling (#930 fuld vision) er senere fase.

### 2.3 Anti-optimal-path (merge-gate)

Ingen facilitet må dominere: harness-sweep skal vise **mindst 3 forskellige investerings-rækkefølger konkurrencedygtige inden for ±10% langsigtet holdstyrke-proxy** (for den staff-INKLUDERENDE model justeret til **±15%**, ejer-valg 2026-07-05 — så staff-specialisering kan være en reel strategisk løftestang med robuste marginer; se `docs/audits/2026-07-05-staff-richness-a4-calibration.md`). Er én rækkefølge dominant → rekalibrér effekter/priser før ship. Dette er en hård gate på linje med fresh-gaten.

### 2.4 Tid-som-valuta (ny designdisciplin → GAME_INVARIANTS.md)

Hver tier prissættes i **"sæsoner af divisions-niveau-overskud"**, ikke i gættede kroner:
- Tier 1 ≈ 0,5 sæsons D3-overskud · Tier 3 ≈ 1 sæsons D2-overskud · Tier 5 ≈ 2+ sæsoners D1-overskud.
- Harness oversætter målene til CZ$-konstanter mod de kalibrerede net-tal (D1 +3,6k / D2 +13,6k / D3 +8,6k fresh; modent felt fra `prizeDistributionScorecard`). Reglen skrives ind i `GAME_INVARIANTS.md` og gælder ALLE fremtidige økonomi-priser.

### 2.5 Upkeep-integration

Flad division-upkeep (440/140/40/0k) **beholdes uændret i Slice A**; facilitets-tier-upkeep lægges oveni som separat finance-type. Migrering til én samlet tier-baseret ladder (17/6-designets §3.1-vision) besluttes først på live-data efter Slice A — ingen dobbelt-ændring af kalibrerede konstanter i samme slice.

### 2.6 Datamodel (migrationer → ejer merger)

- `team_facilities` (team_id, track, tier, purchased_season, …) + `team_staff` (team_id, role, name, tier, salary, hired_season, status).
- Nye `finance_transactions`-typer: `facility_purchase`, `facility_upkeep`, `staff_salary`, `staff_severance` (CHECK-constraint-migration som i Fase 1).
- RLS: authenticated SELECT på egne rækker (player-events-mønsteret); skrivning backend-only.
- Alle debits via ledger (`incrementBalanceWithAudit`) — konserverings-invarianten (§6.6 i 17/6-designet) brydes aldrig.

### 2.7 UI

Ny "Klub"-flade (faciliteter-oversigt m. tiers, priser i CZ$ + "≈ X sæsoners overskud", staff-panel m. kandidater). Editorial design-linje (anti-AI-slop-memory: ingen rounded-2xl/glow/emoji-ikoner; Bebas + ægte cykel-data-æstetik). EN først, DA under. Preview med seed-data så ejer kan klikke igennem FØR merge (ejer-krav 25/6).

## 3. Slice B — Kontrakt-livscyklus (#1310 + #1677)

- Kontrakter (felterne `contract_length` 1–3 + `contract_end_season` findes allerede) begynder at **udløbe**.
- **Genforhandling ved udløb:** ny løn = `market_value × SALARY_RATE` på forhandlings-tidspunktet, moduleret af rytter-omdømme (#1099-krog; proxy indtil fuld renown-motor) + længde-valg (kort = billigere pr. sæson, lang = sikkerhed mod fremtidig stigning). Stjerner der er vokset bliver dyrere at holde → naturligt lønpres = sink der skalerer med succes (anti-snowball).
- **Ikke fornyet →** fri agent → eksisterende auktions-flow (genbrug, ingen ny mekanik).
- **Frigivelse midt i kontrakt (#1677):** betal resterende kontrakt-løn × fratrædelses-faktor (sink + fair friktion; faktor kalibreres).
- **Arv ved handel uændret** (GAME_INVARIANTS: kontrakt overtages som-er) — livscyklussen ændrer kun hvad der sker ved UDLØB.
- **Legibility fra dag 1:** udløbs-varsler i indbakken (sæson N: "3 kontrakter udløber efter denne sæson") + kontrakt-kolonne (løn, rest-længde) på trup-siden. Research-reglen: intet nyt pres uden synligt feedback-loop.
- **Harness-gate:** 5-sæsons lønpres-projektion; fresh-gate + Gini-gates må ikke regressere; modent D1-hold skal opleve reelt keep/sell-pres (målsætning: top-3-ryttere koster mærkbart mere at forny) uden at breake break-even-båndet for kompetent drift.

## 4. Slice C — Op/nedryknings-økonomi (#1980) + legibility (#986)

### 4.1 Faldskærm + oprykningsøkonomi
- **Faldskærm:** nedrykker krediteres `PARACHUTE_FACTOR × (sponsor_base[gammel div] − sponsor_base[ny div])` i 1 sæson. Start-kandidat `PARACHUTE_FACTOR = 0.5`; kalibreres. Egen finance-type (`parachute`), idempotent pr. sæson+hold.
- **Oprykning er en investering:** oprykker møder højere upkeep med det samme; den eksisterende division-bonus + højere sponsor-base er opsiden. Harness verificerer at en oprykker med gennemsnits-trup overlever sæson 1 i ny division uden nødlåns-spiral (ny gate).

### 4.2 Økonomiside-rework (#986)
1. **Sæson-forecast:** projekteret sponsor + forventet præmie (fra kalender + historik) − løn − upkeep − staff − renter. Al data findes i `finance_transactions` + kontrakter.
2. **Flaskehals-indikator:** fx "lønbyrde = 78% af projekteret indtægt — anbefalet ≤ 65%" (tærskler fra harness-data, ikke gæt).
3. **Sæson-historik-graf** (indtægt/udgift pr. kategori pr. sæson).
4. **Sæsonstart-opgørelse i indbakken:** det "usynlige slag" (løn+upkeep+renter+staff) vises som samlet, posteret opgørelse.
- Frontend-tal SKAL læse fra backend/delte SSOT-konstanter (co-SSOT-fælden fra 17/6 §4.1: `expectedPrizeCalculator`, `marketValues` synkes i samme PR'er).

## 5. Simulér-før-ship-gates (obligatoriske, pr. slice)

| Gate | Krav |
|---|---|
| Fresh-gate | `moneySupplyScorecard --synthetic-only` uændret grøn (D1 +3,6k / D2 +13,6k / D3 +8,6k ±bånd). |
| Gini/divergens | Må ikke stige (renown-kalibreringens metode genbruges). |
| **NY: `facilityInvestmentScorecard`** | Anti-optimal-path-sweep (§2.3) + tilbagebetalingstids-check (kommerciel ≥ ~4 sæsoner) + tid-som-valuta-priser (§2.4). |
| **NY: lønpres-projektion** (Slice B) | 5-sæsons kontraktcyklus-sim: kompetent drift forbliver i break-even-båndet; top-tunge hold mærker reelt pres. |
| **NY: nedryknings-gate** (Slice C) | Gennemsnits-nedrykker m. faldskærm undgår nødlåns-spiral; uden faldskærm-regression af eksisterende gates. |
| Inflations-scorecard | Fase 2-restancen (coherence-design §6) bygges i Slice A-bølge 2: pengemængde vs. mål-kurve, så alle nye flows overvåges fra fødslen. |

**Succeskriterier (målbare):** (1) median D1-hold i sæson 5 har < 1,5 sæsons overskud stående ubrugt; (2) ≥ 3 konkurrencedygtige investeringsstrategier i sweep; (3) alle eksisterende gates grønne; (4) hver ny konstant har harness-bevis før merge.

## 6. Rækkefølge + mekaniske rammer

1. **Slice A** i 3 PR-bølger: (A1) datamodel + backend-motor + finance-typer → (A2) harness (`facilityInvestmentScorecard` + inflations-scorecard) + kalibrering → (A3) UI ("Klub"-flade). Migrationer = ejer-merge-only.
2. **Slice B** (kontrakt-livscyklus) — efter A2 (harness-udvidelsen genbruges).
3. **Slice C** — faldskærm er lille (kan lande tidligt hvis nedrykning nærmer sig live); legibility kan køre parallelt med B.
4. Tværgående pr. slice: patch notes + help/FAQ (en+da) · GAME_INVARIANTS.md-opdatering · frontend co-SSOT-sync · preview-test-data til ejer-gennemklik.

## 7. Bevidste fravalg

- **Ingen ny valuta** — én valuta (CZ$) er en styrke; kompleksitet dræber forståelse (research-konsensus).
- **Ingen transfer-skat** (ejer-fravalg 17/6; overvåges fortsat i scorecard).
- **Merchandise/fans-indtægt (#1113) = Fase 4** — kommerciel afdeling forbereder kun krogen.
- **Ingen ændring af kalibrerede Fase 1/2-konstanter** uden ny harness-kørsel.
- **Ingen premium/real-money-kobling** — #1142-grænsen står: premium er info/præsentation/convenience, aldrig sportslig fordel.

## 8. Åbne spørgsmål (afklares i implementeringsplan, ikke blockers)

- Effekt-formlen f(facilitets-tier, staff-tier) — multiplikativ vs. min-gated; vælges m. harness.
- Staff-kandidat-refresh-kadence (pr. sæson? løbende pulje?).
- Medicinsk afdelings effekt-krog før skade-systemet findes (form-genopretning alene i v1?).
- Kontrakt-udløbs-UX ved mange samtidige udløb (relaunch-populationen har ens kontraktlængder → bølge-udløb; evt. stagger ved seed).
- Faldskærm vs. D4-aktivering (pool-tree: D4 upkeep = 0 → faldskærm irrelevant der; gælder kun D1→D2, D2→D3).
