# Akademikandidater ER frie agenter — og de er de billigste i spillet

**Dato:** 2026-08-29 · **Issue:** [#4213](https://github.com/NicolaiDolmer/CyclingZone/issues/4213) · **PR:** [#4383](https://github.com/NicolaiDolmer/CyclingZone/pull/4383)

## Hvad skete der

271 levende akademitilbud til 162 menneskehold pegede på ryttere der stod på et AI-holds trup. Manageren så et kort med en signeringsknap for en rytter han ikke kunne få — og databasens guard (`finalize_academy_acquisition`) ville have lukket handlen igennem, fordi den kun spørger om rytteren er *akademirytter*, ikke om han er *fri*.

## Rod-årsag

`academyGenerator.js:152` fødder intake-kandidater med **både** `team_id: null` og `is_academy: false`. Det er bevidst — de bliver først akademiryttere når manageren siger ja. Men konsekvensen er at **rytter-rækken alene ikke kan skelne en lovet-væk kandidat fra en almindelig fri agent.** Den eneste markør er en `academy_intake`-række med status `'offered'`, altså i en anden tabel.

24/8 12:15:16–12:18:04 UTC kørte #4172's free-agent-fill (D4-spredningen) og fordelte 2.532 frie ryttere på 127 nyoprettede AI-hold. 1.543 af dem havde en intake-række.

## Den vigtige del: det var ikke tilfældigt

Målt i prod 29/8:

| Fri agent-type | Antal | Median `market_value` |
|---|---:|---:|
| Levende akademitilbud | 81 | 4.925 |
| Almindelig | 338 | 37.956 |

Akademikandidater er **systematisk 8x billigere** end almindelige frie agenter — de er 16-21-årige med lav current-værdi. Enhver rutine der sorterer "billigste frie agenter først" placerer dem derfor **i toppen** af sin liste. De blev ikke ramt af uheld; de blev ramt først.

Det gør fejlklassen bredere end den ene kørsel. `squadEnforcement.findCheapestAvailableRiders` sorterer netop `market_value` stigende, og minimum-6-gulvet gik live 28/8 (#4301/#4295). Hullet var ved at åbne igen ad en anden vej.

## Hvorfor det var svært at finde

**Scriptet der gjorde skaden blev aldrig committet.** Det var et ad-hoc-kørsels-script i #4172-sessionen. Rod-årsagen kunne kun findes fordi *backup-filen* blev committet (`docs/snapshots/4172/d4-freeagent-fill-*.json`) og commit-teksten nævnte "free-agent-fill".

Sporingen gik via data, ikke via kode:

1. Alle 271 havde `is_academy = false` → udelukkede akademi-specifikke stier
2. Alle tildelt i ét 2m23s-vindue → én batch-kørsel, ikke en løbende læk
3. `ai_team_id IS NULL` for alle 271 → udelukkede restore-stien (`team_id := ai_team_id`)
4. Ingen `squad_auto_purchase`-transaktioner i vinduet → udelukkede `squadEnforcement`
5. Alle 127 modtagerhold oprettet i samme vindue → pegede på #4172
6. Commit-log 24/8 14:21 CEST: "#4172 D4 spredt+fyldt" → fundet

## Læring

**Et kodefilter kan ikke være hele værnet, når skadevolderen ikke er i koden.** Derfor to lag:

- `backend/lib/academyOfferProtection.js` + filter i `squadEnforcement` — så de *lovlige* stier lader være
- `database/2026-08-29-4213-academy-offer-ownership-guard.sql` — en `BEFORE UPDATE OF team_id`-trigger der dækker **enhver** skrivevej, inkl. fremtidig ad-hoc SQL

Værnet er bevidst smalt: det blokerer kun når `team_id` sættes til et *andet* hold end det tilbuddet gik til. Signering, frigivelse til NULL og ryttere uden levende tilbud passerer. Negativ-bevis kørt mod prod i en rullet-tilbage transaktion: fremmed hold blokeret ✓, signering tilladt ✓, frigivelse tilladt ✓.

**Generaliseringen:** når en entitet er "reserveret" i en anden tabel end sin egen, er den usynlig for enhver query der kun læser entitetens egen række. Reservationen skal enten stå på rækken selv, eller håndhæves i databasen. `is_academy: false` på en akademikandidat er en korrekt modellering af *hvad han er* og en farlig modellering af *om han er ledig*.

## Sideløbende fund

Spillet har allerede en indbygget oprydning der gør det **modsatte** af reparationen: `academyIntakeExpirySweep` lag 1 afstemmer forældede rækker til `'rejected'` (postmortem 2026-07-18). Den kører og tog 1 række 25/8 og 3 rækker 29/8 — derfor gled tallet 278 → 274 → 271 mens sagen blev undersøgt. Ejeren valgte 29/8 bevidst den anden vej: frigiv rytterne, så tilbuddene bliver ægte, i stedet for at trække kortene tilbage.

Ved den vej skal tilbuddenes ur nulstilles. Alle tilbud er fra 22/8 og `INTAKE_OFFER_EXPIRY_DAYS` er 7. I dag beskytter lag 1's ejerskabs-tjek dem mod udløb; i det øjeblik rytteren frigives falder den beskyttelse væk, og sweepen ville udløbe dem og auktionere dem inden for et døgn.

## Forward-guards

- DB-trigger `trg_guard_academy_offer_ownership` (applied 29/8, verificeret `tgenabled = 'O'`)
- 5 unit-tests i `academyOfferProtection.test.js`
- 2 regressionstests i `squadEnforcement.test.js` der fikserer at billige lovede kandidater falder ud af købslisten, og at det tilbydende hold selv stadig må tage sin egen kandidat
- Reparationsscriptet er committet **før** kørslen, netop fordi #4172's ikke var
