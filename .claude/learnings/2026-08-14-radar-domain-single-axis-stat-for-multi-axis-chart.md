# Radar-domænet blev kalibreret mod én akse, men bruges på otte

**Dato:** 14. august 2026 · **Sag:** #3707 (regression fra #3666/#3683, samme aften) · **Klasse:** metrik-fejlmatch

## Hvad skete der

#3666's rescale (median 59 til 13, loft 99 til 85) krævede at ryttertype-radaren
(`RiderTypeRadar.jsx`) fik et nyt fast akse-domæne, for det gamle (99) ville have
klemt næsten alle polygoner ned til en prik. Den valgte konstant var 40, begrundet
med at p90 for **en rytters bedste rolle** var 29 read-only mod prod.

Det tal måler kun ÉN ting pr. rytter (det bedste af otte). Radaren tegner otte akser
samtidig, og en alsidig toprytter (høj i climbing, time_trial, tempo, recovery,
endurance osv. på tværs af mange evner) kan ligge over 40 på flere eller alle otte
roller samtidig, ikke kun sin egen. Konsekvensen: 80 ryttere i prod fik alle otte
akser klampet til randen, 245 fik det på mindst fire. Polygonen så "maksimal i alt"
ud, netop den bug-rapport spilleren indsendte 34 minutter efter samme aftens rescale.

Sjovt nok var symptomet allerede set og dokumenteret SAMME dag: `seedData.js`s
kommentar til rider-1 beskriver ordret "otte stopfyldte bjælker på radarens
0-40-akse" for den gamle (høje) sample-rytter, men rettelsen der blev valgt var at
sænke PREVIEW-rytterens tal i stedet for at rette domænet. Det virkede for netop den
ene sample-rytter, men lod fejlklassen stå åben for enhver anden alsidig rytter i
den ægte bestand.

## Hvorfor det er værd at skrive ned

**En percentil-måling af én dimension retfærdiggør ikke en konstant der bruges på
flere uafhængige dimensioner af samme underliggende data.** p90 for "bedste rolle"
siger ingenting om hvor mange roller der SAMTIDIG kan ligge højt for én rytter, når
rollerne trækker på et fælles evne-sæt (samme 15 evner, forskellige vægte) i stedet
for at være uafhængige stikprøver. To roller der begge vægter `climbing` og `tempo`
tungt vil korrelere kraftigt for en alsidig rytter, netop den type spilleren kigger
på i en radar.

Havde målingen i stedet spurgt "for hvor mange (rytter, akse)-par overstiger værdien
domænet, og hvor mange ryttere rammer det på FLERE akser samtidig", var defekten
fanget FØR ship i stedet for via en spillerrapport.

## Regel fremadrettet

Når en konstant deles på tværs af flere korrelerede akser i samme visning (radar,
multi-serie chart, etc.):

1. Mål fordelingen PÅ TVÆRS AF ALLE AKSER SAMTIDIG, ikke kun "bedste akse pr. række".
   Tæl eksplicit hvor mange rækker der rammer/overskrider domænet på 1, 4 og alle N
   akser.
2. Hvis akserne deler input-data (samme underliggende evner, forskellige vægte),
   antag korrelation, ikke uafhængighed. En alsidig outlier rammer typisk mange akser
   samtidig, ikke bare én.
3. En sample-/seed-rytter der viser bug'en er ikke "løst" ved at gøre sample-rytteren
   mindre ekstrem. Det skjuler symptomet i preview uden at røre defekten i prod.
4. Foretræk domæner grundet i en HÅRD invariant (fx et faktisk klampet loft i koden,
   her ratingForRole's `Math.min(99, ...)`, empirisk observeret max 85) frem for en
   percentil, når "ingen rytter må se falsk maksimal ud" er et krav der ikke må
   brydes selv for sjældne outliers.

## Bør i HOT memory?

Nej, WARM er nok. Mønstret er specifikt for radar-/multi-akse-visninger, som der
kun er få af i kodebasen (RiderTypeRadar, RiderDevelopmentTab-chartet). Genfejl
inden for de næste sessioner der rører multi-akse-visualisering bør trigge
promotion.
