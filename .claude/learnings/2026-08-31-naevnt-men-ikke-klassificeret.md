# Nævnt er ikke klassificeret: da et regnestykke der gik op skjulte 26 uafklarede tabeller

**Dato:** 31/8 2026 (arbejdet udført natten 30.-31. august, Europe/Copenhagen)
**Issues:** [#4440](https://github.com/NicolaiDolmer/CyclingZone/issues/4440), opfølgning på [#528](https://github.com/NicolaiDolmer/CyclingZone/issues/528) / PR #4439
**Klasse:** dokumentations-fuldstændighed, ikke en kodefejl

## Hvad skete der

PR #4439 klassificerede Supabase-advisorens `rls_enabled_no_policy`-tabeller. Den delte de 101 tabeller i tre buckets: 9 klassificeret enkeltvis, 66 samlet som backup-/snapshot-artefakter, og 26 driftstabeller. De 26 blev **listet ved navn** i dokumentet, med en note om at de ikke var klassificeret.

9 + 66 + 26 = 101. Regnestykket gik op. Dokumentet havde en "Fordeling"-tabel, en "Fund der kræver ejer-go"-sektion der sagde "Ingen", og en afsluttende "Hvad der IKKE er gjort". Det så ud som færdigt arbejde.

Det var det ikke. En fjerdedel af tabellerne stod uden en eneste linje om hvem der tilgår dem. Det tog et selvstændigt issue at opdage.

## Rod-årsag

Der fandtes ingen mekanisk kobling mellem "tabellen er nævnt i dokumentet" og "tabellen er klassificeret i dokumentet". Fuldstændigheden hvilede udelukkende på at en læser talte efter i hånden.

Det er den samme fejlklasse som en kommentar-kun-kontrakt i kode: den holder indtil den ikke gør, og der er intet der siger fra. Faren er ikke at nogen skriver noget forkert, men at et delvist stykke arbejde ligner et helt.

## Fix

De 26 er nu klassificeret enkeltvis i `docs/decisions/rls-no-policy-classification.md` med samme metode som de 9: grep i `frontend/src/` og `backend/` for hver tabel, kategori pr. tabel, og en `fil:linje`-reference for hvem der læser/skriver den. Resultat: nul direkte klient-queries mod nogen af de 26, ingen af dem mangler en policy.

Målingen fandt to ting som gættet ikke ville have fanget:

1. **Grants er ikke ensartede.** Triagen troede `email_log` var den eneste uden `anon`-grant. Målingen viste 7 uden grant, 8 med kun `SELECT`, og 11 med Supabases default `GRANT ALL`. De 11 er ikke et hul i dag (RLS uden policies afviser alt), men de har kun ét virksomt forsvarslag. Det er noteret som et fund der kræver ejerens go, og hører til #2830.
2. **To tabeller tilgås gennem en eksporteret konstant, ikke en literal.** `market_value_level_correction_gate_log` og `market_value_sunday_sweep_log` bruger `.from(LEVEL_CORRECTION_GATE_LOG_TABLE)`. Et rent `grep 'from("<tabel>")'` melder dem som ubrugte. Havde klassificeringen stolet på det grep alene, ville begge være landet i en forkert kategori.

## Forward-guard

`scripts/check-rls-classification-coverage.mjs` (CI-job `rls-classification-guard`, selvtest `check-rls-classification-coverage.test.mjs`, 9 tests) kræver at hver tabel nævnt i dokumentets grant-tabel har sin egen sektion, og at hver sektion indeholder mindst én `fil:linje`-reference eller en eksplicit konstatering af at ingen kodesti rører tabellen. Den tjekker også at bucket-tallene matcher navnene i cellerne, at ingen tabel står i to buckets, og at regnskabet summer.

Vagten er ren dokument-intern konsistens uden DB-adgang, så den koster ingenting og kan køre på enhver PR.

## Læring

Et regnestykke der går op er ikke evidens for at arbejdet er gjort. Når et dokument både **nævner** og **behandler** ting, skal de to lister kobles mekanisk, ellers glider de fra hinanden uden at nogen kan se det. Og når et tal skal måles: mål det. Triagens tal for `email_log` var rigtigt om `email_log` og forkert om mønstret.
