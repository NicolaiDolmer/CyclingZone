# Board-onboarding var hardcoded til "alle starter i sæson 1"

**Dato:** 2026-06-30
**Issue/PR:** #2022 / PR #2025 (fase 1)
**Type:** arkitektur-antagelse der ikke var langtidsholdbar (fundet via ejer-spørgsmål)

## Symptom
Et nyt holds bestyrelse dannedes ufuldstændigt: ukalibrerede mål + intet
`season_1_identity_basis` → permanent låst ude af DNA-valg (hard 409 i
`chooseDnaForTeam`). For en nykommer i **sæson 2+** ville det aldrig selv-reparere.

## Rod-årsag
Board-onboarding var bygget som en **engangs-relaunch-mekanik**, ikke en
tilbagevendende. `season_1_identity_basis` blev kun skrevet af
`startSequentialNegotiation`, gated på `currentSeasonNumber === 1`
(`economyEngine.js:954`). DNA-valg + sekventiel forhandling gates desuden på en
**global** `transfer_windows.board_negotiation_state`, ikke per-hold. Antagelsen
"alle managers starter i sæson 1" var kodet ind i kolonnenavnet, trigger-
betingelsen og en global state-maskine — den holder ikke for en levende liga hvor
managers kommer til løbende.

## Fix (fase 1)
`ensureSeasonIdentityBasis` skriver grundlaget fra start-truppen **ved dannelse**,
uanset global sæson (idempotent + ikke-fatal). DNA-gaten var allerede betinget af
grundlaget (ikke en sæson-tæller), så den passerer nu automatisk for nykommere.

## Lære (forward-guard)
Onboarding-state der skal gælde **nye entities løbende** skal bindes til
entityens EGEN livscyklus (sættes ved dannelse), ikke en global engangs-
sæson-overgang. Når en feature skal være langtidsholdbar i en kontinuerlig
liga: søg efter hardcoded sæson-1 / `=== 1` / global-window-state-antagelser, og
spørg "hvad sker for en der joiner i sæson N?". Empirisk verificering mod prod
(38/63 ægte hold sad allerede fast) afslørede omfanget — ikke en hypotese.
Relaterer [[feedback_read_existing_plans_before_building]] +
[[feedback_match_ui_filter_for_capacity_logic]].
