# 2026-09-25 · Boardroom viste gamle mål: rettelsen fra dagen før krævede et tidsstempel der var tomt på 260 af 262 hold (#5751)

## Symptom
Beta-tester meldte 25/9 morgen at Boardroom stadig viste top-5 "behind" efter forhandling til top-7, selvom patch note 7.298 (PR #5679, #5618) sagde det var rettet. Måling i prod: 36 hold / 53 mål havde andet target i `board_mandates.goals` end på den gamle side (`board_profiles.current_goals`).

## Rod-årsag
`reconcileMandateGoalsWithLegacyBoard` returnerede tidligt når `board_profiles.negotiated_at` var null (`boardMandate.js:520`). Kolonnen var null på 260 af 262 1yr-rækker, fordi routen `POST /board/request` først begyndte at sætte den i PR #5679 selv. Rettelsen dækkede altså kun forhandlinger foretaget EFTER den gik live. PR'ens egen kandidat-SQL filtrerede på samme kolonne og viste derfor 0, hvilket skjulte omfanget.

## Fix
- Kode (PR #5756): i S3 er den gamle 1yr-række forhandlingsfladen og det sæsonafslutningen regner på, så legacy-target vinder for hvert mål med samme identitet når rækken har `negotiation_status = 'completed'`, uafhængigt af tidsstempel. Bonusmål og mål der kun findes i mandatet røres ikke.
- Data: `backend/scripts/resyncMandateGoalsFromLegacy5751.js` (dry-run default, `--apply --owner-go`, backup-tabel, idempotent). Kørt 25/9 kl. 21:40 på ejer-go: 46 mandater / 95 mål, post-verify 0.

## Læring
1. **En rettelse der afhænger af en kolonne skal måles på kolonnens faktiske udfyldning i prod** (`count(*) where col is null`) før den kaldes færdig. Her ville ét SELECT have vist 260/262 null.
2. **Kandidat-SQL i en PR må ikke bruge det felt rettelsen selv indfører** som filter; mål fejlen direkte (her: target-forskel pr. mål-identitet).
3. **Når to rækker skal spejle hinanden, spejl på sandheden, ikke på tidsstempler.** Sæsonafslutningen regner på den gamle række, så den ER sandheden i S3.
4. En done-audit der læser PR-titler overså at PR #5679 dækkede #5633's fund; læs diffen, ikke listen (samme klasse som "go-kort bygges på diffen").
