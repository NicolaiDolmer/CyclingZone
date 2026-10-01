# #5957: Underpræsterer specialisterne i v4? Rod-årsag og rettelse

Dato: 2026-10-01. Refs #5957. Rapporten er kvalitativ (repoet er offentligt); de præcise tal ligger privat i `balance-internals/5957/`.

## Kort svar

Ja, og årsagen sidder i motoren, ikke i data. I v4's finale lægges dagens tillæg (restreserve, dagsform og indsats) oven på rytterens finale-evne som et fast tal for alle ryttere. Det tal er af samme størrelse som evne-forskellen mellem en spurter og en hjælperytter i et rigtigt divisionsfelt. Favoritten vinder stadig ofte, men resten af feltet bag ham bliver næsten tilfældigt ordnet: holdets bedste spurter kan ende langt bag en frisk hjælperytter. Det er præcis det spillerne beskriver.

Rettelsen: tillæggene følger nu evnen. Alle reelle kandidater får dem fuldt ud (favorit-opgøret er uændret), mens en rytter uden finale-evne ikke længere kan hoppe frem på friskhed og en god dag alene.

## Undersøgelsen (1/10, prod read-only)

Korrelation mellem den relevante evne og placeringen pr. etapetype faldt markant fra S3 (v3) til S4 (v4) på flad, rullende, kuperet og brosten; bjerg faldt mindre, og enkeltstarten var uændret eller bedre. Udbrud forklarede ikke faldet: uden udbrudsrytterne var korrelationen næsten den samme. Flip-gatens syntetiske ankre fangede det ikke.

## Rod-årsag: motor, ikke data

Prod-genafspilningen fra `entrant_snapshot` + seed kunne ikke køres i denne lane (prod-læsning var ikke tilladt i sessionen); scriptet `backend/scripts/dev/replay5957.mjs --fetch` står klar til det. I stedet blev motoren og data skilt ad offline på den pinnede prod-population (`population-snapshot-2026-09-24.json`):

1. **Samme ryttere, samme etaper, v3 mod v4:** v4 ordner feltet markant dårligere end v3 på flade og rullende etaper, også uden ordrer. Problemet findes altså i motoren alene.
2. **Roller og AI-ordrer** ændrer næsten intet. Holdspillet er ikke årsagen.
3. **Prod-lignende felter** (ét felt pr. liga-division i stedet for et tilfældigt udsnit af hele populationen) giver samme mønster som prod: flad værst, bjerg mellem, enkeltstart uændret. Divisionsfelter har smallere evne-spredning, så et fast tillæg fylder relativt mere. Det forklarer hvorfor flip-gaten (bredere felter) så pænere tal end prod.
4. **Hvor i motoren:** næsten hele feltet ankommer samlet på flade etaper, og vinderen er næsten altid den rigtige spurter. Fejlen sidder i rækkefølgen bag vinderen. Fjernes dagsform- og reserve-tillægget i finalens placeringsscore, kommer korrelationen helt tilbage over v3's niveau. Hver af de to bidrager.

Dagsform-tillægget kom med #5804 (27/9) for at favoritten ikke skulle vinde næsten deterministisk. Det mål var rigtigt, men tillægget ramte hele feltet, ikke kun kandidaterne.

## Rettelsen

`finale.ts`: reserve, dagsform og indsats ganges med en skala mellem 0 og 1. Skalaen er fuld for alle ryttere over en andel af puljens bedste finale-evne og falder proportionalt under den. Et gulv under referencen holder scoren monotont stigende i evnen (testet med fast-check). Puljens favorit og hans reelle rivaler har uændrede tillæg, så favorit-sejrsraten i flip-gaten er den samme som før rettelsen.

Ny tuning i `tuning.ts` (to linjer i finale-blokken): gulvet og kandidat-andelen. Andelen blev valgt som den værdi, hvor favorit-sejrsraten i flip-gaten er uændret.

## Målt effekt (offline, pinnet prod-population, divisionsfelter, AI-ordrer)

- Flad: fra klart under v3 til v3-niveau eller lidt over.
- Kuperet og rullende: tydeligt bedre, på eller over v3.
- Bjerg og høj bjerg: bedre.
- Brosten: bedre, men stadig under v3. Brostensevnens eget løft i v4 er fortsat cirka halvdelen af v3's (et særskilt fysik-spørgsmål om sektorerne, ikke finalen). Foreslås som opfølgning.
- Enkeltstart: uændret (enkeltstart går ikke gennem dette opgør).
- Flip-gatens øvrige ankre: uændret dom på alle (felt-sammenhæng, sprinter-vinderrate, punch- og ITT-korrelation, nedkørsel, bonussekunder). Favorit-sejrsraten er uændret.

## Gate

`backend/scripts/dev/replay5957.test.mjs` er et korrelationsanker på prod-lignende divisionsfelter fra den pinnede prod-population, med AI-roller og -ordrer. Det kræver at v4 rangerer specialisterne efter evnen på flad, kuperet/rullende, brosten/klassiker, bjerg og enkeltstart. Ankeret fejler på motoren før rettelsen (flad) og er grønt efter. Det kører i backend-suiten (få sekunder).

## Klassifikation

**Beregningsfejl** (release-princippet i `backend/lib/raceEngineRulesRevision.ts`): tillæggene var ment som dagens modifikator af rytterens finale, ikke som en evne der kan overtrumfe specialisten. Favorit-opgøret, som #5804 kalibrerede, er uændret. Rettelsen må derfor gælde fra næste ikke-kørte etape, også midt i et løb. Vurderer ejeren den som ny balance, skal den i stedet bag en ny regel-revision og kun gælde nye løb.

## Golden fixtures

Regenereret fra uændret `input.json`. Vinderen er den samme i alle scenarier:
- `flat-massespurt`: rækkefølgen bag vinderen i det samlede felt flytter sig (ryttere med mindre finale-evne får mindre tillæg).
- `bjerg-selektion`: to ryttere med samme tid i en klump bag de første bytter plads (og dermed et par point), fordi rækkefølgen inden for klumpen nu læser den skalerede score.
- `nedkoerselsfinale`: kun sidste decimal i ét gap-tal (flydende-tals-rækkefølge i den nye formel); ingen placering ændret.
- `punch-finale-forspring` og `itt-solo`: uændrede.

## Hvad dette ikke dækker

- Ingen genafspilning af selve S4-prod-etaperne (prod-læsning ikke tilladt i lanen). Næste skridt: kør `replay5957.mjs --fetch` og derefter replay mod cachen, og mål S4-korrelationen igen efter 60+ etaper på den nye motor.
- Prod-felter har også træthed, menneskers indsatsvalg og udbrud, som divisionsfelterne kun delvist efterligner. Prod kan derfor ligge lidt under de offline tal.
- Brostensløftet (se ovenfor) og udbruddenes størrelse (#5914/#5951) er særskilte spor.
