# Sponsor-resultatloftet nulstilledes aldrig — kumulativ tæller på en flersæsons-række

**Dato:** 2026-08-31 · **Issue:** #4515 · **PR:** #4517

## Hvad var galt

`sponsor_contracts.results_bonus_paid` talte op hver gang en sejrs-/podie-bonus blev
udbetalt (`sponsorRaceDayIncome.js`) og blev aldrig nulstillet. `results`-varianten er
toårig, så et hold der brugte loftet op i sit første år fik **0** i resultat-bonus hele
det andet år — mens den garanterede base og løbsdagsraten blev fornyet per sæson.

Målt i prod: Team WolkerWessels havde brugt 238.000 af 238.000 i S2 og fik 0 i S3 trods
etapesejre. BPTrain havde 3.780 tilbage af 166.950.

## Fejlklassen

**En kumulativ tæller på en række der overlever et periodeskifte, målt mod et loft der er
tænkt per periode.** Alle kontraktens andre komponenter fornyedes per sæson, fordi de
enten udbetales i sæsontransitionen (base) eller genberegnes der (løbsdagsraten). Loftet
var det eneste der levede videre urørt — netop fordi flersæsons-kontrakter springes helt
over ved sæsonskiftet:

```js
if (active && active.expires_after_season >= newSeasonNumber) continue;
```

`continue`-grenen er stedet hvor "der er ikke noget at gøre" stille blev til "der er noget
vi glemmer at gøre".

## Hvordan det blev fundet

Ikke ved at læse koden, men ved at sammenligne **udbetalt per sæson per transaktionstype**
for de samme hold. Base og løbsdagspenge stod i begge sæsoner; resultat-bonus stod kun i
den ene. Asymmetrien var synlig i én query, længe før rod-årsagen var det.

## Hvad der virkede

- **Mål alle veje, ikke kun den mistænkte.** Sponsorpenge udbetales ad fire veje. Tre var
  korrekte (race-day 840/840 med delta 0, sæsonstart 214/214 parity, mid-season 19/19).
  At kunne sige hvad der var sundt gjorde fundet troværdigt.
- **Tjek om afvigelsen er tilsigtet før den kaldes en fejl.** Det afgørende bevis var ikke
  at loftet var opbrugt, men at `season_objective` på den *også* toårige `ambition`-variant
  udbetales hver sæson. Inkonsistens inden for samme system slog design-hypotesen ihjel.
- **Ret data til det faktiske forbrug, ikke til nul.** BPTrain havde allerede fået 4.410 i
  S3. Et fladt nul ville have foræret dem beløbet igen. Migrationen læser
  `finance_transactions` for den aktive sæson — den samme kilde som udbetalingen selv.

## Forward-guard

Nulstillingen ligger i `expireAndRenewContracts` med to tests: én der kræver præcis én
update med `{ results_bonus_paid: 0 }`, og én der kræver **ingen** write når der intet
forbrug er (ellers 200+ writes pr. sæsonovergang for at sætte 0 til 0).

## Backwards-check

Andre kumulative tællere målt mod et loft? `board_mandates` har `adjustments_used`,
`request_used` og `extraordinary_request_used`, men har én række pr. hold pr. sæson
(målt: 217 rækker, 217 hold, 1 sæson), så de er per sæson by design.
`results_bonus_paid` var det eneste tilfælde.

**Til næste gang:** når en tæller står på en række der kan overleve et sæsonskifte, så
spørg hvilken periode loftet hører til — og bekræft svaret mod hvad de *øvrige* felter på
samme række gør ved skiftet.
