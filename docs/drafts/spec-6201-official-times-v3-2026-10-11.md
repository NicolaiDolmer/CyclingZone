# Spec-udkast: udbruddets størrelse under official_times_v3 (#6201)

> Status: UDKAST fra undersøgelsesspor 10/10 (nat). Ikke ejer-godkendt. Ingen tal her; målingerne ligger privat i `balance-internals/6201-official-v2/` (hard rule 17).
> Refs #6201 · #6200 (opretter den slukkede revision `official_times_v3`) · #5578 (udbrudsmål der ikke må ryge)

## Kort

Ejerens trappe (flad typisk 3-6, kuperet og rullende 5-9, bjerg og højfjeld 6-12, loft 8/12/16) er opfyldt i de syntetiske felter, hvor alle hold er AI-hold. Den er **ikke** opfyldt i de rigtige felter (Hexagone-cachen og Giro-fixturen): kuperet/rullende og bjerg ligger under trappens bund, tydeligst på Hexagone. Flad er i orden.

## Hvad målingen viste (kvalitativt)

1. **Syntetiske felter (proxy 22x8 og scorecardets felt):** trappen holder på alle profiler. Her er `official_times_v2` byte-ens med `orders_gc_v3` i dannelsen, fordi der ikke er noget klassement, og derfor er #5578-knapperne inaktive.
2. **Rigtige felter:** medianen på bjerg og kuperet ligger under bunden. Spændet er smalt og når aldrig loftet. Fordelingen er ikke længere todelt (kriterie 3 er opfyldt), men den er hele vejen rykket nedad.
3. **Hovedårsag: for få forsøg, ikke for lav succesrate.** I et felt med mest menneskehold kommer forsøgene kun fra eksplicitte ordrer (`try_break`), de få hunters og de få AI-hold. Antallet af forsøg ligger allerede under trappens bund, så ingen succes-justering kan nå trappen. Forsøg: en højere profilbonus (succes) rykkede intet på Hexagone og kun lidt på Giro. Det gælder også under `orders_gc_v3`; det er ikke noget `official_times_v2` har skabt.
4. **Sekundær årsag, kun official_times_v2:** #6376 (`rivalRankAlways`, de forreste er altid en trussel) og #6391 (`formationRankedPressureWeight`, et forsøg fra de forreste møder hårdere modstand) gør udbruddet mindre igen og giver en hale af udbrud på 0-2 mand på bjerg og kuperet. Når én af dem slås fra lokalt, kommer størrelsen tilbage på `orders_gc_v3`-niveau. **Men** det koster #5578: uden `rivalRankAlways` fejler mål 6 (en top-10 får minutter i udbruddet), og et mildere formationstryk (kun de 3 forreste) får mål 4 til at fejle (udbruddet ender sjældnere foran favoritterne). De andre #6376/#6391-knapper (`leaderRivalFloorShare`, troje-tolerance, `rankedLeadCapSeconds`, `rivalStrengthMin`, forsvarsvinduet) påvirker ikke dannelsen nævneværdigt. Konklusion: de to knapper er ikke fejl, de er nødvendige for #5578, så de må ikke bare slås fra.
5. **Kriterie 2 (farten følger antallet):** i de rigtige felter holder små udbrud på kuperet nogle gange hjem lige så ofte som store. Det skal måles igen efter rettelsen, fordi stikprøverne på 6+ er små, når udbruddene er små.
6. **Scorecardet** dømmer udbruddets størrelse mod et bredt PCS-bånd (status "forslag"), ikke mod ejerens trappe. Derfor står der PASS, selv om trappen ikke er opfyldt.

## Rettelsen (kun i official_times_v3, slukket)

`official_times_v2` og alle ældre revisioner skal være byte-identiske (frosne digests i `backend/lib/engine/v4/test-data/oldRevisionDigests6199.json` skal bestå uændret). Alt nedenfor gates på den nye revision fra #6200-sporet.

