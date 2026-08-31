# Fair play-detektoren så ingen direkte handler overhovedet (#3818)

**Dato:** 31/8 2026 · **Issue:** #3818 · **Filer:** `backend/lib/fairplayFlagsCron.js`, `backend/lib/fairplayScoring.js`

## Symptom

Issuet fra 17/8 lød: "3 ensrettede handler mellem samme to hold, inkl. 71x overbetaling, detektoren gav nul flag."
Tre hypoteser blev fremsat og alle tre var forkerte:

1. "`price_band_outlier` er ensidigt kalibreret mod lave priser" — falsk, funktionen er tosidet (linje 103-110).
2. "Parret har ingen identitets-signaler" — falsk, parret bærer både `first_seen_at_match` og `ip_exact_low_fanout`.
3. "Vægtningen er den eneste fejl" — delvist sandt, men ikke rodårsagen.

## Rodårsag

`normalizeTransactions` læste sælger og rytter gennem joinet `listing:listing_id(...)`.
`transfer_listings`-rækken **slettes når handlen gennemføres**. Målt mod prod 30/8 2026:

```
accepted_90d = 141 · with_listing = 0 · listing_deleted = 141
```

Alle 141 accepterede direkte handler i vinduet gav `seller === undefined` og blev sprunget over med
`continue`. Detektoren har altså kun nogensinde set auktioner og bytter. 71x-handlen var en direkte
handel og eksisterede simpelthen ikke i detektorens datagrundlag.

Konsekvensen var målbar: parret Nickstar Rockets / The Wheelbarrels stod med `n_transactions: 1` og
en nettostrøm på 64.194 i `fairplay_flags`. Den faktiske virkelighed er 12 handler og 505.507.

## Fix

`transfer_offers` har sine egne denormaliserede kolonner `seller_team_id` og `rider_id` (populeret på
141 af 141 rækker). De læses nu direkte, med listing-joinet bevaret som fallback for gamle rækker.

Derudover to ting fra issuets egen opgaveliste:

- **Retnings-signal** (`directional_value_flow`, vægt 0,6): N handler samme vej inden for 30 dage,
  med fan-out-guard, dags-guard og ensretnings-guard. Se `computeDirectionalStrength`.
- **Multiplikator-gulv**: beløbet gater stadig, men rangerer ikke længere alene. Se `valueMultiplier`.

## Læring

**Et join er en tavs `WHERE`.** `normalizeTransactions` fejlede ikke, loggede ikke og kastede ikke.
Den talte bare til nul. En detektor der aldrig har set en hel datakanal ser ud præcis som en detektor
der ikke finder noget.

**Mål datagrundlaget, ikke kun logikken.** Tre runder triage kiggede på vægte og tærskler i
scoringsfunktionen. Det ene `select count(*)` der ville have afsløret sagen tog under et minut.
Ved "detektoren fangede det ikke": tæl først hvor mange rækker detektoren overhovedet ser, og
sammenlign med hvor mange der findes.

**Livscyklus-tabeller er ikke stabile joins.** Rækker der beskriver en *igangværende* tilstand
(`transfer_listings`, kurve, aktive sessioner) forsvinder ved afslutning. Analyse bagud i tid skal
læse fra den række der *overlever* begivenheden.
