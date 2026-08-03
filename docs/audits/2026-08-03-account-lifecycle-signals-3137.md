# Account-livscyklus-signaler (#3137) — audit 2026-08-03

Del af epic #3131 (fair play). Bygger 6 selvstændige, testbare SQL-signaler for
konto-livscyklus, der fanger "fair-pris-tragten" fra #3137's issue-body: en
handel kan være prissat 100% korrekt og alligevel være en angrebsvektor, fordi
ingen af de fire prisbaserede regler i #2226 måler kontoens alder, adfærd
eller retur-mønster. Signalerne leverer evidens til scoringen i #3138 — de er
IKKE selvstændige flag.

Alle queries er read-only SELECT, kørt mod prod (`ghwvkxzhsbbltzfnuhhz`) via
Supabase MCP, sidste 90 dage (reelt data findes tilbage til ca. 2026-06-22,
~42 dage, da spillet er i åben beta siden 8/5 og den relevante ledger
(`finance_transactions`) ikke har fuld historik længere tilbage).

## Fælles output-kontrakt (til #3138)

Alle 6 filer i `scripts/fairplay/3137-*.sql` returnerer nøjagtig disse
kolonner:

| Kolonne | Type | Betydning |
|---|---|---|
| `signal_name` | text | Fast literal, fx `lifecycle_account_age_at_transaction` |
| `team_id` | uuid | Det flaggede hold |
| `user_id` | uuid | Ejeren af holdet |
| `event_at` | timestamptz | Tidspunktet for den flaggede hændelse (til vinduer/joins i #3138) |
| `strength` | numeric(4,3) | 0.000–1.000, højere = mere mistænkeligt. **Per-signal heuristik, ikke en endelig dom** — #3138 ejer vægtning/kombination på tværs af signaler |
| `evidence` | jsonb | Menneskelæsbare felter (navne, ikke kun rå ID'er) der begrunder tallet |

`#3138` bygger `fairplay_flags` ved at UNION'e disse 6 (+ #3135's identitets-
signal + #3136's værdi-afvigelses-signal) på `(team_id, user_id)` og summere
vægtet `strength` pr. signal-type til en samlet score.

## KRITISK teknisk krav — outer joins på sælgersiden

`auctions.seller_team_id` er `NULL` for **1.169 af 2.464 auktioner (47%)** —
bank/AI/academy-auktioner uden en menneske-sælger. `transfer_offers.seller_team_id`
er derimod ALDRIG `NULL` (0 af 270). `auction_bids.team_id` og
`finance_transactions.team_id` er `ON DELETE CASCADE` fra `teams`;
`auctions.current_bidder_id` er `ON DELETE SET NULL`; `loans.team_id` er
`NO ACTION`. Alt dette er verificeret direkte mod `information_schema` 2026-08-03
(se "Verifikation af outer-joins" nedenfor).

Hver af de 6 filer, der berører sælger-siden af en auktion eller en
acquisition-kæde, bruger `LEFT JOIN` dér — aldrig `INNER JOIN` — og har en
kommentar i selve filen der forklarer hvorfor. Signal 3 og 4 har eksplicit
verificeret mod en konkret system-auktion (`be15ed5e-e936-4e5b-9056-d3e4e1549bca`,
`seller_team_id IS NULL`, academy_signing) at raden IKKE forsvinder af joinet.

## Pr.-signal resultater (90 dage, kørt 2026-08-03)

### Signal 1 — Kontoalder ved transaktionen
`3137-signal1-account-age-at-transaction.sql`

Scope: kun **menneske-modpart** handler (auktionsvinder mod en rigtig
sælger-hold, eller en direkte transfer_offers-handel) — bank/AI-sælgere er
bevidst udelukket. Uden den afgrænsning matchede ~150+ helt normale dag-0
startkøb mod banken (starterkapital + lån er ubegrænset NPC-penge, og hele
onboarding-flowet er designet til at spillere byder på deres første auktion
inden for minutter — det er IKKE et fair-play-problem alene).

- **187 rækker** i vinduet, **51** med `strength ≥ 0.5`.
- **#1 med klar margin:** Liverpool Racing / `dekiwas835@gwshare.com`,
  strength **1.000** (kontoalder 7 min, beløb 649.853). Uden
  menneske-modpart-filteret ville dette IKKE have skilt sig ud fra støjen —
  MED filteret er det den ENESTE handel i hele 90-dages-vinduet under 2 timers
  kontoalder mod en menneske-sælger. Matcher issuets egen påstand ordret.
- #2 (Atom Bikers, strength 0.831, alder 7,5 t, beløb 305.001) ligger markant
  lavere — sund adskillelse mellem den kendte sag og almindelig
  spiller-til-spiller-handel tidligt i et hold-liv.

**FP-vurdering:** lav-til-moderat støj i den brede hale (nye spillere handler
naturligt med hinanden), men toppen af listen er ren og diskriminerer korrekt.

### Signal 2 — Konto-levetid EFTER transaktionen
`3137-signal2-account-lifetime-after-transaction.sql`

Samme menneske-modpart-scope. Kræver mindst 3 dages observationsvindue før en
handel vurderes (ellers ser enhver frisk handel kunstigt "forladt" ud).
"Kom de tilbage" = `users.last_seen` UNION enhver efterfølgende
`finance_transactions`-aktivitet på holdet (kræver reelt spil, ikke bare et
sidevisning).

- **Max strength i hele vinduet: 0.401** (Falcor Cycling). Liverpool
  Racing/gwshare lander som **#2 med kun 0.386** — bekræftet: kontoen har
  haft finance-aktivitet (facility-køb, løbspræmier, academy-signing) helt
  frem til 2026-08-02, altså **ikke** forladt. Dette er korrekt, forventet
  adfærd — issuet selv fastslår at gwshare-sagen sandsynligvis ikke var snyd,
  og dette er netop det signal der IKKE skal fyre kraftigt på den sag.
- **Vigtigt fund:** ingen konto i de sidste 90 dage viser det egentlige
  "forsvandt umiddelbart efter stor overførsel"-mønster (max 0,401 er lavt).
  Det er en god nyhed for spillets nuværende sundhedstilstand, men betyder
  også at #3138 ikke kan kalibrere denne signals øvre ende empirisk endnu —
  kun mod #2776 (se verifikations-sektionen).

### Signal 3 — Lån umiddelbart efterfulgt af værditab ud af holdet
`3137-signal3-loan-then-value-loss.sql`

Dette ER #2776-mekanikken direkte: lån → accepteret transfer_offers-salg som
sælger til under 25% af `riders.market_value` inden for 7 dage efter lånet
(25%-tærsklen er spillets egen bank-auktions-startpris-konvention, citeret i
#2776 selv).

- **3 rækker** i 90-dages-vinduet, fordelt på **2 hold**: "Team Hansen Pro
  Cycling" (`cybersimon43@gmail.com`, ratio 0,236, gap 6,6 t, beløb 4.096/30.000
  — lille skala) og "Équipe Lorraine Acier" (`rasmus.juel.friis@gmail.com`,
  2 salg, ratio 0,178 og 0,153, gap 93–138 t, beløb 7.000–40.000).
- **FP-vurdering: lav prioritet, men ejer bør kigge på dem.** Ingen af de 3
  matcher #2776's alvor (450k+ lån, <48 t gap, hele holdets aktiv til ÉN
  modtager) — beløb og gaps her er markant mindre og længere, hvilket ligner
  rutinemæssig trup-oprydning efter et kortsigtet likviditets-lån snarere end
  en organiseret tragt. Ikke lukket/friskrevet her — kun konstateret at det
  ikke matcher signaturen. Kræver en hurtig manuel gennemgang, ikke en
  hastebeslutning.
- Bemærk: en helt separat, korrekt IKKE-fyrende observation: gwshare-modparten
  ("Borregaard Racing", der solgte til gwshare) havde ÓGSÅ for nylig taget et
  lån, men solgte til `ratio = 1.000` (fuld markedsværdi) — signalet
  ekskluderer den korrekt, fordi 1.0 er en fair, ikke en tragt-pris.

### Signal 4 — Konto oprettet under en kørende auktion, som derefter bød på samme auktion
`3137-signal4-account-created-during-auction.sql`

Dette ER #2776's præcise angrebsmønster (kps@latitude.dk oprettet mens
Pellegrini-auktionen kørte, bød 3 min 58 s senere på samme auktion).

