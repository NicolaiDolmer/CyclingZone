# Indfasningsplan for værdiskiftet — uge for uge, rollback, udmelding

> **Ejer-direktiv 24/9 aften** (#5497, kommentar 17:03): der skal foreligge en
> nedskrevet indfasningsplan for værdiskiftet, uge for uge, FØR kørslen. Dette
> dokument er den plan. Det er en beskrivelse af rækkefølgen, ikke en kode-spec —
> selve beregningen hører til #5497/#5502 (typefri model) og
> `docs/runbooks/5443-ekstraordinaer-vaerdikoersel.md` (selve kørslen).
>
> **Hard rule 17:** ingen tal fra tørkørsler, ingen holdnavne, ingen rytter-id'er
> herunder. Konkrete tal og navne står i den private rapport (ejeren har den).

## 1. Hvad skifter, og hvad ejeren har låst

Ejer-direktivet 24/9 aften (#5497) samler fire tidligere enkelt-beslutninger til
**ét skifte, kørt på én gang**. Ejerens egen formulering: *"Alt på én gang fra
start... Ingen mellemmodel først; spillerne må ikke opleve at modellen laves om
igen og igen."*

Låst, ikke til diskussion i denne plan:

1. **Typefri grundværdi.** To ryttere med samme evner, alder og øvrige
   godkendte input får samme grundværdi, uanset `primary_type`/`valuation_type`/
   `best_role`. Dette er R1-R5 fra #5497, leveret dev-only i #5502.
2. **Markedet tæller med fra første aktivering**, med lille vægt og et loft pr.
   rytter (ejer-valg 22/9, #5497-kommentar). Vægten er lille ved start og kan
   øges i senere, separate ejer-go — den stiger ikke af sig selv i denne plan.
3. **Elitepræmien udfases i fire lige trin, ét pr. søndagskørsel**: 100 % → 75 %
   → 50 % → 25 % → 0 %. Efter fjerde søndag er eliten prissat på præstation
   alene, uden præmie-tillæg. Ejerens egen formulering: *"falder stille og
   roligt i værdi over en periode, så det hele kommer over i en ny normal
   tilstand snart."*
4. **Kun eliteudfasningen sker i trin.** Alt andet i skiftet (typefri
   grundværdi, den lille markedsvægt, prognose-rettelsen for udvikl-og-sælg)
   sker i sin helhed på selve kørselsdagen (#5461), ikke gradvist.
5. **Løn følger ikke værdi.** `rider_production_value_model` bliver stående på
   `v4`, uanset hvor langt eliteudfasningen er nået, indtil kontraktforlængelser
   ved sæsonskiftet er overstået (egen, senere ejer-beslutning — se afsnit 2).
6. **Managerholds ryttere ændrer sig også**, ikke kun frie/AI-ryttere. Det var
   ikke tilfældet for den tidligere korrektion 20/9 (kun 396 ryttere på
   managerhold), og ejeren har eksplicit bekræftet at det skal være anderledes
   denne gang (24/9-direktivet, punkt 3).

**Ikke besluttet i denne plan** (se afsnit 7): om ryttertype-visning
(`primaryTypeMode`, #5327) skal med samme dag eller vente.

## 2. Tidslinjen som rækkefølge, ikke datoer

Rækkefølgen herunder er bindende; kalenderdatoer i den er kun eksempler fra
`SEASON_CUTOVER_RUNBOOK.md`s S4-tændingsplan (#5506) og flytter sig, hvis den
plan flytter sig.

1. **Gaten:** admin-forhåndsvisningen (#5686) viser hele populationens værdi
   før/efter for den valgte model, inklusive trin-planen herunder, så ejeren
   ser uge 1-4 før han siger noget. Ingen kørsel starter uden denne side.
2. **Ejeren siger "kør"** på tallene fra tørkørslen (samme ordret-krav som
   `docs/runbooks/5443-ekstraordinaer-vaerdikoersel.md` trin 6).
3. **Udmeldingen postes aftenen før** kørslen (Discord, kun EN, se afsnit 6).
   Værdi-deltaer sammenligner mod forrige værdi, så kørslen skal se ud som en
   ægte ændring på hver profil — beskeden skal derfor være ude, før nogen
   rytter flytter sig.
4. **Kørselsdag (trin 0):** den ekstraordinære kørsel (#5443-runbooken). Her
   sker alt det ikke-gradvise fra afsnit 1 punkt 1, 2, 4 — typefri grundværdi,
   markedsvægten, prognose-rettelsen — samt elitepræmiens **trin 0 = 100 %**
   (uændret præmie, kørslen ændrer intet ved selve udfasningen endnu).
   Kørselsdagen ligger uden for søndag (scriptet nægter om søndagen), altså
   fredag eller lørdag i ugen op til sæsonskiftet.
5. **Søndag 1 (trin 1, 75 %):** den førstkommende ordinære søndagskørsel
   (`sundayValueSweep.js`, §9.1 punkt 1 i `ECONOMY_RULES.md`) regner nu med den
   nye nøgle og elitepræmien nedskaleret ét trin. Ifølge S4-tændingsplanen
   falder denne søndag sammen med **søndag 27/9 kl. 06 — sidste ordinære
   søndagskørsel i S3, samme dag som sæsonskiftet kører om aftenen** (trin 11
   og trin 12 i `SEASON_CUTOVER_RUNBOOK.md`). Rækkefølgen den dag er: søndags-
   kørslen kl. 06 (trin 1 af denne plan) → cutover om aftenen. Sæsonskiftet
   rører ikke rytterværdier; det slår kontrakter, sponsorer, løn, pension og
   formnulstilling om.
6. **Søndag 2 (trin 2, 50 %):** første søndagskørsel i S4 (mandag 28/9 og frem
   er S4 aktiv). Ingen særlig håndtering — søndagsreglen er uændret af
   sæsonskiftet (§9.1 note: "IKKE gated af `no_active_season`").
7. **Søndag 3 (trin 3, 25 %).**
8. **Søndag 4 (trin 4, 0 %):** eliten er nu prissat på præstation alene. **Ny
   normal** fra denne søndag.
9. **Ny normal:** ingen yderligere trin. Fremtidige justeringer (fx en højere
   markedsvægt, jf. afsnit 1 punkt 2) er separate, senere ejer-beslutninger,
   ikke en fortsættelse af denne plan.

**Forhold til sæsonskiftet (27-28/9):** værdikørslen (trin 8, H2 i
`SEASON_CUTOVER_RUNBOOK.md`) og rating-omlægningen (trin 9, H4) samt merge af
#5461 (trin 10, H3) ligger alle i runbookens **Fase A, før cutover** — altså
før kørselsdagen i denne plan overhovedet kan regnes som "trin 0". Lønnøglen
(`rider_production_value_model`) rører sæsonskiftet slet ikke i denne plan:
den flippes som sin egen beslutning **efter** kontraktforlængelserne, uanset
hvor langt elitetrinnene er nået. Det betyder at værdi og løn kan divergere
synligt i flere uger — det er meningen (afsnit 1 punkt 5).

## 3. Hvad spilleren ser hver uge — og hvad der ikke ændrer sig

**Ser hver uge (trin 0-4):**
- Rytterprofilen: ny værdi, synlig med op/ned-pil mod ugen før.
- Marked/auktion: startprisloftet (1× `market_value`) følger den nye værdi.
- Holdværdi: summen på holdsiden flytter sig i takt med rytterne.
- Fra trin 0: type-badget viser stadig rytterens type, men typen påvirker ikke
  længere prisen (kun den kosmetiske visning, indtil #5327 evt. besluttes,
  se afsnit 7).

**Ændrer sig ikke:**
- **Lønkrav.** Ingen kontrakt-forhandling ser en anden pris pga. denne plan.
- **Rating.** Rating-omlægningen (trin 9, H4 i sæsonskifte-runbooken, "bedste
  rolle nu") er en separat mekanik, tændt samme dag som kørslen, men styret af
  sit eget flag og sin egen kontrol — ikke af elitepræmiens trin.
- **Underskrevne kontrakter.** Rørt aldrig af nogen del af skiftet.

## 4. Rollback pr. trin

Grundmekanikken er den samme som i `5443-ekstraordinaer-vaerdikoersel.md`:
nøgle tilbage, backup-tabel, sunday-log-mutex. Den gælder trin 0 direkte; trin
1-4 er almindelige søndagskørsler og bruger derfor den almindelige søndags-
logik, med én vigtig forskel beskrevet nedenfor.

- **Nøglen:** `app_config.rider_valuation_model` sættes tilbage til `'v4'`
  (samme statement som runbookens trin 9). Nøglen læses ved hver kørsel, ikke
  ved boot — sæt den tilbage **med det samme** en rollback besluttes, ellers
  regner den førstkommende søndagskørsel videre med den nye model.
- **Backup-tabellen** (`backup_5443_value_event_20260920`) dækker de seks
  kolonner fra trin 0's snapshot: `base_value`, `current_production_value`,
  `primary_type`, `secondary_type`, `best_role`, `best_role_rating` — **taget
  før trin 0**, ikke før hvert enkelt søndagstrin.
- **Søndags-log-mutex** (`rider_value_sunday_log`): samme claim-mekanisme som
  den ordinære søndagskørsel bruger. Én kørsel pr. dag; en afvist/afbrudt
  kørsel frigiver claimet igen (§9.1 i `ECONOMY_RULES.md`), så samme søndag kan
  forsøges igen samme dag.
- **Hvad der IKKE kan rulles tilbage:**
  - **Handler indgået efter kørslen.** En rytter der er handlet til en pris
    baseret på en værdi fra trin 2, får ikke handlen omgjort, selvom værdien
    senere rulles tilbage.
  - **Rullet tilbage sent i planen ≠ rullet tilbage til forrige trin.**
    Backup-tabellen har kun ét snapshot, taget før trin 0. En rollback besluttet
    fx efter trin 3 fører alle seks kolonner (`base_value`,
    `current_production_value`, `primary_type`, `secondary_type`, `best_role`,
    `best_role_rating`) tilbage til **før-skifte**-tilstanden — ikke til trin
    2's tilstand. Det betyder at almindelig værdiudvikling i mellemtiden (fx
    hvis `base_value` eller `best_role_rating` har flyttet sig af andre
    årsager end selve skiftet) **overskrives** af rollbacken, ikke bevares.
    Kun felter uden for de seks navngivne kolonner er upåvirket.
  - **Rating-omlægningen (trin 9, H4)** har sin egen kontakt og rulles
    separat tilbage (flag off), ikke som en del af værdi-rollbacken.
- **Hvem siger go:** ejeren, ordret — samme krav som resten af kørslen. Ingen
  automatisk rollback ved et "grimt" tal; det kræver et eksplicit ejer-valg,
  ligesom trin 0.

## 5. Trin-tælleren (forslag, ikke besluttet)

Systemet skal vide, hvilket af de fire elite-udfasningstrin en given søndag
befinder sig på, for at kunne skalere præmien korrekt. To kandidater — **valg
for Lane B/#5497, ikke afgjort her:**

1. **En `app_config`-nøgle**, fx `rider_value_phase_in_step` (heltal 0-4),
   sat til 0 ved trin 0 og talt op med ét ved afslutningen af hver efterfølgende
   søndagskørsel, indtil den rammer 4 og bliver stående. Simpel at læse og
   teste, men er endnu en manuelt vedligeholdt tilstand ved siden af
   `rider_valuation_model`.
2. **Optælling af `rider_value_sunday_log`-rækker siden skiftet**: antal
   `run_date`-rækker med `run_date > <kørselsdagens dato>` og `completed_at`
   sat. Kræver at søndagskørslen selv slår trinnet op i en anden tabel end
   den, den skriver til. **Ikke selvhelende ved rollback:** rollbacken
   (afsnit 4) sletter ikke de allerede fuldførte log-rækker efter kørselsdagen,
   så en optælling ville stadig se de gennemførte trin og regne videre derfra,
   selvom rytterfelterne er ført tilbage til før-skifte-tilstanden. Vælges
   dette forslag, skal rollback-vejen udvides med et eksplicit skridt der
   enten sletter/markerer de berørte log-rækker eller sætter en separat
   "nulstillet ved dato"-markør — ellers tæller trin-tælleren forkert efter en
   rollback.

Begge forslag skal derfor vurderes mod, hvordan en rollback (afsnit 4) påvirker
tælleren: en `app_config`-nøgle kræver at nogen eksplicit nulstiller den til 0
ved samme lejlighed som nøgle-flippet; en log-optælling kræver den ekstra
rollback-udvidelse beskrevet ovenfor. Ingen af de to er automatisk korrekte
ved en rollback uden det skridt.

## 6. Udmeldingen

`docs/drafts/2026-09-20-vaerdiskifte-udmelding-og-patch-note.md` afsnit 1 (den
generelle Discord-udmelding) og afsnit 3 (patch note til selve kørselsdagen,
delt via #5461) er skrevet til **ét spring uden trin**. Begge skal have én
sætning tilføjet, der forbereder spilleren på at eliteprisen falder gradvist —
uden datoer eller tal (roadbook-reglen). Resten af begge tekster holder,
inklusive løftet om "kun søndage igen bagefter".

**Discord, #the-roadbook (EN) — tilføjelse til det eksisterende udkast, sat ind
efter afsnittet om "Everyone at once":**

> One part of this does not land all at once. The riders at the very top had
> an extra premium built into their price, on top of what their racing
> actually earns. That premium is stepping down gradually over the following
> Sundays, until it is gone and the price is performance alone. You will not
> see a cliff — just their price settling a little more each week.

**Discord, #the-roadbook (DA):**

> Én del af det her lander ikke på én gang. Rytterne helt i toppen havde en
> ekstra præmie bygget ind i deres pris, oven i det deres resultater reelt
> tjener. Den præmie glider ned over de følgende søndage, indtil den er væk,
> og prisen er præstation alene. Du kommer ikke til at se et fald på én gang —
> bare deres pris, der falder lidt mere hver uge.

**#5461-patch noten (kørselsdagen):** teksten "every rider is priced as the
type he is today" skal justeres, fordi grundværdien nu er typefri, ikke
type-genberegnet. Forslag til den ene sætning der ændres, resten af noten
(EN+DA) fra #5461 holder uændret:

- **Før (#5461):** *"A rider's value is calculated from the same abilities as
  his rating, and every rider is priced as the type he is today."*
- **Efter (forslag):** *"A rider's value is now calculated the same way for
  every rider, based on ability, age, and expected career — not on which type
  he plays."* / DA: *"En rytters værdi regnes nu ens for alle ryttere, ud fra
  evner, alder og forventet karriere — ikke ud fra hvilken type han spiller."*

En sætning om den gradvise elitepræmie, i samme stil som Discord-tilføjelsen
ovenfor, bør tilføjes patch noten som sidste sætning før "Wages did not
change". Endelig ordlyd afventer #5461-branchens egen behandling (den PR ejes
ikke af denne plan, se `docs/runbooks/5443-ekstraordinaer-vaerdikoersel.md`
trin 10).

## 7. Åbne ejer-valg (ét pr. linje)

- **Ryttertype-visning til alle** (#5327, `primaryTypeMode`): sammen med
  kørslen, eller først senere — uafgjort 24/9, afventer at admin-siden (#5686)
  viser tallene.
- **Trin-tælleren** (afsnit 5): `app_config`-nøgle eller log-optælling.
- **Markedsvægtens fremtidige stigning** (afsnit 1 punkt 2): ingen dato eller
  trin i denne plan — separat ejer-go, når det bliver aktuelt.
- **De to grænser valg 3 gør røde i den nye normal** (jf. #5502-body:
  udvikl-og-sælg net-positiv for den dyreste prospect, elite-rangorden mod
  niveauet under): omformulere grænserne til den nye normal, eller acceptere
  som kendt konsekvens af elitepræmiens udfasning.

## 8. Tjekliste, post-verify pr. trin

Kør efter **hver** af de fem kørsler (trin 0-4). Ingen af disse forventes at
returnere prod-tal i repoet — kør dem, læs resultatet, og skriv kun
konklusionen ("grønt"/"stop, se privat rapport"), aldrig selve tallene, i
issue-kommentarer eller PR'er.

**Trin 0 (kørselsdagen — samme kontrol som `5443-ekstraordinaer-vaerdikoersel.md` trin 8):**

```sql
select run_date, scanned, changed, written, completed_at
  from public.rider_value_sunday_log
 order by run_date desc limit 1;

select count(*) from public.backup_5443_value_event_20260920;
-- forventet: hele den aktive population

select count(*) as loengrundlag_flyttet
  from public.riders r
  join public.backup_5443_value_event_20260920 b on b.rider_id = r.id
 where r.current_production_value is distinct from b.current_production_value;
-- forventet: 0, saa laenge loennoeglen staar paa 'v4'
```

**Trin 1-4 (hver efterfølgende søndag):**

```sql
select run_date, scanned, changed, written, completed_at
  from public.rider_value_sunday_log
 order by run_date desc limit 1;
-- forventet: dagens dato, completed_at sat, ingen fejlraekke

select key, value from public.app_config
 where key in ('rider_valuation_model', 'rider_production_value_model');
-- forventet: vaerdi-noeglen paa den nye model, loen-noeglen fortsat 'v4'
-- indtil sæsonskiftets kontraktforlaengelser er overstaaet

select count(*) as loengrundlag_flyttet
  from public.riders r
  join public.backup_5443_value_event_20260920 b on b.rider_id = r.id
 where r.current_production_value is distinct from b.current_production_value;
-- forventet: 0
```

Kontrollér desuden i appen (alle trin): et rytterkort viser samme værdi som
databasen, og markedets startprisloft følger den. Fra trin 4: ingen elite-
tillæg tilbage — stikprøvekontrollen er at den dyreste rytter i toppen af
listen ikke længere skiller sig unaturligt ud fra dem lige under.

---

**Se også:** afsnittet "Indfasning uge 1-4" i
`docs/runbooks/5443-ekstraordinaer-vaerdikoersel.md` (kort henvisning til denne
plan, ikke en duplikering af den).

Refs #5689 #5497 #5443 #5461 #5686