**R1. Måling (scorecard, ingen motor-ændring).** `backend/scripts/dev/lib/tourScorecard.mjs`: `breakawaySize`-båndet pr. profil bliver ejerens trappe (status "ejer", kilde #6201). Andelen af 0-2 mand og antal forsøg pr. etape bliver målte kolonner. Først da kan scorecardet dømme trappen.

**R2. Flere forsøg fra ryttere uden klassementschance (kun official_times_v3).**
- R2a, AI (ejerens valg A, ingen ny beslutning): `backend/lib/engine/v4/ai/aiTactics.ts`. Et AI-hold uden klassementschance sender i dag højst én klatrer, kun på bjerg og inden for `MAX_BREAK_CANDIDATES`. Under v3 sender det også en angriber på kuperet/rullende, og på bjerg flere passende klatrere. Aldrig kaptajn eller grupetto, aldrig en garanti. Ordrernes betydning er uændret.
- R2b, menneskehold: **kræver ejer-go.** R2a alene kan ikke løfte et felt med få AI-hold (Hexagone) op på trappen. Det kræver retning B fra diagnosen 5/10: på bjerg og kuperet kan en hjælper uden eksplicit `try_break=false` forsøge spontant. Det ændrer ordrekontrakten, så det skal vises som A/B for ejeren. Alternativet er at acceptere, at trappen i felter med mest menneskehold styres af managernes egne ordrer, og så måle trappen pr. felttype.

**R3. Formationstrykket mod de forreste beholdes (#5578 mål 4 og 6), men isoleres.** Et forsøg fra klassementets forreste tæller i dag med i felt-trængslen (`room`/crowd i `resolveMorningBreakFormation`, `backend/lib/engine/v4/mechanics/breakawayPermission.ts`), og det gør det sværere for alle andre. Under v3 tæller et farligt forsøg fra en af de forreste ikke med i trængslen. Den hårde modstand mod netop ham beholdes. Det er en kandidat, der skal måles; den er ikke bevist.

**R4. Farten følger antallet (kriterie 2).** Måles igen efter R2. Holder små udbrud stadig hjem lige så ofte som store på kuperet, skærpes `smallBreakPaceV3` kun under v3.

## Gates før en v3-PR må merges

- Trappen pr. profil (median og spænd) på alle tre felter: proxy, Giro og Hexagone-cachen. Hexagone og Giro tæller med, ikke kun proxyen.
- Mindre andel på 0-2 mand på bjerg end under `official_times_v2`.
- #5578 mål 3 (mod legacy), mål 4 (bjerg foran favoritterne) og mål 6 (ingen top-10 med minutter i udbruddet) er mindst lige så gode som under `official_times_v2` på de samme felter.
- `official_times_v2` og ældre: byte-identiske (digests uændrede).
- RULES + help (EN + DA) i samme PR (kriterie 4).

## Risiko

- R2a/R2b giver flere udbrud, der holder hjem. Det kan skubbe `breakawayWinShare` op over ejerens bånd på kuperet. Det skal holdes øje med sammen med #5578.
- R3 kan lukke flere klassementsryttere ind i udbruddet, hvis isoleringen er forkert. Mål 6 er vagten.
- R2b ændrer, hvad en manglende ordre betyder for menneskehold. Det er en ejer-beslutning, ikke en teknisk.

## Reproduktion (lokalt, ingen prod)

```
node backend/scripts/dev/breakawaySize6201.mjs --rules=orders_gc_v3,official_times_v2 --mode=all --seeds=s1,...,s10
node backend/scripts/dev/tourDryRun.mjs --cache=balance-internals/tour-6285/cache-hexagone.json --revision=official_times_v2 --compare=orders_gc_v3 --seeds=20
node backend/scripts/dev/tourDryRun.mjs --fixture=giro --revision=official_times_v2 --compare=orders_gc_v3 --seeds=20
```

Knapperne blev slået fra én ad gangen med et load-hook uden for repoet (worktreet blev ikke rørt). Resultaterne ligger i `balance-internals/6201-official-v2/`.