- **Rå litteral match (efter udelukkelse af youth/academy-auktioner): 168
  rækker** i 90 dage. **Dette er et strukturelt højt baseline i netop dette
  spil** — hurtig onboarding er et bevidst designvalg (startkapital + dag-1
  lånekapacitet + "byd på en aktiv auktion" er kernen i første spiloplevelse),
  så langt de fleste nye spilleres allerførste bud opfylder den bogstavelige
  definition. **157 af 168 rækker scorer `strength ≥ 0.8`** med den
  vægtningsformel jeg har brugt (alder ved bud + "kontesteret af en anden
  menneske-spiller før kontoen fandtes" + "vandt auktionen") — dvs. formlen
  differentierer IKKE godt nok alene i dette spils normale flow.
- **Konklusion til #3138: dette signal må ALDRIG stå alene.** Det skal kræve
  korroboration fra #3135 (identitets-korrelation) eller signal 3, ellers
  drukner det i falske positiver fra helt almindelige nytilmeldte spillere.
  Dette er dokumenteret direkte i filens header-kommentar.
- Youth/academy-auktioner (`is_youth=true`) er udelukket — uden den
  udelukkelse var støjen endnu højere (auto-onboarding-auktioner mellem
  samtidige nytilmeldinger, ikke organisk budkrig).

### Signal 5 — Engangs-maildomæner
`3137-signal5-disposable-email-domains.sql`

Statisk kerneliste (~140 kendte temp-mail-udbydere, inkl. de 3 allerede
bekræftede: `gwshare.com`, `yopmail.com`, `atomicmail.io`) + data-drevet
heuristik (regex på domænenavne-mønstre som temp/trash/burner/guerrilla/osv).

- **Nøjagtigt 3 rækker** i hele brugerbasen — de 3 allerede kendte konti.
  Heuristikken tilføjer **0 ekstra** matches i dag (ren no-op-sikkerhedsnet,
  ikke en støjkilde).
- Strength deliberat lavt loftet (core=0,55, heuristik=0,30) — matcher
  issuets egen "svagt alene, stærkt i kombination"-formulering.

### Signal 6 — Aktivitetsprofil ved store overførsler
`3137-signal6-activity-profile-at-large-transfer.sql`

Level, XP, login-streak, og om holdet har kørt et FULDFØRT løb før
transaktionen — ignorerer pris helt.

- **#1: Liverpool Racing/gwshare, strength 1.000** (level 1, 0 XP, aldrig kørt
  et løb før handlen). Korrekt — matcher issuets forventning om at gwshare
  SKAL dukke op via et signal, selvom sagen ikke er snyd.
