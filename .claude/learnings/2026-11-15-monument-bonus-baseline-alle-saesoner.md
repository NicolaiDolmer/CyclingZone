# Postmortem · 2026-11-15 · Monument-bonusmålets udgangstal talte alle sæsoner

## Hvad skete der?
Fem hold havde et aktivt monument-bonusmål, der stod på 0, selv om tre af dem havde podier i sæsonen. En spiller meldte det i Discord 14/11 (#8188).

## Root cause
`computeBonusGoalBaseline` (`backend/lib/boardBonusGoal.js`) kaldte `loadGoalContext` uden plan-cyklussens startsæson, så cyklusfilteret i `boardGoalContext.js` blev sprunget over, og udgangstallet (baseline) talte podier fra alle sæsoner. Visning og evaluering brugte det rigtige vindue, så fremdrift = sæsonens podier minus en for høj baseline. Samme klasse som #4377: rettelsen dengang nåede ikke baseline-stien.

## Fix
- Kode: PR #8193 (`696e8ef3a`), baseline bruger samme plan-cyklusvindue som evalueringen.
- Data: `scripts/ops/8188-baseline-repair.sql` kørt 15/11 efter ejerens "kør": 10 rækker (5 hold, mandat + profilens spejling), før-værdier i `backup_8188_bonus_baseline` (RLS til, kun service_role).

## Forhindret-fremover
- Regressionsprøve `boardBonusGoal.baseline8188.test.js`, hvor plan-start er forskellig fra fallback, og hvor fake'n kun returnerer de valgte kolonner (en tilbagerulning af select'en fanges).
- Åben opfølgning: weekend- og sæsonslut-evalueringen sender plan-start uden fallback, mens baseline falder tilbage til aktiv sæson. Ingen hold har plan-start NULL i dag.

## Læring
- Når et vindue rettes ét sted (#4377), så søg alle kaldere af den samme loader; den ene sti uden parameteren er den næste fejl.
- Et reparations-script skal prøves som ren SELECT mod prod, før nogen dømmer det: første udgave ville også have rettet fem bonusmål fra tidligere sæsoner og kunne hæve en baseline. Reglen blev: kun sænke, kun match på tilbuds-id, kun den aktive sæsons mandat.
- En backup-tabel oprettet af et ops-script i `scripts/ops` fanges ikke af grants-auditten (den ser kun `database/`). Luk den selv (RLS + REVOKE) før INSERT.
