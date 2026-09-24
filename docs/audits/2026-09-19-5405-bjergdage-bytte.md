# Undersøgelse: kan høj-bjergs-andelen i D2 og D3 løftes ved at bytte løb med D4?

**#5405 · 19/9 2026 · READ-ONLY.** Ingen `--apply`, ingen `--replace-existing`, ingen skrivning til
databasen, ingen ændring af kataloget.

> **Repoet er offentligt.** Denne fil indeholder metode og dom, men hverken løbsnavne eller målte
> fordelinger ud over grøn/rød-status. De faktiske tal, løbsnavnene pr. kandidat og anbefalingen
> ligger lokalt i `balance-internals/2026-09-19-s4-kalender-kvalitet/bjergdage-bytte.md`
> (gitignored) sammen med billedet til ejeren.

## Spørgsmålet

CALENDAR_RULES §6b kræver at samme andel af hver divisions etaper er rigtige bjergetaper med finale
på toppen, i alle fire divisioner. Tørkørslen af sæson 4 (uden `--uniform-tilt`, jf. ejer-beslutning
3/9) har 0 blokerende fund, men to divisioner ligger under målet. Ejeren bad 19/9 om at få prøvet,
om det kan lukkes ved at **bytte** et bjergrigt etapeløb fra Division 4's pulje med et ikke-bjergrigt
løb med samme etapeantal og klasse-niveau, så kvoter, terræn-gulve, komposition, monumenter og
GT-regler stadig holder.

## Metode

1. **Kortlagt hvordan løb tildeles divisioner** i `tierRaceSelection.js` og
   `tierCalendarMaterializer.js` (se afsnittet nedenfor).
2. **Bygget et read-only harness**, `backend/scripts/dev/bjergdageBytte5405.mjs`. Det kalder
   `materializeTierCalendars({ dryRun: true })` præcis som `buildSeasonCalendar.js`' tørkørsel og
   kører derefter hele scorecardet (`lib/calendarScorecardReport.js`, samme kode som CI). Eneste
   variation mellem kørsler er en muteret kopi af `TIER_ARCHETYPE_RESERVATIONS` — den frosne
   original røres ikke, og der skrives ingen byte nogen steder.
3. **Kørt 13 tørkørsler** i én kørsel: et udgangspunkt plus tolv kandidat-sæt.
4. **Verificeret harnessen mod et kendt resultat:** udgangspunktet er identisk med formiddagens
   tørkørsel på alle fire divisioner. Harnessen er altså kalibreret, ikke bare kørt.
5. **Diffet hele scorecardet** kandidat mod udgangspunkt: blokerende gates, apply-blokerende
   placerings-gates, §6b-afvigelser, §7b's sæsons-finale-bånd, §6's strenge K-B-tolerance,
   kvote-opfyldelse og overlaps-andele.

## Sådan tildeles et løb en division (det var ikke dokumenteret ét sted)

Der findes **ingen tier-kolonne på et løb**. Tildelingen udledes hver gang en kalender bygges:

