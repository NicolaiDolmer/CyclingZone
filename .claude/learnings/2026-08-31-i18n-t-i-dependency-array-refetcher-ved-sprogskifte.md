# `t` i et dependency-array refetcher ved sprogskifte (#4448 / PR #4450)

Dato: 2026-08-31 (Europe/Copenhagen)

## Symptom

Ingen spiller-rapport. Fundet af et adversarisk review af PR #4450, som
forsøgte at modbevise PR-bodyens påstand "hvert nyt array indeholder enten
samme værdier som det håndholdte array før, eller callbacks der beviseligt
er stabile".

Tre effekter havde fået `t` fra `useTranslation` ind i dependency-arrayet,
under kommentarer der påstod det modsatte af hvad koden gjorde:

| Sted | Kommentaren sagde | Koden gjorde |
|---|---|---|
| `RacePointModelSection.jsx:79` | "forbliver reelt mount-only" | refetchede hele point-modellen ved hvert sprogskifte (var `deps=[]` før) |
| `RacePointsAdminSection.jsx:59` | "kører fortsat kun når mode skifter" | hentede begge race-points-endpoints igen ved sprogskifte |
| `RiderStatsPage.jsx:1470` | "samme gen-subscribe-hyppighed som før" | rev supabase-auktionskanalen ned og gen-abonnerede ved sprogskifte |

## Rod-årsag

Refaktoreringen fjernede håndholdte `eslint-disable-next-line
react-hooks/exhaustive-deps` og lod ESLint fylde de manglende dependencies
ind. Det var den rigtige metode - men den er kun adfærdsbevarende for
dependencies med **stabil identitet**.

`t` har ikke stabil identitet. react-i18next binder på `languageChanged`, og
snapshottet skifter når sproget skifter - det er præcis mekanismen der får
komponenter til at re-rendre med nye strenge. En disable var altså ikke bare
støj her: den kodede en reel, bevidst beslutning om at `t` ikke måtte
udløse effekten. Da kommentaren blev skrevet om, blev beslutningen tabt,
mens den nye kommentar påstod at intet var ændret.

Den dybere fejl er metodisk: ESLints forslag blev behandlet som facit for
adfærd. ESLint garanterer at arrayet er **komplet**, ikke at det er
**adfærdsbevarende**. De to ting falder kun sammen når alle dependencies er
stabile, og det skal verificeres pr. dependency - ikke antages.

## Fix

`t` læses gennem en ref de steder hvor den kun bruges i fejl- eller
celebration-stien:

```js
const tRef = useRef(t);
useEffect(() => { tRef.current = t; }, [t]);
```

Mønstret var ikke nyt - `AuctionsPage.jsx:957` indførte det i Fase 3b til
nøjagtig samme problem på sin egen auktionskanal. Det burde have været
fundet ved konverteringen. Dermed er arrayet både komplet OG sandt, og
fejlteksten hænger stadig ikke på gammelt sprog.

## Backwards-check

Forward-guarden blev skrevet før rettelsen var færdig, og fandt straks tre
ÆLDRE forekomster af samme fejlklasse, uden for #4448's diff:

- `SeasonFinanceReportPanel.jsx` - hele sæsonrapporten hentedes forfra
- `TeamResultsTab.jsx` - den paginerede `race_results`-hentning, op til fem
  `.range()`-runder for et etableret hold (prod 18/7: max 4.348 rækker)
- `TeamTransferHistoryTab.jsx` - transfer-historikken

Alle tre rettet med samme mønster. Det er værd at bemærke at guarden fandt
dem selv: den blev skrevet som en scanner, ikke som tre assertions om de
kendte steder.

## Forward-guard

`frontend/src/lib/i18nDepInEffect4448.test.js` scanner al frontend-kilde,
parser hvert `useEffect(...)`-kald med en paren-tæller (kommentarer og
streng-literaler blankes først, så en dansk kommentar med uparret parentes
ikke vælter tælleren), og fejler hvis et dependency-array indeholder `t`
mens effektens krop rører `fetch(`, `supabase.channel(`, `supabase.from(`
eller `authHeaders(`.

Reglen er snæver med vilje. `t` i et `useMemo`-array er legitimt - dér **er**
en gen-beregning ved sprogskifte det rigtige, og der er 15 sådanne i
kodebasen. Guarden har desuden en no-op-lås: den sammenligner sit eget antal
fundne effekter med et råt `useEffect(`-tælleri i `RiderStatsPage`, så en
knækket parser ikke kan lade testen bestå tom.

## Læring

1. En `eslint-disable` med en begrundelse er data, ikke støj. Læs
   begrundelsen FØR du fjerner direktivet - den fortæller ofte præcis hvilken
   dependency der bevidst blev holdt ude.
2. ESLints udfyldning gør arrayet komplet, ikke adfærdsbevarende. Hver
   tilføjet dependency skal klassificeres som stabil eller ustabil.
3. Skriv aldrig en kommentar der påstår "uændret adfærd" uden at have
   verificeret identiteten af hvert element i arrayet. Her var kommentaren
   værre end ingen kommentar: den ville have fået den næste læser til at
   springe kontrollen over.
4. Skriv forward-guarden som en scanner over hele kodebasen, ikke som
   assertions om de steder du lige rettede. Scanneren her fandt tre bugs
   ingen ledte efter.
