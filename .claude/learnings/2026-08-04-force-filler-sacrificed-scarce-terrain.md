# Postmortem · 2026-08-04 · Force-filler-mekanisme ofrede knapt bjerg-terræn (fanget før merge, #3326)

## Hvad skete der?
Under implementeringen af finale-drevne ordnings-arketyper (#3326) tilføjede jeg en
`forceFillerType`-funktion der konverterer én filler-etape til fx `itt`/`hilly`, så en
trukket ordnings-arketype (tt_finale/circuit_finale) reelt kan lade sig gøre. Første
version faldt tilbage til "den seneste filler-plads, ligegyldigt hvad den er" når ingen
flad/rullende filler fandtes. Målt på en genereret sæson (sæson 2, tier 3, ~11 løb)
faldt `raceRouteRealismMetrics`-gatens summit-tal og M-Down-procent markant for tier 3
(realisme-scorecardet gik fra grønt til rødt for tier 3/4).

## Root cause
For filler-fattige arketyper (fx `summit_tour`, ofte kun 1 filler-plads oven på
garantierne) er der stor sandsynlighed for at den ENESTE filler-plads i forvejen rullede
`mountain`/`high_mountain` (summit_tour's filler-vægt for high_mountain er 26/92 ≈ 28%).
"Sidste udvej ofrer hvad som helst"-grenen kunne derfor klobbe netop den bjerg-etape —
bjerge er ikke fungible med flad/rullende/kuperet i forhold til realisme-båndene.

## Fix
`backend/lib/raceStageProfileGenerator.js` — `forceFillerType`: fjernede "sidste
udvej"-grenen. Prioriteret ofre-rækkefølge er nu KUN `flat → rolling → hilly → cobbles →
classic`; findes ingen af dem i filler-regionen, returnerer funktionen `false` i stedet
for at ofre `mountain`/`high_mountain`/`itt`. Den kaldende `resolveOrderArchetype` falder
i så fald tilbage til et andet feasible ordnings-valg (`fallbackOrderArchetype`) — aldrig
til at fjerne knapt terræn.

## Forhindret-fremover
Verificeret empirisk (ikke kun ved kode-læsning): kørte 3000 syntetiske sæson-varianter
(samme katalog, forskellig `season_id`) og sammenlignede tier 3's summit-fejlrate FØR vs.
EFTER fixet — faldt tilbage til ~samme niveau som baseline (uændret algoritme), hvilket
bekræftede at forcing-mekanismen (og ikke selve ordnings-featuren) var årsagen. Samme
metode bør genbruges fremover når en ny "forcer et sjældent terræn ind"-mekanisme tilføjes
et sted med skæve/knappe filler-vægte.

## Læring
En "sidste udvej"-fallback der ofrer HVAD SOM HELST for at gøre noget muligt, er farlig
når nogle værdier i multisettet er knappe/asymmetrisk vigtige (her: bjerg-etaper, som
realisme-gaten specifikt tæller). Ved forcing/mutation af et allerede-bygget multisæt:
byg en eksplicit prioriteret ofre-liste af "fungible" værdier, og lad funktionen fejle
(returnér false, fald tilbage til noget andet) fremfor at gribe det sidste tilgængelige
element blindt. Mål ALTID en balance-ændring empirisk (stor-N sammenligning mod baseline)
før man antager en fix virkede — en enkelt målt sæson kan sagtens være støj (verificeret
her: N=200 syntetiske sæsoner viste en falsk positiv "regression" på 6,5%→20%, som
forsvandt ved N=3000; se PR #3326-body for tallene).