1. **Klasse-vindue pr. division** (`TIER_CLASS_WHITELIST`, #2276). D1 er ubegrænset; D2, D3 og D4 har
   hver deres vindue, og vinduerne overlapper kun delvist.
2. **Divisionerne vælger i rækkefølge, D1 først.** Et løb en højere division har taget, er væk for
   de lavere (id- og navne-dedup).
3. **En reservations-fase før prestige-walket** (`TIER_ARCHETYPE_RESERVATIONS`, #3295): hver
   division tager først et fast antal løb af bestemte arketyper. Kun én arketype *garanterer*
   bjergfinaler.
4. **Et grådigt prestige-walk op til en eksakt etape-kvote.**

**To konsekvenser afgør hele opgaven:**

- **Division 2 og Division 4 deler ingen klasse.** Et direkte bytte mellem dem er umuligt uden at
  ændre et løbs `race_class` i kataloget, hvilket ville vælte prestige-kaskaden (#2276) og
  klasse↔etapeantal-båndet (#3328). Opgavens præmis kan derfor ikke opfyldes for Division 2.
- **Division 3 vælger før Division 4.** Alt D3 vil have i det fælles klasse-vindue, kan D3 allerede
  tage. Et "bytte" er i praksis et spørgsmål om hvad D3 reserverer, ikke om at tage noget fra D4.

Derfor varierer simuleringen præcis **én parameter**: reservations-tabellen. Det er den eneste knap i
produktionen der flytter et navngivet løb fra én division til en anden.

## Fund

**F1 — Præmissen holder ikke: Division 4 skal ikke give noget fra sig.** I hver eneste kandidat der
løfter Division 3, er Division 4 fuldstændig uændret: samme løb, samme etaper, samme andel. Det
bjergrige etapeløb Division 3 mangler, er ikke i Division 4's klasse-vindue og var **ikke valgt af
nogen division overhovedet** — det lå ubrugt i kataloget. Kvoten er eksakt, så en division bruger
ikke alt den kan nå.

**F2 — Division 3 kan komme i mål med én parameter-ændring, uden at nogen hård gate falder.**
Byttet er mellem to etapeløb med samme etapeantal og samme klasse, så kvoten holder eksakt og
klasse↔etapeantal-båndet er uændret. Blokerende fund forbliver 0, apply-blokerende forbliver 0,
alle terræn-gulve (inkl. Division 4's rullende-gulv fra 3/9) forbliver opfyldt, monument-gaten
forbliver ren, kvoterne rammes eksakt i alle fire divisioner og overlaps-andelene er uændrede.

**F3 — Prisen er en enkeltstart, og den kan ikke fjernes helt.** Det løb der skubbes ud for at gøre
plads, hører til den eneste arketype i divisionens vindue der *garanterer* en enkeltstart. §6b's
afvigelse skifter derfor navn fra bjerg til enkeltstart i stedet for at forsvinde. Den bedste
kandidat dæmper effekten ved også at reservere den arketype, men kvoten er fast, så noget skal ud.

**F4 — Division 2 kan løftes, men kun i stedet for Division 3, ikke ud over.** En kandidat bringer
Division 2 i mål ved at tvinge den længere ned i sit eget klasse-vindue. Den efterlader Division 3
uændret rød. Lægges de to kandidater oven på hinanden, trækker de i det samme løbsudvalg: Division 2
skyder **over** målet og Division 3 når det stadig ikke — begge ender røde, og det samlede antal
røde markeringer bliver ikke lavere.

**F5 — Nogle reservations-knapper er virkningsløse.** At hæve en divisions reservation til et tal
under det dens almindelige walk alligevel leverer, ændrer nul. En reservation er kun en knap når den
ligger *over* walkets eget resultat. Det bør huskes næste gang en reservation foreslås som fix.

**F6 — En utilsigtet gevinst.** Den bedste kandidat bringer samtidig sæsonens samlede udbruds-andel
tilbage inden for sit bånd (§7b, #4272), fordi et flugt-rigt løb erstattes af et bjergrigt. Det
punkt skulle ellers accepteres med et override-flag. Samlet falder antallet af røde markeringer med
ét i forhold til udgangspunktet.

**F7 — Division 3's bjergdage hviler på meget få løb.** Færre end nogen anden divisions. Det er en
skrøbelighed uafhængigt af denne beslutning: falder ét af dem ud ved en fremtidig regenerering, er
divisionen markant under målet igen.

## Dom

Det kan **delvist** lade sig gøre, men ikke på den måde opgaven beskrev, og ikke for begge
divisioner.

- Division 4 skal ikke og kan ikke bidrage. Division 2 kan slet ikke nås fra Division 4, fordi de
  ikke deler nogen klasse.
- Division 3 kan bringes i mål med ét bytte mellem to etapeløb med samme etapeantal og klasse, uden
  at nogen hård gate går fra grøn til rød, og uden at Division 1 eller Division 4 påvirkes.
- Prisen er en tilsvarende afvigelse på enkeltstarts-målet i samme division. Om den handel er den
  rigtige, er et spildesign-valg og dermed ejerens, ikke et regnestykke.
- Begge divisioner samtidig er ikke muligt med det nuværende katalog. Det er en forsyningsgrænse
  (§5b), og den lukkes kun ved at tilføje flere bjergrige løb til `race_pool` — ikke ved at flytte
  de samme løb rundt mellem divisionerne.

Ingen ændring er foretaget, og intet er valgt. En eventuel ændring af reservations-tabellen er
produktionskode med egne tests og hører til i sin egen PR.

## Reproduktion

```
infisical run --env=prod -- node scripts/dev/bjergdageBytte5405.mjs --season 4 --first-day 2026-09-28
```

Kørslen skriver JSON på stdout og en kort status pr. kandidat på stderr. Den er read-only i alle
kodestier: `dryRun: true` overalt, ingen `--apply`, ingen katalog-mutation.
