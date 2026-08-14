# Falsk alarm på race-motoren, to gange i samme spørgsmål

**Dato:** 2026-08-14 · **Kontekst:** [#3730](https://github.com/NicolaiDolmer/CyclingZone/issues/3730), under en undersøgelse af hvorfor syv nye hold ikke havde løbsresultater

## Hvad der skete

Ejeren spurgte hvordan det kunne være at nogle hold intet havde kørt, når der er løb hver dag. Et fair spørgsmål til en forklaring jeg havde givet for hurtigt.

Jeg svarede med at erklære en produktionshændelse. To gange. Begge gange forkert.

**Første fejl.** Jeg forespurgte `races` og fandt 13 løb med `status = 'scheduled'` og `scheduled_for` i fortiden, op til 70 timer. Jeg konkluderede at løb var gået i stå i tre af fire divisioner og skrev til ejeren at det var "vigtigere end udbetalingen".

`races.scheduled_for` er løbets **STARTtidspunkt**. Et etapeløb bliver liggende som `scheduled` mens dets etaper kører. Et fire-dages løb der startede for 70 timer siden og kører planmæssigt ser i den forespørgsel præcis ud som et løb der hænger.

**Anden fejl.** Da den første var afvist, så jeg at division 4's Tour du Jura ikke havde importeret en etape i 23 timer, mens division 1 og 2 var aktuelle. Jeg kaldte det en hængende etape og bad om lov til at undersøge den.

Løbet kører **én etape i døgnet kl. 18:00**. De 23 timer var afstanden mellem to planlagte etaper. Etape 4 lå halvanden time ude i fremtiden da jeg kaldte den hængende.

## Rod-årsagen

Sandheden om hvornår en etape skal køre står i **`race_stage_schedule`** (`race_id`, `stage_number`, `scheduled_at`, `game_day`). Jeg fandt aldrig den tabel før tredje forsøg, og konkluderede to gange på `races`, som ikke indeholder den information.

Det rigtige spørgsmål er ikke "hvor længe siden skete der noget", men:

```sql
-- Er der en etape der ER forfalden og IKKE har resultater?
select count(*) from race_stage_schedule ss
join races r on r.id = ss.race_id
where r.season_id = <aktiv sæson>
  and ss.scheduled_at < now()
  and not exists (
    select 1 from race_results rr
    where rr.race_id = ss.race_id and rr.stage_number = ss.stage_number
  );
```

Kørt 14/8: **0 forfaldne etaper og 0 forfaldne endagsløb i alle fire divisioner.** Motoren var fuldt ajour hele tiden.

## Læringen

**"Timer siden sidste hændelse" er meningsløst uden kadencen.** 23 timer er alarmerende for et system der tikker hvert 5. minut og fuldstændig normalt for et der tikker én gang i døgnet. Målingen skal være "er noget forfaldent og ikke sket", ikke "hvor længe siden".

**Find tidsplans-tabellen før du erklærer en forsinkelse.** Et statusfelt plus et starttidspunkt er ikke en tidsplan. Hvis jeg ikke kan pege på rækken der siger hvornår noget skulle være sket, har jeg ikke grundlag for at sige at det er forsinket.

**En falsk alarm på et live system er ikke gratis.** Jeg afbrød en opgave ejeren netop havde godkendt ("Kør udbetalingen") med "Stop, jeg kører ikke udbetalingen nu". Havde han ikke spurgt igen, ville jeg have brugt hans tid på en hændelse der ikke fandtes. [[feedback_runtime_verify_first]] gælder også, måske især, når fundet ser alvorligt ud: hastværket med at advare er præcis dér verifikationen ryger.

## Forward-guard

`docs/DOMAIN_REFERENCE.md` bør sige at `races.scheduled_for` er starttidspunktet og at etape-tidsplanen ligger i `race_stage_schedule`, så den næste der undersøger et "hængende" løb ikke går samme vej. Selve motoren fejler ikke og har ikke brug for kode-ændringer.

## Det ægte fund fra samme undersøgelse

Feltet til et etapeløb trækkes når løbet starter. Et hold der tilmelder sig midt i et flerdages løb er ikke i feltet og venter til det næste løb starter forfra, hvilket kan være op til tre døgn. Fladen forklarer det ikke. Det er ikke en motorfejl, men det er et onboarding-hul af samme slags som #3730 selv handlede om.
