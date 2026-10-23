# 2026-10-22: AI-pensionering blokeret af ungdomserstatning (#7039)

**Symptom:** `league-size-invariant` rød på alle PR'er fra 22/10 14:57 UTC. D4 A/B/D = 25, C = 26. Sentry CYCLINGZONE-8R: "ai-trim heal sweep: 5 hold fejlede — no_safe_youth_replacement".

**Rod-årsag:** #4753 krævede, at et pensioneret AI-holds ungdomspladser overtages af et *ledigt* AI-hold (ingen gruppe, ≥6 U23 + ≥6 junior akademiryttere). Efter S4 sidder alle AI-hold i en ungdomsgruppe, så reserven fandtes aldrig. Kontrakten var fail-closed (`RAISE`), og `retireAiTeam` fanger ikke fejlen. Konsekvensen ville have ramt "Afslut sæson" søndag (AI-fyld-sweepen efter op/nedrykning).

**Hvorfor det først blev synligt nu:** markørerne fra 19-20/10 var tolereret som "waiting" (S4-løb i gang). Da deres sidste løb var afviklet (`ai_team_retirement_reason` = null), faldt de ud af grace, og auditten talte dem.

**Rettelse:** data (backup + nulstil ungdoms-FK for de 5 → trim-sweepen fjernede dem), migration `2026-10-22-7039-youth-retire-vacate-fallback.sql` (vacate i stedet for RAISE), audit melder korte ungdomsgrupper som advarsel, YOUTH_RULES §2.3 opdateret.

**Lære:**
1. En fail-closed invariant på et *sekundært* hensyn (ungdomsgruppens fyld) må aldrig kunne blokere et *primært* flow (seniorliga, sæsonskifte). Spørg ved design: "hvad sker der, når forudsætningen aldrig findes i prod?"
2. En rød required check, der måler prod, er et prod-signal, ikke en PR-fejl. Undersøg prod før PR'en.
3. Når auditten læser fra main (`workflow_sha`), kan en PR, der retter auditten selv, kun merges forbi checket. Det kræver ejer-go og skal stå i PR'en.
