# Anchor-dækning: kalibrér hele skalaen, ikke kun eliten (#1101 v3)

## Hvad skete

Værdimodel v3 (alsidigheds-blend + krumning) blev fittet mod 22 ejer-anchors, der alle lå i
eliten (output 57-87, værdier 0,5M-125M). Fittet så perfekt ud på anchors (R²log 0,946,
Pogačar > MvdP genoprettet) — men ALT under output 57 var ren ekstrapolation. Den stejlere
kurve kollapsede dér: det fiktive launch-felts median blev **34 CZ$** (ikke 34k), og en
gennemsnits-rytter kostede under 50 CZ$. Spejlproblemet i toppen: én fiktiv rytter OVER
anchor-rækkevidden eksploderede til 1,13 mia.

## Hvad fangede det

Kæde-integrationstesten `fictionalLaunchPopulation.test.js` ("hele værdi-kæden giver den
godkendte launch-pyramide") — en låst, ejer-godkendt fordelings-scorecard der kører HELE
kæden mod den rigtige population. Uden den var kollapset skibet til preview/backfill.

## Lærdomme

1. **Anchors/træningsdata skal DÆKKE hele input-skalaen modellen bruges på.** Et fit kan
   være fremragende på sit eget domæne og katastrofalt 10 output-point udenfor. Tjek altid:
   hvad er min/max af det input, populationen faktisk har, vs. det kalibreringen dækker?
2. **Fordelings-scorecards på hele populationen > punkt-tjek på kendte navne.** Spotcheck af
   Pogačar/MvdP så perfekt ud; kollapset lå i de 8.000 ryttere ingen kigger på. Simulér-
   før-ship-memoryens "ægte population + mål-scorecard" var præcis det der reddede os.
3. **Når modellen ændres, re-verificér ALLE nedstrøms kalibreringer.** v3 invaliderede den
   fiktive generators pyramide-tuning (#1194) — det er ikke en modelfejl, men en kobling
   man skal lede efter aktivt (grep efter forbrugere af modellen/funktionen).

## Forward-guard

- 4 bund-anchors pinner nu skalaen (interpolation, ikke ekstrapolation) — del af anchors-filen.
- Ordens-guard + monotoni-guard fejler højt i fit-scriptet (`riderValuationFit.js`).
- #1194: generator re-tunes mod design-pyramiden; interim-bånd strammes tilbage dér.

Refs #1101, #1194. Session 9-10/6-2026.
