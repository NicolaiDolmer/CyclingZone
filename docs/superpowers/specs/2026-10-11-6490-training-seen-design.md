# #6490: Billigt opslag af tidligere træningshistorik

Status: design til ejerreview, 11/10/2026. Ejeren valgte A og bestilte dette design
med testplan i Codex. Det er ikke build-, merge- eller prod-go. **GIN-indekset må
først slettes efter særskilt ejer-go til den konkrete handling.**

Refs [#6490](https://github.com/NicolaiDolmer/CyclingZone/issues/6490).
Mandat og målinger er gemt i
[issuekommentaren](https://github.com/NicolaiDolmer/CyclingZone/issues/6490#issuecomment-6113605453).

## 1. Formål, SSOT og afgrænsning

Gør historikværnet billigt at vedligeholde, så træningsafregningen belaster resten
af spillet mindre. Første leverance erstatter kun JSON-opslaget i
`training_day_runs` med `rider_training_seen`. Den samlede ambition er 10×
spillere; dette trin er ikke i sig selv bevis for 10× kapacitet.

Bindende SSOT: [TRAINING_RULES](../../TRAINING_RULES.md), især
førstegangsregistrering, kompensation og atomisk datoafregning. Adgang følger
[DATA_API_GRANTS](../../DATA_API_GRANTS.md) og migrationer
[MIGRATIONS](../../MIGRATIONS.md). Spilleradfærd følger det godkendte
[Træn nu-design](2026-09-29-traen-nu-og-prognose-design.md).
Implementerings-PR'en skal opdatere TRAINING_RULES med den nye opslagkontrakt.

Spilleren beholder samme udbytte, historik, rapporter, låse og afregningstidspunkt.
Ingen ændring af træning kontra løb, sidste slots afregning, form, træthed eller
skader. Ingen højere parallelitet, ny jobkø, historikfjernelse eller batching af
selve træningsmotoren i A. Ønsket om mere omgående respons består på #6490 og
kræver et efterfølgende ejerkort; det er ikke afgjort ved valg A.

## 2. Verificeret grundlag og begrænsninger

Read-only prod 11/10 kl. 22:44–22:45 CEST; koden undersøgt på `2956b649f`.

| Observation | Værdi og fortolkning |
|---|---|
| `idx_training_day_runs_report_riders` | 887185408 bytes, vist som 846 MiB; 28 scans |
| Indeksdefinition | GIN på hele `report->'riders'`, `jsonb_path_ops` |
| `training_day_runs` | Heap 14 MiB; total 1256 MiB inkl. TOAST og indekser. Heap alene er ikke rapporternes størrelse |
| Afregningens hovedkald | 8071 kald, 8425232903 WAL-bytes, 1043890 bytes/kald; middel 286,7 ms, maksimum 45538 ms |
| Statistikperiode | Kumulativ siden 6/10 13:53:26 UTC; ikke en frisk aften-delta eller percentiler |
| Aftenens rapportskrivninger | 1381 assistant-ticks, første 20:04:18 og sidste 20:34:56 CEST; tidsintervallet isolerer ikke GIN-arbejdet |
| Datoarbejde | 260 complete, 2 needs_reconciliation; disse to er ikke forklaret af indeksmålingen |
| Træn nu | Flag on; 18 hold, 72 manager-ticks. Koden afregner afklarede ryttere på de første fire slots |

GIN er en stærk flaskehalshypotese: mange rapportfelter indekseres for et simpelt
eksistensopslag. Pending-list-oprydning kan give dyre enkeltkald, jf.
[PostgreSQL GIN](https://www.postgresql.org/docs/17/gin.html).
Hverken den præcise GIN-andel eller den nye løsnings gevinst er isoleret endnu.
Lineær fremskrivning af WAL er et estimat, ikke en loadtest.

Tre aktuelle databasefunktioner bruger containment-opslaget:
`register_training_date_work`, `initialize_first_use_rider_condition` og
`apply_training_compensation_6061`. Issuets fem historiske henvisninger er ikke
fem forskellige levende funktioner. Andre fund skal også håndteres:

| Kaldested | Behandling før indeksfjernelse |
|---|---|
| De tre funktioners eksistensværn | Erstat kun det eksisterende JSON-led med det nye opslag |
| `scripts/trainingRecovery5928.apply.mjs` | Eksistensværn flyttes; øvrig rapportvalidering og rollback bevares |
| `scripts/trainingRecovery5928.snapshot.sql` | Tæller rapportreferencer; brug den tilsvarende tæller, ikke blot et boolean |
| `backend/scripts/dev/prepare6061TrainingRecovery.mjs` | Henter faktiske historiske rapporter. Bevar korrekt resultat og mål en eksplicit administrativ læsevej uden GIN; en boolean kan ikke erstatte data |
| Rapportvisning, peak-planer og øvrige dato-/holdopslag | Bevar semantik; bevis planer uden afhængighed af GIN |

Writer-audit skal omfatte normalized RPC, legacy `dailyTrainingEngine.js`,
`repair5912LostTraining.mjs`, recovery apply/rollback, `betaResetService.js`,
FK-cascades og staging-restore. Auditten gentages mod den aktuelle kode og
`pg_proc`, før læserskift og igen før drop. Ukendte brugere er en stopgrund.

## 3. Datakontrakt

`public.rider_training_seen` er et afledt indeks, ikke en ny træningskvittering.
Én række pr. historisk set rider_id-streng, med samme tekstsemantik som JSON:

- `rider_key text COLLATE "C" PRIMARY KEY`.
- `report_count bigint NOT NULL CHECK (report_count >= 0)`.
- Det nye svar er `report_count > 0`. En række med nul beholdes som tombstone;
  hverken rækkens eksistens alene eller dens oprettelsestid betyder træning.

Tælleren svarer præcist til antal **rapport-rækker**, hvis riders-array indeholder
det pågældende rider_id, også ved dublerede rider-elementer i samme rapport.
Kilden er kun det tidligere JSON-prædikat, ikke union med ticks, kompensation eller
belastninger. De andre historikværn består uændret. Tomme reservationer, manglende
riders og tomme arrays bidrager ikke. Ingen filterændring for dato, sæson, trup,
ejer, complete eller legacy: det gamle prædikat havde ingen af disse filtre.

Bevar JSON-match nøjagtigt. Registrering og first-use søger med kanonisk
uuid-tekst, men kompensationsfunktionen bruger `item->>'rider_id'` ordret i dette
ene værn, selv om andre værn caster til uuid. Derfor skal nøglen være tekst:
ekstraktionen bevarer rider_id-strenge ordret, uden uuid-cast, lowercase eller
anden normalisering. Hver læser konstruerer sin søgestreng som før. Store bogstaver
og UUID uden bindestreger må ikke blive nye hits. Gem kun rider_id-strenge fra
objekter i riders-arrayet; tal, null og andre typer må ikke blive strenge ved
coercion. Inventér JSON-typer før byg og test begge sider af sammenligningen.
Ingen FK til `riders`: historiske rapportreferencer kan overleve en rytter, og
indekset skal kunne repræsentere dem. Tælleren ændrer ingen øvrig validering i
kompensationsfunktionen.

RLS er slået til, ingen klientpolicies eller grants til PUBLIC/anon/authenticated.
Deklarér service_role SELECT/INSERT/UPDATE efter grants-kontrakten. Triggeren
foretrækkes som SECURITY INVOKER; eksisterende RPC-ejere og service_role skal testes
med deres faktiske rettigheder. Ingen ny klient-RPC eller auth-omgåelse.

## 4. Atomisk vedligeholdelse og genoptagelig backfill

Et permanent boolean alene ville blive forkert ved reset/rollback, som faktisk
findes i repoet. Tælleren bevarer det gamle svar også efter sletning eller
udskiftning af den sidste rapportreference.

Tilføj intern `training_day_runs.training_seen_indexed boolean NOT NULL DEFAULT
false`. Den betyder alene, at rækkens nuværende medlemskab indgår i tælleren.
Det er en teknisk migrationsmarkør, aldrig spillerstatus. Ingen nyt indeks på den
store JSON-værdi; et midlertidigt backfill-indeks er kun aktuelt efter måling.

Installation af markør, tabel og triggere sker atomisk, idempotent og med kort
lock-timeout. Hvis DDL-låsen ikke kan fås, afbrydes og genforsøges uden for
belastningsvinduer; ingen lang ventende DDL-kø. GIN og gamle læsere består.

Ved insert/update sætter en lille BEFORE-trigger markøren true. AFTER STATEMENT-
triggere for INSERT, UPDATE og DELETE bruger transition tables til at beregne
nettoændringen i antallet af rapportreferencer pr. rytter. UPDATE har ingen
`UPDATE OF`-kolonneliste, da PostgreSQL ikke tillader den sammen med transition
tables. Regler:

1. OLD bidrager kun, hvis OLD-markøren var true; NEW bidrager, når NEW er true.
2. Unikke rider_key-strenge pr. rapport; aggregér alle rækker i statementet før skrivning.
3. Netto nul giver ingen counter-update. Lås/opdatér rider_key i fast C-sorteringsorden;
   bevar den eksisterende writers lock-orden og test blandede writers.
4. Positive deltaer indsætter eller øger; negative deltaer kræver en eksisterende
   række og må ikke give negativ tæller. En negativ delta må ikke gå gennem en
   INSERT, der bryder CHECK, før ON CONFLICT overhovedet nås.
5. Rapport, markør og tællere committer eller ruller tilbage sammen. En fejl må
   ikke efterlade afregning uden indeksbevis eller omvendt.

Backfill vælger små batches af marker=false-rækker med row locks og SKIP LOCKED
og sætter markøren true. Samme trigger tilføjer præcis én gang. Et samtidig
report-update indlemmer selv en gammel række; et delete af en ikke-indlemmet
række trækker intet fra. Retry ser markøren og tæller ikke igen. Tomme rapporter
markeres også, så backfill kan afsluttes. Brug fuld gentagen scan efter udtømning;
en cursor må ikke glemme rækker, som var låste. Batchstørrelse/pause vælges ved
stagingmåling, med stoppelig kørsel og varigt progress-bevis.

TRUNCATE kræver en tilsvarende atomisk nulstilling af tællerne gennem en særskilt
TRUNCATE-trigger. Restore med deaktiverede triggere må ikke annonceres klar:
genopbyg indeksprojektionen og verificér paritet før læsere aktiveres. Reset,
recovery og restore-adaptere testes; ingen af dem køres i prod af dette arbejde.

[PostgreSQL 17 trigger-kontrakt](https://www.postgresql.org/docs/17/sql-createtrigger.html).

## 5. Overgang, stopgrænser og rollback

| Fase | Handling | Bevis før næste fase |
|---|---|---|
| A0 | Ejerreview af dette design og efterfølgende implementeringsplan | Eksplicit build-go; dette dokument udfører intet |
| A1 | Additiv installation og begrænset backfill efter implementerings-PR og prodmandat | Triggere aktive, grants korrekte, ingen falsk klar-markør; gamle læsere og GIN intakte |
| A2 | Sammenlign i konsistent snapshot | Nul uindlemmede rækker; fuld sammenligning af afledte counts og tællere, både manglende og ekstra referencer; alle læserkontrakter testet |
| A3 | Skift de inventerede eksistens-/count-læsere i særskilt migration | Migrationen gentager fuld readiness/paritet før funktionsskift i samme konsistente transaktion; senere writes dækkes atomisk af triggere |
| A4 | Ejerkort med staging-A/B, reader-audit og konkret rollback | **Separat ejer-go før indeksfjernelse i prod** |
| A5 | Kun efter dette go: fjern GIN, post-verificér og mål prod | Ny aften-delta, brugerlatens, fuld afregning og ingen paritetsfejl |

Ingen DROP INDEX i additive migrationsfiler, standard deploy-hooks eller
automatisk cleanup. Drop leveres som separat, reviewet operationshandling knyttet
til ejerens go og præcis indeksdefinition. Det skal afklares mod migrationsrunneren:
`DROP INDEX CONCURRENTLY` må ikke ligge i en transaktionsblok. Følg
[PostgreSQL 17 DROP INDEX](https://www.postgresql.org/docs/17/sql-dropindex.html).
Intet prodarbejde mellem 20:00 og 20:45 eller i etape-tick-vinduet.

Før drop kan læserfunktionerne rulles tilbage til JSON-opslaget, fordi det gamle
indeks og rapporterne er intakte. Behold projektion og triggere, mens rollback
verificeres; de må ikke efterlade fremtidige writes uden optælling.
Efter drop er gammel læserkode alene ikke en performance-rollback: genopbyg GIN
med den gemte definition, verificér validitet og målinger, og skift derefter
læsere efter mandat. Genopbygning koster I/O og tid; den er ikke øjeblikkelig.

## 6. Testplan og accept

Implementeringen er **TIER FULL** (backend/SQL/delte kontrakter): preflight,
`verify-local.ps1`, relevante databaseintegrationstests og uafhængigt review.
Tunge kørsler går gennem `verify-lock.ps1`. Alle tests injicerer et fast ur.
Staging-mutationer kører kun via #5904's isolationswrapper og eksisterende mandat;
ingen benchmarks eller EXPLAIN ANALYZE af writes i prod.

| Test | Krævet resultat |
|---|---|
| Historisk fixture: legacy/normalized, delvis/tom, flere trupper/sæsoner, dublet-id og typer | Nyt boolean og count er identisk med gammelt prædikat; ingen falsk førstegangsregistrering |
| Input × lagret rider_id: kanonisk, uppercase, uden bindestreger, tal/null | Alle læsere bevarer præcis deres gamle JSON-match; især kompensationens tekstinput må ikke normaliseres |
| Insert, samme report igen, udskiftning, sidste reference slettes, rollback, cascade og truncate | Eksakte counts, ingen negative værdier, ingen falske hits eller huller |
| Concurrent backfill/update/delete, afbrudt batch og restart | Hver rapport medregnes én gang; alle rækker indlemmes; intet tab ved SKIP LOCKED |
| Flere hold/ryttere, blandede writers og genforsøg | Ingen nye deadlocks; fejl ruller hele statement/transaktion tilbage; retry giver identisk resultat |
| Klik + sweep, transfer, kompensation og recovery | Bit-identiske evner, tilstand, scores, rapporter og historik før/efter; ingen dobbelt afregning |
| RLS/grants og faktiske RPC-roller | Klientroller afvist; alle tilsigtede writers/læsere fungerer uden udvidet klientadgang |
| Cutover med manglende markør, ekstra/manglende counts eller fejlet kontrol | Skift stopper; gamle funktioner/indeks forbliver brugbare; ingen tavs fallback efter drop |
| Migration to gange, halvfærdig backfill, læserrollback og senere indeksgenopbygning | Genoptagelig og idempotent; dokumenteret recovery uden rapporttab |

### Staging-A/B og kapacitetsmåling

Samme anonymiserede datasnapshot med realistisk historik/rapportstørrelse,
Postgres-version og regnekraft. Brug tre tilstande: baseline, ny projektion med
GIN bevaret, og ny projektion uden GIN på isoleret staging. Nulstil workloadens
data mellem forsøg, ikke prodstatistik. Rapportér ændrede rammevilkår.

Kør mindst tre gentagelser af 1× og 10× workload, både varm cache og et
kontrolleret checkpoint/koldt startscenarie. 10× er ca. 2600 normaliserede hold
med alle trupper og fem slots, ikke blot ti gange samme id. Dokumentér også
legacy/AI-belastningen; dagens rapportantal og normaliserede holdantal er ikke
samme population. Kombinér automatisk lukning, manuelle klik og de eksisterende
spillerlæsninger. Udvid #5904-harnessens eksplicitte træningsoracle og metrikker;
en grøn løbsafvikling alene er ikke et træningsbevis.

Mål separate deltaer for RPC-WAL og hele databasens WAL, indeks-I/O, hold-datoens
fulde sluttid, RPC p50/p95/p99/max, låse/timeouts, DB-belastning samt p95/p99 for
spillernes API-kald. Medregn trigger/backfill-omkostning separat og medregn alle
fem slots ved rapportering pr. hold-dato. Checkpointtilstand skal fremgå.

Hårde korrekthedskrav: nul paritetsafvigelser, nul tabte/dobbelte ticks, nul nye
5xx eller lock-timeouts og alle forventede datoarbejder terminale med korrekt
status. Kendte reconciliation-fixtures skal stadig give samme status.

Foreslået performance-gate til ejerreview: ved 10× må spillerlæsnings p95/p99
højst stige 10 % mod samme læseworkload uden afregning; vis absolutte millisekunder
og alle gentagelser. En støjfyldt eller manglende måling er uafklaret, ikke grøn.
Denne tolerance er et **forslag, endnu ikke et ejer-godkendt mål**.

Issuets ≤50 KB WAL har uklar enhed (hold-dato eller hold-slot). Vis begge enheder;
det bruges ikke som automatisk godkendelse. Samlet lukketidsmål skal også fastlægges
af ejeren ud fra stagingresultatet, før A4/drop-go. Ingen historisk regressionsgrænse
eller 10× fremskrivning kan erstatte de beslutninger. Hvis A ikke opfylder målene,
forbliver #6490 åbent og eftermålingen begrunder næste kort om batching/spredning.

### Hvad ejeren ser

Før release: samlet A/B-rapport med mål og målinger, fuld backfill-/paritetsrapport,
og stagingvisning af samme rytters Træn nu og aftenrapport før/efter. Bekræft samme
udbytte, ventende sidste slot og bevaret historik; almindelig spiller-navigation
skal kunne prøves under 10× afregning. En tester-runde på staging dækker klik,
genforsøg, holdskifte og recovery. Det særskilte drop-kort vedlægger rollback og
de resterende usikkerheder.

## 7. Leverance og close-out

Dette commit indeholder kun design. Ingen SQL køres, ingen featureflag tilføjes,
og ingen spillertekst ændres. Patch notes og FEATURE_REGISTRY er ikke nødvendige
for designleverancen. Implementeringen ajourfører TRAINING_RULES og nødvendige
genererede databasetyper i samme PR; vurder spillerrettet patch note ved release.
Ingen NOW/MASTERPLAN-ændring fra Codex. Evidens og ejerbeslutninger gemmes på
#6490. Denne delleverance lukker ikke kapacitets- eller oplevelseskravet i issuet.
