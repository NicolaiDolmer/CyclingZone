# Undersoegelse af #5950: flaget race_day_role_base_day_enabled

Dato: 26/11. Spor: investigate (#5220). Kun laesning, ingen kodeaendring.

## Dom: KLAR (med tjekliste), ikke SLET

Dommen i sporets format: **bekraeftet + fix-plan**. Flaget er bygget, testet og koblet ind, men staar bevidst `off`. To konkrete mangler skal rettes foer taending.

## Hvad koden gor

- Underkontakt til hovedflaget `race_day_role_yield_enabled`. Naar `on`, styrer rytterens rolle ogsaa loebsdagens basis-dag, ikke kun hvor tillaegget lander. Kaptajn/jaeger uaendret, hjaelper faar basis-dagen i hjaelpe-evnerne og udvikler ikke etapens afgorende evne, fri rolle faar et gennemsnit. Samme samlede udbytte for alle roller, maks +1 pr. evne pr. loebsdag uaendret.
- Kode: `backend/lib/raceDayRoleYield5950.js` (noegle, `isRaceDayRoleBaseDayEnabled`, `raceDayRoleBaseProgram`, `raceDayRoleAbilityGroups` med `roleDrivesBaseDay`). Koblet ind i XP-motoren via `backend/lib/developmentXpFlag.ts` (`withRaceDayRoleYieldXp`). Registreret i `featureStage.js`, `stageFlagCatalog.js`, `FEATURE_REGISTRY.yml` (state dormant), `TRAINING_RULES.md`, `PROGRESSION_RULES.md`. Migration: `database/2026-11-03-5950-role-base-day-flag.sql`.
- Fallback: `beta` taeller som off; flag laeses kun naar hovedflaget er on og params er gyldige; off er bit-identisk med hovedflagets model.

## Testet?

Ja. `node --test lib/raceDayRoleYield5950.test.js lib/raceDayRoleYield7584.test.js` koert i dag: 62 af 62 bestaar. Dakker bl.a. underkontakt on/beta/off, intet opslag uden hovedflag eller params, +1-lofte, Score B. Ogsaa dommerproever (`dommer6110.loebsdag-passer.test.js`, `developmentXpWiring.test.js`).

## Tændt i prod?

Nej. Read-only SELECT paa `app_config` (26/11): `race_day_role_base_day_enabled` = `off` (sidst aendret 3/11, oprettelsen). Hovedflaget `race_day_role_yield_enabled` = `on` (tændt 1/11, ejer-go).

## Hvad mangler for at taende (tjekliste)

1. **Ret hjaelper-evnerne** (`HELPER_ABILITIES_BY_PROFILE`): `tempo` staar stadig i hjaelper-listen for flat, rolling, hilly, mountain, high_mountain, itt, itt_hilly og ttt. Ejer 4/11 og 20/11: tempo er til mellemlange stigninger, ikke til at fore feltet. Rettelsen er ikke lavet (bekraeftet i koden).
2. Genmaal alle 21 grupper (junior/U23/senior x 7 roller) under XP pr. tick mod det private baand. Maalingen 4/11 viste to brud: ca. hver fjerde hjaelper-loebsdag under en haard dag, og hjaelpere ca. 10 % over kaptajner.
3. XP-motoren skal have koert mindst en dag, og ejeren giver "kor" paa et taendingskort. Ejer-only flip, aldrig autonomt.
4. Fable-dommer (motor/traening) foer tænding, hjaelp- og patch-note-opdatering ved tænding.
5. Variant B (ordren styrer evnerne) er separat spor, ejer 20/11: A nu, B bagefter. B kan gøre A overflødig; aftal at A ikke slettes foer B er besluttet.

## Hvad koster det at slette (ikke anbefalet)

Filer: `backend/lib/raceDayRoleYield5950.js` (underkontakt-grenene, `roleDrivesBaseDay`), `developmentXpFlag.ts` (parameteren), `featureStage.js`, `stageFlagCatalog.js`, `trainNowSameResult7982.harness.js`, `raceDayRoleYield5950.test.js`, `raceDayRoleYield7584.test.js`, fixtures, `FEATURE_REGISTRY.yml`, `FEATURE_STATUS.md` (genereret), `TRAINING_RULES.md`, `PROGRESSION_RULES.md`, migrationen samt en rakke i `app_config` (ejer-gated, arkiv foerst, rule 38). Cirka 10 filer; strider mod ejerens gentagne beslutning (3/11, 20/11) om at rollen skal indfores.

## Fix-plan

1. Lille PR: ret `HELPER_ABILITIES_BY_PROFILE` (fjern tempo hvor ejeren har underkendt det), opdater tests/dommerfil. Risiko lav, flag off giver bit-identisk adfaerd.
2. Maal 21 grupper pr. tick privat (balance-internals/5950), ingen tal i repoet.
3. Taendingskort til ejeren efter minimum en XP-dag; ejeren siger "kor".

## Bevis

- Prod-laesning: `app_config` = off (se ovenfor).
- Testkoersel: 62 pass, 0 fail.
- Kode: tempo i hjaelper-listen, `raceDayRoleYield5950.js` linje 92-104.
- Issue #5950, kommentarer 3/11, 4/11, 20/11.