- #2 er `jcarey071@gmail.com` (Barra CC, strength 0,765) — dette er den
  KENDTE, allerede-undersøgte og friskendte lovlige jcarey-071/983-familie/
  ven-sag fra #3135's evidens (ikke en ny bekymring, blot en bekræftelse af
  at signalet reagerer fornuftigt på lav-engagement-konti generelt).

## #2776-verifikation (signal 3 + 4) — og et vigtigt fund om bevis-overlevelse

Acceptkriteriet kræver at signal 3 og 4 "ville have fanget #2776". Det kunne
**ikke** verificeres ved at genkøre queryen direkte mod nuværende prod-data
for selve hændelsen, fordi sanktionen i #2776 (gennemført 22/7, FØR dette
issue eksisterede) **cascade-slettede den primære evidens**:

- `teams.id` for "Racing bike" blev hård-slettet → `auction_bids.team_id` og
  `finance_transactions.team_id` er `ON DELETE CASCADE` fra `teams`, så ALLE
  Racing bikes bud-rækker og finans-transaktioner er permanent væk.
- `loans.team_id` er `NO ACTION` — lånet på 388.349 måtte derfor være
  eksplicit slettet FØR selve holdet kunne slettes (bekræftet: findes ikke i
  `loans` i dag, hverken via `team_id`-opslag eller dato-vindue).
- `transfer_offers` (de to 1-kr-handler) er ligeledes væk fra den LIVE tabel
  (kun tilbage i `backup_fairplay_20260722_transfer_offers`), selvom FK'en
  (`seller_team_id`, `NO ACTION`) i princippet tillod dem at blive — de er
  åbenlyst manuelt fjernet som del af oprydningen.
- `auctions`-rækken for selve Pellegrini-auktionen (id
  `81608451-c286-44d1-9b57-68dbf2b795e3`) **eksisterer stadig** (auctions er
  ikke cascade fra `current_bidder_id`, kun `SET NULL`), men
  `current_bidder_id` er nu `NULL` — vinderens identitet er væk fra den kolonne.

**Reelt betyder det: langt størstedelen af #2776's rå bevis er ikke
længere forespørgbart i prod** — ikke fordi mine queries er forkerte, men
fordi selve sanktions-oprydningen (helt korrekt af sig selv) fjernede de
rækker en detektor ville have brugt. Jeg kan derfor kun verificere "ville have
fanget" via en rekonstruktion, ikke en live genkørsel:

