# Falske ofrings-tekster på enkeltstarter (#3145)

**Dato:** 2026-08-31 (natbølge)
**Fil:** `backend/lib/raceNarrative.js`
**Symptom:** Spillere så "ryttere blev ofret for kaptajnen" på solo-enkeltstarter, hvor
ingen kører for nogen. Rapporteret tre gange (@ez4prebren 28/7 x2, @thelamba 28/8).

## Rod-årsag

`extractStageMoments()` udløste `helper_shift` og `tag_helper_sacrifice` alene på
struktur: kaptajn i top-5, kaptajnens `team`-komponent > 0, og mindst to hjælpere
uden for top-25. Der blev aldrig spurgt om hjælperne rent faktisk **betalte** noget.

Samme fil havde svaret 200 linjer længere oppe: `dominantReason()` kræver
`Number(c.work_cost) < 0` før den kalder en nedtur "helper_work". Den guard var bare
aldrig kopieret ned i ofrings-blokken.

På `itt`/`itt_hilly` er `work_cost` for en `helper` 0 pr. design — `raceRoles.js`
`baseWorkCost()` giver kun en pris på `GC_RELEVANT_PROFILES` og
`FLAT_LEADOUT_PROFILES`. Beatet fortalte altså om et offer, motoren aldrig havde
opkrævet.

## Målt mod prod 30/8 (read-only)

- 616 `tag_helper_sacrifice` + 166 `helper_shift` over 71 ITT-etapeinstanser.
- 607 af de 616 taggede ryttere havde `work_cost = 0`; gennemsnitlig
  `team`-komponent 0,00000.
- De 9 med negativ `work_cost` fordelte sig: 6 uden rolle-række, **3 hunters**.
- Seneste forekomst 30/8 kl. 19:00 dansk tid — fejlen producerede ny tekst dagligt.

## Fix

To guards i ofrings-blokken, begge nødvendige:

1. `SOLO_EFFORT_PROFILES` (`itt`, `itt_hilly`) slår beatet helt fra.
2. Mindst én udpeget hjælper skal have `Number(components.work_cost) < 0`.

Guard 2 alene var ikke nok: `WORK_COST_HUNTER` er profil-uafhængig og negativ på
alle profiler, så de 3 hunters ville være sluppet igennem. Guard 1 alene var heller
ikke nok: et "offer" uden pris er lige forkert på en flad etape.

## Læring

**Når en fil allerede indeholder beviset for en påstand, skal alle beats der gør
påstanden bruge det.** `dominantReason()` og ofrings-blokken fortalte om det samme
fænomen — hjælper-arbejde — men kun den ene krævede evidens. Den slags asymmetri
inden for én fil er billig at opdage med et grep efter komponent-navnet.

**Fravær af et signal er ikke det samme som at signalet er 0.** `Number(undefined) < 0`
er `false`, så guarden er defensiv af sig selv, men det er værd at teste eksplicit.

**Forward-guard:** fire tests i `backend/lib/raceNarrative.test.js` (itt + itt_hilly
med `work_cost` 0, hunter med negativ `work_cost` på itt, work-cost-guarden på en
flad profil, og at et ægte bjergetape-offer stadig tagges). Verificeret: de tre
negative tests fejler mod `origin/main` og består mod fixet.

## Ikke med i dette fix

`teamComponent()` i `raceSimulator.js` er stadig ikke gatet på profil, så en kaptajn
kan modtage en team-bonus på en enkeltstart. Det ændrer faktiske ITT-placeringer og
skal have ejer-go som eget kalibrerings-issue. Historiske løb repareres ikke — fixet
er rent fremadrettet.
