# Natsession 27/8 → fredag morgen 28/8 — rapport

> Kørt natten til torsdag 27/8, kl. 01:10–02:15 dansk tid, af Opus-natsessionen
> (`sessions/2026-08-27-natsession-opus-foer-saesonstart.md`). Mandat: PR'er +
> lav-risiko merges. **Sæsonen starter fredag 28/8 kl. 11.**

## 0 · Det korte

**Ingen prod-mutationer.** Alt mod prod var read-only SELECT.

**Tre PR'er merget, tre venter på dig.**

_Rettelse til min egen første version af denne rapport: jeg skrev at branch protection spærrede for alle merges, fordi PR'erne står som `REVIEW_REQUIRED`. Det viste sig at være rådgivende, ikke blokerende — merget gik igennem. Jeg har derfor merget netop dem mandatet dækker (docs- og CI-/vagt-PR'er med grøn CI) og ladet alle kode-PR'er stå._

| PR | Hvad | Status |
|---|---|---|
| [#4285](https://github.com/NicolaiDolmer/CyclingZone/pull/4285) | #4200 anden halvdel — en ryddet trup bliver ryddet | **Venter på dig.** Kode-PR. Lokalt 561 passed; CI-smoke rød på en urelateret test — se §0b. **Merge før kl. 11** |
| [#4286](https://github.com/NicolaiDolmer/CyclingZone/pull/4286) | #4233/#4183 — nye spillere kan lande i en pulje på 24 | **Venter på dig.** Kode-PR. **Merge før kl. 11** |
| [#4291](https://github.com/NicolaiDolmer/CyclingZone/pull/4291) | #4260/#4184 — rå i18n-nøgler + vagtens typelister og målemetoder | **Venter på dig.** Rører spillervendt tekst. Smoke rød af samme grund som #4285 — se §0b |
| [#4287](https://github.com/NicolaiDolmer/CyclingZone/pull/4287) | #4261 — svar på løb-som-træning i Hjælp | ✅ **Merget** (13ec1e839) |
| [#4289](https://github.com/NicolaiDolmer/CyclingZone/pull/4289) | #4281/#4258/#4274 + audit-workflowet | ✅ **Merget** |
| [#4290](https://github.com/NicolaiDolmer/CyclingZone/pull/4290) | #4219/#4215 — scorecards måler prod, kalender-gate i CI | ✅ **Merget** |

Done-flip er sat på #4219 #4281 #4258 #4274 #4261. **#4215 er bevidst holdt på `claude:todo`**: kun 1 af #4176's 3 krævede kørsels-steder er leveret.

### 0b · `frontend-smoke` er rød på #4285 og #4291 — og jeg fandt hvorfor

**Begge er samme underliggende problem, og det er ikke deres kode.** Skrevet op som
**[#4292](https://github.com/NicolaiDolmer/CyclingZone/issues/4292)**.

Alle fire kørsler landede på `559 passed, 1 failed`. Fejlteksten er den samme:

```
Error: console.error(s): useForumHighlights failed: Load failed
```

`useForumHighlights.js:47` logger til **`console.error`** ved enhver fejl i sit fetch mod
`/api/forum/posts` — også et transient netværks-hikke (`Load failed` er WebKit's besked for
et fetch der aldrig kom igennem). Hooken sidder i `ForumHighlightsCard` på dashboardet, og
en håndfuld e2e-tests asserterer at konsollen er tom.

Det forklarer to mønstre der lignede to problemer:

- **#4291 fejlede på samme spec-fil begge gange** (`3708-transfer-history-ai-cleanup`, linje
  55 og 85). Den asserterer på tom konsol — den er kanariefuglen og fanger hikket hver gang.
- **#4285 fejlede på fire forskellige filer** (`finance-prize-sort`,
  `transfer-history-no-sale-filter`, `board-wizard-back`, plus et login-timeout i
  `fixtures.js:350`). De fejler kun hvis hikket rammer præcis deres egen ventetid.

**Ingen af de fejlende tests rører de to PR'ers kode.** #4285 rører race-udtagelse, #4291
rører i18n-nøgler — ingen af dem rører forum, finans-sortering eller board-wizarden.
Lokalt er #4285 grøn: 561 passed, alle tre projekter.

`ForumHighlightsCard` gik live 25/8 (#4249) og smoke-fejlene begynder 26-27/8. Tidsmæssigt
konsistent, men **kausaliteten er ikke bevist** — der findes ingen main-historik at
sammenligne med. Netop det hul lukker den natlige cron der blev merget i nat (#4289), så
efter et par nætter er der data.

**Min vurdering: begge PR'er kan merges.** Den røde check er ægte, men den hører til #4292,
ikke til dem. Vil du hellere vente, så er #4286 (som er grøn) den vigtigste af de to før kl. 11.

**Din egen [#4284](https://github.com/NicolaiDolmer/CyclingZone/pull/4284) er urørt** som aftalt.
Test-merget mod #4285: `raceRunner.js` merger **rent**. Eneste konflikt er
`patchNotes.js`, hvor begge indsætter en version øverst — trivielt "behold begge".
Jeg har flyttet min til 7.199 så versionsnumrene ikke også kolliderer (#4284 = 7.197,
#4287 = 7.198).

## 1 · Prod-tilstand kl. 02:10 — fredag-tjeklisten kørt

Alle read-only, fra beredskabs-promptens §6 (som ligger på #4284's branch, ikke på main).

| Tjek | Resultat |
|---|---|
| Flag | `auto_entry_generator_enabled` **on** · `stage_scheduler_enabled` **on** · `race_engine_v2_enabled` **on** · `race_day_engine_enabled` **on** · `race_day_development_enabled` **off** |
| Overlap pr. løbsdag | **0** ✅ |
| Binding-sanity a (entries uden `race_entry_days`) | **0** ✅ |
| Binding-sanity b (`binding_span` afviger fra aksen) | **0** ✅ |
| Pulje-størrelser | 14 af 15 puljer på præcis 24. **D4-A står på 25** (se #4233 nedenfor) |
| Assistent-dækning (query 3) | **Ikke meningsfuld nu** — assistenten udtager først 1 t før hvert løb (#4174). Kør den kl. ~10:15 mod 2-timers-vinduet; den skal være 0 for kl. 11-løbene. |

**Assistenten opfører sig som besluttet.** S3 har 24.724 udtagelser: 24.615 på AI-hold
(alle auto-fyldte — det er sweep'en der holder AI-felterne fyldte) og 109 på
**tre** menneskehold. De tre er player-initierede, ikke push-fyld:

- *Bad At Names* — 44 rækker, alle auto, skrevet over 2 minutter (auto-udfyld-knappen)
- *Chuchiet* — 22 rækker, alle auto, inden for samme sekund (udfyld-sæson)
- *Team Hansen Pro Cycling* — 43 rækker, **0 auto**, over 5 minutter (manuel udtagelse)

Altså: #4222's "assistenten er pull, ikke push" holder i prod. Ingen spiller har fået
en trup de ikke selv bad om.

## 2 · Beslutninger du skal tage (én ad gangen)

### Beslutning 1 — merger du #4285 og #4286 før kl. 11?

**Anbefaling: ja, begge.** Begge er backend-only, uden migration og uden flag.

**#4285** lukker den sidste sti hvor assistenten overskriver en trup spilleren har
ryddet. Vær opmærksom på præcis hvad den gør og ikke gør: der er i dag **0
ryd-markeringer på S3-løb** (de 28 der findes peger på sæson 2), fordi wipen ryddede
dem. Fixet retter altså ikke en aktuel fejltilstand — det forhindrer at de tre
spilleres klage fra 24/8 gentager sig i det øjeblik nogen rydder en dag fredag.

**#4286** er den mere konkrete: **D4-A står på 25 hold lige nu**, og hver ny
tilmelding der rammer et blokeret AI-hold gør det til 26, 27, 28. Nye signups lander
i tier 4, og der kommer signups fredag.

### Beslutning 2 — `transfer_offers`-FK'en (#4233): A, B eller C?

Denne haster **ikke** mere efter #4286, men den vender tilbage. 22 døde tilbud
(withdrawn/accepted/rejected) forsvinder aldrig af sig selv, så 16 AI-hold er
permanent utrimbare indtil FK-semantikken afgøres.

Issuets oprindelige anbefaling var **A) ON DELETE CASCADE**, betinget af om de 7
accepted-rækker bruges som handelshistorik. Målt i nat: der er **132 accepted-rækker**
i `transfer_offers`, og der findes **ingen separat handelshistorik-tabel**.
`transfer_offers` **er** handelshistorikken.

**Det flytter anbefalingen til B) ON DELETE SET NULL** hvis historikken skal overleve.
Men: jeg har kun verificeret tabel-inventaret, ikke hvilke flader der faktisk læser
accepted-rækker. **Ingen evidens for at ingen læser dem** — det skal tjekkes før valget
låses. Ikke et færdigt beslutningsgrundlag, og det behøver det heller ikke være i dag.

### Beslutning 3 — et hold er transfer-frosset af renter alene

*Top Pro Cycling* (D3) står `transfer_frozen = true` med en **positiv** kassebeholdning
på 830.396. Holdet lånte **præcis** op til D3-loftet (582.524 + 17.476 gebyr = 600.000)
og ikke en krone over. To sæsoners 8 %-rente har kapitaliseret 99.840 oven i, så gælden
er 699.840.

`economyEngine.js:772` (#2912) ekskluderer bevidst **kørslens egen** rente fra straffen,
netop fordi *"man ikke bør straffes for motorens egen kapitalisering"* — men sidste
sæsons rente indgår fuldt i basisgælden næste sæson. Det er dokumenteret som tilsigtet
(så eskalering ikke kan udskydes i det uendelige).

Konsekvensen er, at et hold der låner præcis det spillet tillader, bliver frosset en
sæson senere uden selv at have gjort noget. **Er det som du vil have det?**
Jeg har ikke rørt noget. Skriv til på #4282 hvis det skal laves om.

## 3 · Diagnoser — begge "vagt-fejl", ikke datafejl

Begge var stillet som spørgsmål ("reelt brud eller forældet loft?"). Svaret er det
samme i begge: **vagten måler noget andet end den regel der håndhæves.**

**#4282 gældsloft:** de 2 flagede hold lånte begge præcis op til loftet. Hele
overskridelsen er kapitaliseret rente. `verify-invariants.js:175` sammenligner
`sum(amount_remaining)` mod et loft der styrer hvor meget man må **låne**.

Jeg anbefalede først at måle på trukket beløb (`principal + origination_fee`) og
**tog fejl** — det gør vagten dårligere, fordi et hold kan have flere aktive lån
og have afdraget på dem (NewE Pro Cycling: trukket 2.068.000, udestående 1.194.000,
loft 1.200.000). Målt mod prod, 30 hold med aktivt lån:

| Mål | Brud |
|---|--:|
| `sum(principal + origination_fee)` | **5** |
| `sum(amount_remaining)` (i dag) | 2 |
| `sum(amount_remaining - accrued_interest)` | **0** |

**Det rigtige mål er `amount_remaining - accrued_interest`** — nøjagtig samme
størrelse som `economyEngine.js:783` bruger (`interestExcludedDebt`) når den afgør
om et hold skal fryses. Rettelsen er skrevet på #4282 og givet videre.

**#4146 trupgrænse:** vagten siger 25 hold over grænsen, den ægte regel siger **0**.
`verify-invariants.js:112` henter `riders` helt ufiltreret — kolonnerne
`is_academy`/`is_retired` hentes, men bruges aldrig i optællingen, så akademiryttere og
pensionerede tælles med i en cap der er senior-kun (`auctionRules.js:379` siger det
ordret). 25 falske positiver af 25.

**Fælles blind vinkel:** `SQUAD_MAX` og `DEBT_CEILING` i scriptet mangler begge
**division 4**, og `if (max !== undefined)` gør at D4-hold stille springes over. De
kanoniske konstanter (`economyConstants.js:105`, `marketUtils.js:96`) dækker D4.
Fixet er at **importere** dem i stedet for at genskrive dem — præcis den drift-klasse
#4184 handler om.

Fundene er givet videre til den worker der ejer `verify-invariants.js`; hvis de ikke
er landet i en PR, står de fuldt dokumenteret i kommentarerne på #4282 og #4146.

## 4 · To nye fund fra kalender-vagterne (#4290)

`raceRouteRealismScorecard` byggede sin egen plan i stedet for at læse den skrevne
kalender. Med den nye `--mod-prod`-tilstand kunne den for første gang se prod — og
fandt straks to ting. Begge er efterprøvet med **uafhængig SQL**, ikke kun via den nye kode.

**1. Tier 1 har 0 brosten-i-etapeløb mod båndet ≥1 (#3469).** Brostenene er der: D1 har
seks brostens-*endagsløb*. Men ingen af divisionens 16 **etapeløb** har en brostens-etape.
`Danmark Rundt` bar det tal 25/8 og er ikke i D1's kalender længere efter regenereringen.
**Ikke rørt** — en kalender-ændring to dage før start er ikke en natsessions beslutning.

**2. De tre Grand Tours er umålte.** S3 kører dem på 17-18 etaper mod S2's 21, og
GT-båndet kræver mindst 21, så alle tre springes over som "kunne ikke vurderes".
Forkortelsen er en bevidst følge af den 31 dage lange sæson — **det er båndet der er
forældet, ikke kalenderen.** Skrevet op som **[#4288](https://github.com/NicolaiDolmer/CyclingZone/issues/4288)**
med A/B/C og en anbefaling. Haster ikke; ingen spiller mærker det.

Samme fejlklasse som #4229: en vagt der bliver stille når systemet ændrer sig, er ikke en vagt.

## 5 · Rettelser til issuernes egne præmisser

Tre issues beskrev noget der ikke længere passer. Verificeret før jeg skrev det:

- **#4183** (ny spiller som nr. 25 i D3-A): **D3-A står på 24 nu.** Alle tier 1-3-puljer
  er på 24. Den eneste overtrædelse er D4-A. Issuets beslutningsspørgsmål ("hvor skal
  nye tilmeldinger lande?") er besvaret af virkeligheden: de lander i tier 4, hvor der er
  17-18 AI-hold pr. pulje at fortrænge. Mekanikken var bare i stykker.
- **#4215** ("exit-koden mangler"): **exit-koden findes allerede** (`calendarScorecard4218.mjs:298`),
  og `--json` også. Det der manglede var håndhævelsen — `grep` finder ikke scriptet nævnt
  i én eneste workflow. Nu kører det som CI-gate.
- **#4258** ("klokke-afhængige backend-tests"): **de var ikke klokke-afhængige.** Alle 18
  "fund" var samme `supabaseUrl is required`-crash, fordi `clock-drift-test-check.yml`
  aldrig satte `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` som `ci.yml` gør. Verificeret
  uafhængigt: main's workflow-fil har kun `CZ_TEST_CLOCK_OFFSET_DAYS` og `NODE_OPTIONS`
  i sin `env:`. 7189/7189 backend-tests er grønne med 183 dages klokke-offset når
  env-var'ene er sat.

## 6 · Andet, kort

- **`audit` (league-size) var et dødt værn.** Steppet kører under `bash -e`, og scriptet
  `exit 1`'er ved fund — så det døde på **første** linje, før den læsbare rapport blev
  skrevet, før `total` blev sat, og før kommentar-/artifact-mekanikken. Resultatet var et
  rødt X uden en eneste linje om hvad den fandt. Fixet i #4289 — **og verificeret i CI,
  ikke kun lokalt**: #4289's egen `audit`-kørsel er rød med teksten *"League-size invariant
  audit found 1 deviating group(s). See report artifact."* Den ene gruppe er D4-A på 25.
  Auditten forbliver altså rød indtil #4286 er merget og puljen er trimmet — men den siger
  nu hvorfor, og rapporten kommer med.
- **#4274** (dev-script skrev i et fremmed worktree): fikset som **mitigering**, ikke som
  rod-årsag. En kontrolleret reproduktion lykkedes ikke, og det står eksplicit som gæt i
  PR-body. ~40 flere scripts har samme `__dirname`-mønster og er bevidst ikke rørt.
- **9 done-men-åbne issues lukket** med evidens (#4223 #4225 #4229 #4236 #4239 #4244
  #4273 #4275 #4277). #4272 er **ikke** lukket — dens D4-valg afventer dig. #4231, #4190
  og de fire ældre balance-issues er ikke lukket, fordi jeg ikke kunne verificere dem
  entydigt på main.

## 7 · Ikke nået

- **#4256** — forældreløs branch med 850 linjer #3570-arbejde. **Sikkerhedsspørgsmålet er
  afklaret: hullet er ikke åbent.** `archetype_draw`-maskeringen står på main to steder
  (`api.js:1060` og `:15545`, begge tagget #3570), og `lint-riders-column-grant.mjs:113`
  har kolonnen opført som samme oracle-klasse som `potentiale` — den kan ikke stilfærdigt
  blive eksponeret igen. Det var issuets stærkeste grund til hast, og den er væk.
  Rebase + PR er **ikke** gjort: 850 linjer balance-kode der rører `riderTypes.js` og
  `backfillCores.js` lander man ikke to dage før sæsonstart. `claude:todo` er fjernet
  fra lukkede #3570.
- **#4259** — ikon for "allerede udtaget i dag" i Planlægning. Ikke bygget. Det er en
  UI-PR, som alligevel ville stå og vente på dit review, og den konkurrerede med
  sæsonstart-kritisk arbejde.
- **#4123** — kalender-invarianter som CI-gate + gylden kalender-diff. Stor, og #4290
  leverer det tilstødende stykke (scorecardet i CI). Naturlig efterfølger.
- **#4176 punkt 3** — scorecardet skal køre **tre** steder. #4290 leverer CI.
  Sæsonskifte-preflighten og verify-invariants-mod-prod mangler. **#4215 skal derfor
  ikke lukkes på #4290.**

## 8 · Fredag morgen, i rækkefølge

1. Review + merge **#4284** (din egen), derefter **#4285** og **#4286**. Løs den
   trivielle `patchNotes.js`-konflikt undervejs (behold begge blokke).
2. Apply #4284's migration (`database/2026-08-27-4283-selection-guard-spaend.sql`).
3. Kør §6-tjeklisten igen — særligt **query 3 kl. ~10:15**, som er den eneste der ikke
   kan køres på forhånd.
4. **Post svar-udkastene i Discord.** Hjælp/FAQ er allerede live (#4287 merget), men de
   fem spillere har ventet på et svar siden 25/8, og jeg sender aldrig beskeder på dine
   vegne. Udkastene ligger klar EN+DA i
   `docs/drafts/2026-08-27-4261-svarudkast-loeb-som-traening.md`.
5. **#4291** når du har set på den — den rører spillervendt tekst (finans-labels,
   træningsfokus), så den hører til dit review, ikke mit.
6. Beslutning 2 (#4233's FK) og beslutning 3 (#4282, det rente-frosne hold) når der er ro.
