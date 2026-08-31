# High Roller-tærsklen drev fra sin copy (#4414)

**Dato:** 31/8 2026 · **Type:** bugfix + forward-guard · **Filer:** `backend/lib/achievementEngine.js`, `backend/lib/achievementCopyContract.test.js`

## Symptom

En spiller skrev i Discord #bugs (29/8) at han havde købt flere ryttere for over
500.000 CZ$ uden at få achievementen **High Roller**. Copy'en i
`frontend/public/locales/{en,da}/achievements.json` lover netop et bud over
500.000 CZ$.

## Rod-årsag

`achievementEngine.js` krævede `toNumber(bid.amount) > 2000000000` — en faktor
4.000 for højt. Tallet har været forkert siden achievement-motoren blev indført
(ba2d2926, 25/7); det er ikke en regression fra en senere ændring.

Målt mod prod 30/8: 7.288 bud i alt, højeste bud nogensinde 1.087.224 CZ$, 59
bud over 500.000, nul over 2 mia. `manager_achievements` bekræftede det:
`auction_high_roller` havde 0 tildelinger, mens `auction_first_bid` havde 151 og
`auction_sniper` 97. Achievementen var ikke svær, den var umulig.

Den dybere årsag er ikke tastefejlen, men at tallet levede to steder: som en
hårdkodet literal i motoren og som tekst i copy'en, uden noget der bandt dem
sammen. Det er tredje gang samme klasse rammer:

- **#1205** — `transfer_bargain` og `team_star` målte CZ$ mod rå `uci_points` og
  var reelt døde efter 4000x-skaleringen.
- **#2917** — 13 sæson-achievements var defineret og synlige for spilleren, men
  ingen kode kunne tildele dem.
- **#4414** — denne.

## Fix

1. Tærsklen er nu konstanten `HIGH_ROLLER_BID_THRESHOLD = 500_000`.
2. De øvrige player-facing tal er trukket ud som navngivne konstanter
   (`NEGOTIATOR_MIN_ROUNDS`, `YOUTH_U25_SHARE`, `WATCHLIST_SCOUT_TARGET`,
   `BOARD_SATISFACTION_TARGET`, `TRANSFER_SIDE_TARGET`, `TROPHY_CASE_TARGET`) og
   deles nu mellem `unlock()`-kaldene og `SINGLE_PROGRESS`, som før havde de
   samme tal skrevet to gange.
3. Backfill kræver ingen datareparation: `checkAchievements` indlæser
   eksisterende unlocks og `unlock()` springer allerede tildelte over, så
   `POST /api/achievements/check` (som `Layout.jsx` fyrer ved hver app-load)
   giver de 21 kvalificerende hold achievementen ved deres næste besøg.

## Forward-guard

`backend/lib/achievementCopyContract.test.js` binder kode og copy sammen **begge
veje**, for begge sprog:

1. hver tærskel i motoren skal stå ordret i `achievements.json`
2. hvert tal i copy'en skal have en konstant bag sig

Kontrakten bygges af de samme konstanter som motoren bruger — ikke af tal
skrevet af igen, ellers ville guarden gentage den fejl den skal fange.
Verificeret ved mutation: sættes konstanten tilbage til 2.000.000.000, fejler
begge retninger.

Retning 2 er den der fanger #2917-klassen. Den afslørede med det samme tre
definitioner med tal i teksten, som ingen kode kan tildele: `auction_5_streak`
("Win 5 auctions in a row"), `secret_rival` ("Bid against the same manager in 10
auctions") og `secret_heartbreak` ("Lose an auction in the last second 3 times").
De ligger i en eksplicit `ENGINE_GAP`-liste, og en tredje test fejler hvis en af
dem får unlock-logik uden at blive fjernet fra listen. Listen skal krympe,
aldrig vokse.

## Læring

Et player-facing tal skal have præcis én kilde. Står det både i kode og i copy,
skal en test binde dem sammen — ellers opdages divergensen først når en spiller
skriver i Discord, og indtil da ser achievementen bare ud som om ingen er dygtig
nok. Og: mål altid selv. Tallene i det oprindelige issue var rigtige her, men
prod-målingen (0 tildelinger, højeste bud 1.087.224) var det der gjorde det
klart at det ikke var en balance-diskussion, men en død feature.
