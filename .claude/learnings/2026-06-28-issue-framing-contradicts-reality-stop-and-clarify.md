# Når et issues framing modsiger virkeligheden → STOP og afklar (ikke bred fjernelse)

**Dato:** 2026-06-28
**Issue:** #1948 (lån-knap) → forkert bred fix #1955 → revert + korrekt fix #1957

## Hvad skete der
#1948 sagde "lån-knap synlig for spillere skal fjernes (ikke-funktionel + misbrugsrisiko)". Audit + jeg eksekverede det bogstaveligt og fjernede HELE "Optag lån"-funktionen (kort + langt lån) + deaktiverede endpointet. Det var forkert: kort/langt er en legitim feature ejeren ville beholde. Resultat: revert + churn + ejer-frustration ("det gik ikke godt").

## Rod-årsagen (som jeg burde have fundet FØR jeg fjernede noget)
`loan_config` har en `reset`-type (0% gebyr/rente, loft 2.000.000) i alle divisioner — brugt til de rentefrie lån der manuelt blev givet til minus-spillere efter præmie-fjernelsen. "Optag lån"-formen filtrerede kun `emergency` fra, så dropdownen viste også `reset`. Backend afviste `reset` (kun short/long) → "knappen virker ikke". Den korrekte fix var smal: skjul `reset`/`emergency` fra UI; behold short/long + de eksisterende reset-lån.

## Rød-flag-signalet jeg missede
Issue-teksten ("knappen virker ikke") MODSAGDE det den adversarielle verify-agent fandt ("formen virker, 5 hold har brugt den"). Den modsigelse var et STOP-signal: når et issues beskrivelse ikke matcher kode/data, er scope'et uklart → afklar med ejeren FØR en destruktiv/bred ændring. I stedet rationaliserede jeg modsigelsen væk og fjernede for meget.

## Forward-guard (regel)
- Når issue-framing ≠ kode/data-virkelighed (fx "ikke-funktionel" men den virker, eller "fjern X" men X er en legit feature): **STOP, vis ejeren modsigelsen, og spørg om det præcise mål** før du fjerner/ændrer bredt.
- Foretræk den **smalleste** ændring der løser den faktiske klage. Ved "fjern en knap/option": find ud af PRÆCIS hvilken option (her: kun den ene `reset`-type i en dropdown med 3), ikke hele fladen.
- Verificér mod faktiske data (her: `loan_config`-typer) FØR du konkluderer hvad der skal væk — ikke kun issue-teksten.

Relateret: [[feedback_read_existing_plans_before_building]], [[feedback_runtime_verify_first]], [[feedback_ask_questions_domain_calibration]], [[feedback_owner_reviews_live_before_destructive_ops]].