- **Signal 4-logik**, anvendt manuelt på de overleverede tal fra issue-teksten
  (konto oprettet 2026-07-19 23:20:18 UTC, mens Pellegrini-auktionen kørte
  fra 2026-07-18 12:53 til 2026-07-20 20:53; bud på samme auktion 3 min 58 s
  senere; Minisize Biking havde allerede budt og var løbet tør for penge
  FØR kps-kontoen overhovedet fandtes): dette er et **eksakt match** på alle
  betingelser i signal 4's WHERE-klausul (kontoalder ved bud, kontesteret af
  en anden menneske-spiller før kontoen eksisterede) — verdikt: **ville have
  fanget den, med meget høj strength** (alder-ved-bud ~4 min → age_score≈1,0;
  kontesteret=true → +0,35).
- **Signal 3-logik**, samme rekonstruktion: lån 388.349 kl. 01:23:59 CPH →
  salg til 1 kr kl. (21/7 og 22/7, hhv. ~1 og ~2 dage efter) med
  `offer_amount/market_value` ratio ≈ 0,0000006 (1 kr / 1.787.739 og
  1 kr / 179.322) — **langt under** 0,25-tærsklen, gap langt under 7 dage.
  Verdikt: **ville have fanget den, med maksimal strength** (ratio-komponent
  mætter til 1,0, gap-komponent tæt på 1,0).
- Dette er en **logik-verifikation via rekonstruktion**, ikke en live
  data-genkørsel — dokumenteret eksplicit her frem for at hævde noget jeg
  ikke kan bevise med en faktisk SELECT mod prod.

**Anbefaling til ejer/#3138/fremtidige sager:** fair-play-sanktioner bør
overveje at ARKIVERE (soft-delete til en `backup_fairplay_*`-tabel, som
allerede gøres for teams/riders/transfer_offers) i stedet for at cascade-
eller hård-slette `loans`, `auction_bids` og `finance_transactions` — ellers
mister ethvert fremtidigt detektor-review netop de rækker der beviser
mønstret. Dette er ikke en fejl i #2776's håndtering (sagen var allerede
afsluttet), men en forudsætning der bør ind i `docs/GAME_INVARIANTS.md` eller
fair-play-runbooken fremadrettet.

## Verifikation af outer-joins (systemauktion-test)

Kørt direkte mod prod 2026-08-03:

```sql
select id, rider_id, seller_team_id from auctions
where id = 'be15ed5e-e936-4e5b-9056-d3e4e1549bca';
-- seller_team_id IS NULL (academy_signing / system-auktion)
```

Signal 3's acquisition-enrichment og signal 4's seller-enrichment blev begge
kørt med denne auktion i resultatsættet for at bekræfte, at LEFT JOIN-kæden
returnerer rækken med `acquisition_seller_team_name` /
`seller_team_name` = `'system/bank (seller_team_id NULL)'` i stedet for at
tabe raden — dokumenteret i hver fils header-kommentar med den præcise
verifikationsforespørgsel.

## Kendte begrænsninger

1. **`riders.market_value` er nutidig, ikke historisk** — signal 3's
   ratio-beregning bruger den aktuelle værdi som proxy for værdien på
   salgstidspunktet. Markeret eksplicit i evidence-JSON'en
   (`market_value_is_current_proxy: true`).
2. **Signal 4's basisrate er for høj til at stå alene** i dette specifikke
   spil pga. det bevidste hurtig-onboarding-design — se signal 4-afsnittet.
3. **90-dages-vinduet dækker reelt kun ~42 dages ledger-historik** for
   `finance_transactions` (tidligste række 2026-06-22) — ikke en fejl, bare
   en observation om hvor langt tilbage dataene rækker.
4. Alle 6 filer ekskluderer `is_ai`, `is_test_account`, og
   `%@cyclingzone.dev` (ejerens testkonti, jf. #3135's kendte-FP-liste).

## Åbne spørgsmål til ejer / #3138

- Skal signal 3's 3 kandidater (Team Hansen Pro Cycling, Équipe Lorraine
  Acier) undersøges manuelt nu, eller er de lav nok prioritet til at vente på
  #3138's samlede scoring?
- Bør #2642-rammen for post-merge migrationer udvides til at kræve
  arkivering (ikke hård-sletning) af `loans`/`auction_bids`/
  `finance_transactions` ved fremtidige fair-play-sanktioner? (se
  anbefalingen ovenfor)
- #3138 skal selv fastlægge de endelige vægte pr. signal i den samlede score
  — tallene her (0,4/0,35/0,25 osv. i de enkelte filer) er startkurver, ikke
  en kalibreret model.
