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

## Del 2: at rette domænet var ikke nok (ejer-review FØR merge, PR #3716)

Første fix (dette dokuments oprindelige indhold) hævede AXIS_DOMAIN fra 40 til 85,
spillets faktiske loft, og fjernede klampningen fuldstændigt. Målt: ingen rytter
kan længere se falsk maksimal ud.

Ejeren målte selv uafhængigt mod prod og bekræftede fundet, men flagede at
rettelsen kun løste HALVDELEN af regnestykket. Målt på 3.585 spillerejede
ryttere: medianens BEDSTE akse er 21, p90 er 36. Med et LINEÆRT domæne på 85
fylder medianens bedste akse kun 25% af radius, og de øvrige syv akser for samme
rytter ligger på 4-16%, polygonen bliver en ulæselig prik for langt de fleste
spillere. Det er nøjagtig den defekt #3666 selv advarede mod dengang domænet var
99, bare genindført ved 85, fordi "et højere tal end 40" ikke i sig selv løser
et lineært skala-problem.

**Rod-årsagen var altså ikke "domænet var for lavt".** Rod-årsagen var: **et
FÆLLES LINEÆRT domæne kan ikke samtidig repræsentere data med et spænd på faktor
~28 (85 øverst, ~3 typisk lavt) uden enten at klampe toppen (løgn, #3666's
oprindelige defekt) eller flade bunden (ulæseligt, det nye fund). Det er en
konsekvens af geometrien, ikke af hvilket specifikt tal domænet får.**

Fix del 2: `radius = R * Math.sqrt(value / domain)` i stedet for
`radius = R * (value / domain)`. Domænet (85) er UÆNDRET og stadig fælles for
alle ryttere; kun mappingen fra værdi til radius er ikke-lineær. Kvadratrod
komprimerer toppen og strækker bunden, monotont, så to profiler stadig kan
holdes op mod hinanden. Ringene skiftede fra jævnt fordelte tal (12/21/32) til
faste, mærkede pejlemærker (10/30/60/85) med synlige tal på selve grafen, for en
ikke-lineær skala uden aflæselige referencepunkter er lige så vildledende som
klampningen den erstatter.

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
5. **Mål BEGGE ender af skalaen, ikke kun toppen.** En fix der kun måler "klampes
   nogen falsk til maks" kan stadig fejle på "kan medianen overhovedet aflæses".
   Når spændet mellem typisk-lav og faktisk-max er stort (her faktor ~28), kan et
   FÆLLES LINEÆRT domæne strukturelt ikke tilfredsstille begge krav samtidig, uanset
   hvilket tal man vælger til domænet. Det kræver en ikke-lineær mapping (sqrt/log),
   ikke endnu en konstant-justering. To tests, ikke én: "ingen klampes" OG "medianen
   fylder mindst X% af skalaen".
6. En ikke-lineær skala UDEN synlige, mærkede referencepunkter (ringe/gridlines med
   tal) er lige så vildledende som en lineær klampning, bare på en anden måde:
   afstanden mellem to punkter på aksen betyder ikke længere det samme antal
   rating-point to steder på skalaen. Enhver ikke-lineær akse SKAL have læsbare
   pejlemærker, ellers har man løst korrekthed ved at ofre gennemsigtighed.

## Bør i HOT memory?

Nej, WARM er nok. Mønstret er specifikt for radar-/multi-akse-visninger, som der
kun er få af i kodebasen (RiderTypeRadar, RiderDevelopmentTab-chartet). Genfejl
inden for de næste sessioner der rører multi-akse-visualisering, eller enhver
anden visning med et stort dataspænd (faktor >10 mellem typisk og max), bør
trigge promotion.
