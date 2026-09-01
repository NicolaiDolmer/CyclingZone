# S-M · Bestyrelses-rework "Mandatet" — MASTER ROADMAP

**Grundlag:** [Spec (GODKENDT 7/8)](../superpowers/specs/2026-08-07-board-mandate-rework-design.md) + [Addendum 1/9](../superpowers/specs/2026-09-01-board-mandate-addendum-personer-med-stemme.md) (A1-A8: personer med stemme, S3-flip, #103-valg C m.fl.). Mockups (genskabt + godkendt 1/9): `docs/design/board-mandate-mockups/`.
**Nordstjerne:** Verdens bedste bestyrelse i et managerspil = den første hvor HVER bevægelse har en kvittering, forhandling er en dialog med modtilbud, og alt kan nås på ≤2 klik.
**Timing (ejer-valg 1/9, afløser 23/8-ankeret):** **Flip i S3 så snart bygget + verificeret.** Datamodellen blev migreret 23/8 (217 hold, bag slukket kill-switch) men er frosset — skyggedata genopbygges og confidence-migrationen re-baselines til flipdagen.

## Status 1/9 (målt)

Fase 1a leveret 17/8 + backfillet 23/8; motoren er UWIRET (ingen live kodesti læser mandat-tabellerne). Fase 0 i gang: #4377-trøjefixet (PR #4549) + #3494-re-point (PR #4550) + genforhandlings-hullet A8 (PR undervejs) afventer merge-go. Fase 2 findes ikke endnu.

## Fase 0 — Korrekthed + arkæologi (start straks, uafhængig af resten)

### S-M0a · Korrekthedspakke
- [#3494](https://github.com/NicolaiDolmer/CyclingZone/issues/3494): sponsor-vækstmål re-pointes til ægte kontrakt-økonomi (`sponsor_contracts`-udbetalinger pr. sæson); `teams.sponsor_income` pensioneres som kilde. Datareparation for aktive planer (ingen straf for det umulige mål — #3095-princippet).
- [#3502](https://github.com/NicolaiDolmer/CyclingZone/issues/3502): cron-state aflæses fra pending-planer i `board_profiles`, ikke window-feltet; forward-guard-test for fuld sæsonskifte-cyklus.
- [#2261](https://github.com/NicolaiDolmer/CyclingZone/issues/2261): high-profile-flag rekalibreres (samme kriterium som star-score, jf. #3141-princippet: ét kriterium, alle flader).
- [#1237](https://github.com/NicolaiDolmer/CyclingZone/issues/1237): økonomikategorien vurderer saldo + bæreevne, ikke rå lån-antal.
- Konsistent målvisning overalt: "Achieved X / target Y" i naturlige enheder (aldrig rå procenter uden kontekst).
- **Verifikation:** hvert fix SQL-verificeres mod prod-population + unit-tests; ingen mocket-only-beviser (husregel).

### S-M0b · Kode-arkæologi + konsolidering (ejer-krav 15/7 i #955, aldrig oprettet — nu issue)
- Kortlæg + merge duplikat-moduler: `boardTestMode`/`boardTestModeService`, `boardWeekendUpdate`/`boardWeekendFinalization`, `boardEngine`(barrel)/`boardEvaluation`.
- Split `BoardPage.jsx` (3.127 linjer) i moduler — REN refactor, nul adfærdsændring, som forberedelse til fase 2.
- Dødt kode: `domestic_dominance`-skelettet fjernes (eller færdiggøres som visions-milepælstype hvis gratis).

## Fase 1 — Mandat-modellen i backend (bag kill-switch, klar før 23/8)

### S-M1a · Datamodel + migration
- Bestyrelsesrelation pr. hold: ét `confidence` + 4 kategoriscorer. Mandat (1-årig, 3-5 mål) + vision (milepæle med mål-sæson).
- Migrations-script: 1yr-mål → mandat; 3/5-års-mål → visions-milepæle (oprindelige slut-sæsoner, grandfathered); confidence = 50/30/20-vægtet snit; snapshot + backup-tabel + kvitterings-event.
- **Dry-run mod HELE populationen** med scorecard (fordeling før/efter, ingen hold der uforskyldt krydser konsekvens-tærskler) — ejer ser scorecardet FØR apply (simulér-før-ship).

### S-M1b · Motor-wiring
- Weekend-opdatering → ét confidence-tal (eksisterende clamp-mekanik genbruges).
- Milepæls-evaluering i mål-sæsonen: engangs-tillidsslag + formandsbeat (ejer-valg #3).
- Tillids-trappe: <30 → 1 justering, 30-74 → 2, ≥75 → 3 + længere modtilbud (tærskler valideres i scorecardet).
- Årsmøde-flow API (proposal/counteroffers/sign) + auto-accept-cron på pending mandater + mid-season check-in låser 1 ekstraordinær samtale op.
- Navnegenerator: medlemsnavne pr. klub-DNA-pulje.

## Fase 2 — Boardroom + årsmødet (UI, flip for ALLE)

### S-M2a · Stemme-fundamentet (NYT 1/9, FØR UI-fladerne)
`boardVoice.js` som eneste beat-modul (addendum: stemme-kontrakten) · persisteret `owner_archetype_key` pr. mål · navne wired atomisk på ALLE læsesteder · nye buckets (receipt/meeting/formands-beats, min. 4 varianter × 9 arketyper, EN+DA i lazy `board`-ns) · afledt stemning pr. medlem.

### S-M2b · Boardroom-siden (T1) — per mockup `Main.dc.html`
Tillidskort m. kvitteringer · mandatkort m. ejer-avatarer + inline expand · visionstidslinje (inkl. A7: tidligt nået milepæl = lukket + nyt slot-forslag ved årsmødet) · bestyrelseskort m. citat + referat-feed i medlemmernes stemmer · **medlems-relations-panel** (`Member.dc.html`, inline expand).

### S-M2c · Årsmødet (fuldskærm) — per mockup `AnnualMeeting.dc.html`
Fokusvalg → mandat → Easier/Keep/Stretch-modtilbud m. medlemsreaktioner → 1 anmodning → underskriv. Hurtigste vej: 2 klik. A7: bestyrelsen foreslår erstatnings-milepæl når et visions-slot står tomt.

### S-M2d · Mobil + integration — per mockup `Mobile.dc.html`
Én kolonne, guld-CTA fuld bredde, lodrette modtilbud · dashboard-bestyrelseskort peger på boardroom · notifikations-/DM-copy opdateres · instrumentering (#1141: dead-clicks, mødegennemførelse, kvitterings-åbninger) · patch notes + help.json (en+da) + Discord-UDKAST til ejeren (ejeren poster selv).

## Launch-sekvens (revideret 1/9)

1. Fase 0-PR'erne (#4549, #4550, A8-låsen) merges når main-smoke er grøn (React 19-PR'en åbner den).
2. Fase 1-rest: wiring + skyggedata-genopbygning + **midt-i-S3 re-baseline** af confidence-migrationen (50/30/20 består; snapshot = flipdagen) → dry-run-scorecard mod hele populationen. **Ejeren ser scorecardet LIVE før apply** (stor destruktiv klasse = ejer-gated).
3. Fase 2-slices bygges bag kill-switchen; hver spillervendt flade vises ejeren som mockup-opdatering FØR bygning ved afvigelser fra de godkendte artboards.
4. Flip for alle (kill-switch = rollback) + patch note + help.json + Discord-udkast. Uge 1 efter: mål succeskriterierne (dead-clicks < 0,2 · 0 nye "forstår ikke tallet"-tråde · kvitterings-brug) og justér.

## Issue-konsolidering

- **Superseded (lukkes):** #955 (fanerne udgår — epicen erstattes af denne plan).
- **Foldes ind (kommenteres, lukkes ved leverance):** #1235, #1240, #1111, #101, #165 (AC3), #2723 (board-visning), #3335, #2022 (stykke B), #3152.
- **Fase 0-selvstændige:** #3494, #3502, #2261, #1237.
- **Forbliver egne spor:** #1099 (fuldt renown-system), #933/#1441 (økonomi-epics → #3501-auditten).
