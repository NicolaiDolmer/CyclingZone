# Gaten målte et speedometer, ikke den karriere spilleren oplever

**Dato:** 2026-08-16 · **Kontekst:** trin 7 (#3746), kalibrering af rateByPotential mod S4/S5-gates.

## Problem

S4-gaten ("bedste rytter 20→90 på 286-386 dage") simulerede en rytter der var 17 år
FOR EVIGT. Kalibreret mod den så gaten grøn ud ved rate 0,57, men i den rigtige
motor falder vækstbudgettet ved 20/23/26 år, så den perfekte ægte karriere toppede
på 80: **ingen rytter ville nogensinde nå 90**, og løftet til spillerne var brudt
den modsatte vej uden at nogen gate kunne se det.

## Fix

Ejer-go 16/8: S4/S5 måler nu en ÆGTE karriere (start 16 år, aldring pr. sæson,
decline efter peak via motorens egen stepAbility, rapportering 16→40 år). Båndene
er uændrede; kun målemetoden blev ærlig. Rate-spredningen endte 0,11-0,89 i stedet
for 0,07-0,57.

## Læring

En gate skal måle det SPILLEREN OPLEVER, ikke en forenklet proxy af det. Enhver
tidsbaseret gate over motoren skal inkludere de tilstandsændringer der sker
undervejs (aldring, taper, decline), ellers kalibrerer man mod et scenarie ingen
er i — samme fejlklasse som faldgrube 4 fra 15/8 (måling uden faciliteter/staff),
bare i tidsdimensionen. Tjekspørgsmål til nye gates: "kan en rytter i prod
gennemleve præcis det her forløb?" Hvis nej, er gaten et speedometer.

To beslægtede fund fra samme session, samme mønster (proxy ≠ virkelighed):
- Design-tallet "553 ryttere over nyt loft" var målt mod det RÅ tag; det tal der
  faktisk persisteres er alders-taperet, og det ærlige tal var 2.134 (#3803).
- Værdimodellens NPV genbrugte motorens rateByPotential, så en motor-kalibrering
  ville have flyttet markedsværdier −12/−27/−33 % som tavs sideeffekt. Fanget af
  afledningstjek og frosset (#3750 refitter samlet).
