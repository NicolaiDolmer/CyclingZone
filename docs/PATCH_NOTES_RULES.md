# Patch notes: SSOT (site + Discord)

> **Læs denne FØR du skriver, retter eller poster en patch note, på sitet eller i Discord.**
>
> Skrevet som svar på [#4521](https://github.com/NicolaiDolmer/CyclingZone/issues/4521): en efterkontrol af
> site + Discord var lavet 2/9 (site bragt i sync t.o.m. v7.234, PR #4605; Discord-opsamling postet af
> ejeren 2/9), men selve SSOT-dokumentet manglede. Dette dokument opfinder ingen nye regler: det skriver
> allerede besluttet praksis ned, med kildehenvisning, så den ikke skal genopfindes hver gang.

---

## 1. Én kilde: `frontend/src/data/patchNotes.js`

- Sitet (`cyclingzone.org/patch-notes`) er den eneste kilde til patch note-*indhold*. Discord citerer den,
  skriver aldrig sit eget (§3).
- Patch notes er obligatoriske ved enhver brugerrettet ændring (hard rule, se `CLAUDE.md`/`AGENTS.md`).
- **En PR skriver sin note som et fragment, aldrig direkte i `patchNotes.js`** ([#8346](https://github.com/NicolaiDolmer/CyclingZone/issues/8346)):
  ÉN ny fil `frontend/src/data/patch-notes/pending/<issue>-<kort-slug>.json` med samme felter som en post, men
  uden `version` og `date` (format: [`frontend/src/data/patch-notes/README.md`](../frontend/src/data/patch-notes/README.md)).
  To PR'er rører derfor aldrig samme fil, og ingen gætter et versionsnummer.
- **Nummer og dato gives ved merge.** Efter et verificeret merge-tog kører close-out
  `scripts/patch-notes-number.mjs`: ventende fragmenter får nummer i merge-rækkefølge og dato = merge-dagen
  (Europe/Copenhagen), flyttes øverst i `patchNotes.js` og slettes, som ét chore-commit på main. Køen
  (`scripts/merge-queue.ps1`) venter derefter på main-CI og deploy-verifikation for netop det commit, før
  close-out er færdig (AGENTS regel 20). Ventende fragmenter vises ikke for spillerne, før de har nummer.
  Manuel fallback: `node scripts/patch-notes-number.mjs plan --ref origin/main` og `... push`; kør du `push`
  selv, verificerer du også selv main-CI og deploy for det nye commit.
- `scripts/check-patch-notes-version.js` er CI-gate (required, i `frontend-build`): validerer hvert ventende
  fragment med de samme regler som en ny post (rollout, `flag` på beta-noter, em-dash, døde produkttermer,
  læk-mønster). Lokalt: `node scripts/patch-notes-number.mjs check`. En ny version direkte i `patchNotes.js`
  accepteres stadig i en overgang, men vagten skriver en note om at bruge et fragment.
- `scripts/check-patch-notes-coverage.js` er **rådgivende, ikke blokerende** ([#3638](https://github.com/NicolaiDolmer/CyclingZone/issues/3638),
  eksplicit ejer-beslutning: *"Flaggeren bør foreslå, ikke blokere"*): den flager sandsynlige manglende
  entries på frontend-ændringer, exitcode 0 altid.
- `scripts/patchnotes-audit.sh` er efterkontrol-værktøjet: sammenligner merged PR'er mod entries i
  `patchNotes.js`. Brugt til 7-dages-auditten 2/9 ([#4605](https://github.com/NicolaiDolmer/CyclingZone/pull/4605));
  se §5.

## 2. Format på sitet: allerede låst

Selve tekst-formatet er låst i [`TONE_OF_VOICE.md`](TONE_OF_VOICE.md), sektion **"Patch notes · format"**
(14/8, [#3680](https://github.com/NicolaiDolmer/CyclingZone/issues/3680)). Læs den, dette dokument
duplikerer den ikke. Kort resumé:

| Regel | Kilde |
|---|---|
| Faste felter (Titel / What changed / Why valgfri / What it means for you), ikke fri tekst | ToV §2.1 |
| Højst ét tal, og kun ét der besvarer "rammer det mig?" (ikke stikprøve/metode) | ToV §2.3 |
| EN først, DA under, ingen em-dash, intet opfundet indhold | ToV §2 "Uændret" |
| `scripts/tone-check-em-dash.mjs` + `scripts/tone-check-terms.mjs` kører i CI (`i18n-check.yml`) | ToV §"Ord og termer" |

## 2a. Udrulning: fast markering pr. change (ejer 1/10, [#6014](https://github.com/NicolaiDolmer/CyclingZone/issues/6014))

En spiller skal kunne se, om en ændring gælder ham nu, kun beta-gruppen, eller er noget der blev
*tændt* (bygget tidligere). Hver spillervendt change får derfor feltet `rollout`:

| `rollout` | Betyder | Chip på sitet (EN / DA) | Eksempel |
|---|---|---|---|
| `live` | For alle, fra i dag | ingen chip | En fejlrettelse |
| `beta` | Kun beta-gruppen (flag i stadie `beta`) | Beta / Beta | Træn nu 1/10 |
| `beta_to_live` | Gik fra beta til alle. Skriv en NY entry den dag flaget går `on` | Now live for all / Nu for alle | Mandatet for alle 27/9 |
| `switched_on` | Bygget før, men tændt/i brug fra denne dato (flag-flip, motor) | Switched on / Tændt | Løbsmotoren 28/9 |
| `event` | Begivenhed, ikke en kodeændring | Season event / Sæsonbegivenhed | Sæsonskiftet S3→S4 |

- Det eksisterende top-felt `"label": "Beta"` er spillets **open beta** og forbliver uændret. Det er ikke `rollout`.
- **`flag` (valgfrit, påkrævet på nye `beta`-noter, #6154):** nøglen på den kontakt noten handler om. Er kontakten slået til for alle (anonymt `GET /api/feature-flags`), læser siden noten som `beta_to_live` uden at datafilen rettes. Kontakten "Beta only / Kun beta" (#6717) viser kun noter hvis læste udrulning stadig er `beta`; der findes ikke længere et "Now live for all"-filter, men `beta_to_live`-chippen pr. note står uændret. Kun nøgler i `PLAYER_VISIBLE_FLAG_KEYS` kendes af siden, andre noter forbliver som skrevet. Guarden fejler en ny beta-note uden `flag`; eksisterende noter er undtaget.
- Ældre entries med `"stage": "beta"` (#5422) læses af siden som `rollout: "beta"`; nye entries bruger `rollout`.
- **Guard:** `scripts/check-patch-notes-version.js` fejler, hvis en player-change i en *ny* version mangler en
  gyldig `rollout`. Historiske versioner røres ikke.
- **Flag-flip = patch note.** Et beta→on-flip eller et off→on-flip af noget spillervendt får sin egen entry samme
  dag (`beta_to_live` / `switched_on`), også når koden blev merget og noteret dage før. 7-dages-auditten 1/10 fandt
  at Mandatets flip 27/9 aldrig blev noteret, fordi koden var noteret som beta.
- Siden: chippen er en rolig hairline (5px radius, ingen fyld, ingen guld). Hjælp forklarer mærkerne under
  beta-gruppe-FAQ'en, og sidens fod har én forklarende linje.

## 2b. Område, ugens nyhed og billede (ejer 12/11 + 16/11, [#8049](https://github.com/NicolaiDolmer/CyclingZone/issues/8049))

Den nye patch notes-side (bag kontakten `patch_notes_v2_8049`, slukket = den gamle side) grupperer ugen efter
område. Nye felter på en change. De skrives i PR'ens fragment under `pending/` (§1) og følger med, når merge-toget
nummererer noten ind i `patchNotes.js`; guarden kræver `area` på hvert ventende fragment med en spillervendt change:

| Felt | Betyder | Regel |
|---|---|---|
| `area` | Hvilken del af spillet ændringen forbedrer | **Krævet på nye spillervendte noter.** Én af `tactics`, `races` (løb og løbsfilm), `engine` (løbsmotoren), `training`, `development`, `market`, `academy`, `board`, `economy`, `interface`, `mobile`, `help`. Guarden i `scripts/check-patch-notes-version.js` fejler en ny note uden gyldigt område |
| `highlight: true` | Redaktørens valg af ugens store nyhed | Valgfri. Uden det vælger siden selv: Tændt for alle > Nyt > Beta, nyeste først |
| `image` | Billede ved ugens nyhed | Valgfri. Sti under `/patch-notes-images/` (fil i `frontend/public/patch-notes-images/`), webp, højst ca. 60 KB, ingen holdnavne eller spillernavne. Vises kun, når noten er ugens nyhed |
| `replaces` | `version#index` på den beta-note, som denne note afløser | Valgfri. Står begge i samme uge, vises kun den nye. Uden feltet gælder det samme for to noter med samme `flag` |

- Mærket afledes som i dag (`rollout` vinder over `category`), så der er én sandhed: Tændt for alle, Nyt, Beta,
  Forbedring, Fejlrettelse.
- **Gamle noter røres ikke.** Deres område står i `frontend/src/lib/patchNotesAreaData.ts` (nøgle `version#index`)
  og i `TOPIC_AREA` i `frontend/src/lib/patchNotesArea.ts`; hvad der ikke kunne placeres sikkert, ligger i
  "Andet" og vises kun i arkivet. Klassificeringen og dens kilder: [`docs/design/reviews/2026-11-16-8049-klassificering.md`](design/reviews/2026-11-16-8049-klassificering.md).
- **Hvem sætter området, og med hvilken model.** Forfatteren af noten sætter `area` i fragmentet; ingen model
  klassificerer nye noter automatisk. Backfill af de gamle noter blev lavet én gang af Opus (tabellen ovenfor),
  aldrig Haiku. Den eneste model, der gentagne gange skriver tekst til siden, er oversættelsen af sidens egne
  strenge (`scripts/i18n-translate-delta.mjs`): `patchnotes`-namespacet kører på Opus (`NAMESPACE_MODELS`), resten
  på `DEFAULT_MODEL`, og `--model` vinder altid. Haiku bruges ikke til spillertekst (`docs/AI_CHANNEL_ROUTING.md`).
- Siden viser kun nummererede noter fra `patchNotes.js`. Et ventende fragment i `pending/` når aldrig spillerne
  (låst af `frontend/vite-plugins/patch-notes-v2.test.ts`).
- Den åbnede uge og arkivmånederne (variant B) har kolonneoverskrifter: "Område" og "Vigtigst" (ejer 16/11).
- Filerne siden henter (`patch-notes-data/recent|index|<måned>.<sprog>.json`) genereres i build af
  `frontend/vite-plugins/patch-notes-v2.ts`; de committes aldrig. Åbning af siden henter kun `recent` (en test
  holder den under 40 KB pakket).

## 3. Discord: udsnit, ikke en ny tekst

**Reglen (ToV §2.2, 14/8):** Discord får **titlen plus feltet "What changed", ordret**. Der skrives
aldrig en selvstændig Discord-version. Praksis 17/9 bekræfter dette ([`docs/drafts/discord-patch-notes-2026-09-17.md`](drafts/discord-patch-notes-2026-09-17.md)):
udkastet er et rent udsnit af `patchNotes.js`, kategoriseret efter samme overskrifter som sitets sektioner
(Riders, Training, Academy, osv.), EN-blok først, DA-blok under.

**Hvem poster:** Claude/AI skriver udkastet (EN + DA), lægger det i `docs/drafts/discord-patch-notes-<dato>.md`.
**Ejeren poster selv i Discord.** Claude sender aldrig selv en spillerbesked. Bekræftet gentagne gange i
issue-tråden ("Discord-opsamlingen... er POSTET af ejeren 2/9") og i memory-reglen
`feedback_never_send_player_messages_on_owners_behalf.md` (ejer 6/8): udkast til copy-paste, ejeren poster.

**Kanal:** `#patch-notes` (EN-post), DA i tråden under eller `#dansk-snak`, samme mønster som
`COMMS_PLAYBOOK.md` §2.1's kanaltabel. **Bemærk:** kanalnavnene er ikke verificeret mod den levende
Discord-server (`COMMS_PLAYBOOK.md` §2.1, MCP nede 8/9, ❓-status). Er navnet ændret siden, skal ejeren
selv finde den rigtige kanal, ikke stole blindt på navnet her.

**Bølge-lane-PR'er skriver deres egen note som fragment (#8346):** tidligere samlede bølger patch notes ved
close-out for at undgå merge-konflikter i `patchNotes.js` (`feedback_parallel_workers_e2e_slot.md`). Med
fragmenter er konflikten væk: en lane lægger sin note i sin egen fil under `pending/` i samme PR som
ændringen, og merge-toget nummererer den (§1). Siger en bølge-brief stadig "ingen patch note i PR'en",
afleverer lanen teksten (EN + DA) i sin rapport, og orkestratoren lægger den som ét fragment pr. note.
Ingen redigerer `patchNotes.js` direkte, heller ikke ved close-out. Discord-udkastet skrives fortsat ud fra
de nummererede entries i `patchNotes.js`, ikke ud fra fragmenterne.

**Kadence (åbent, ikke låst):** Der er endnu ingen fast ejer-besluttet regel for *hvornår* en Discord-catch-up
postes. Praksis indtil nu er ad hoc-opsamlinger der dækker perioden siden sidste post (2/9 dækkede 7.148-7.231,
17/9 dækkede 7.276-7.286). Et forslag om en fast kadence ("hver merge-dag, samme kategorier") blev rejst i
issue-kommentaren 6/9, men er **ikke** bekræftet af ejeren, og det er derfor ikke skrevet ind som regel her.
Skal afklares med ejeren næste gang emnet kommer op; indtil da: ad hoc, udløst af akkumuleret backlog.

## 4. Stemme (gælder begge flader)

- **Jeg, aldrig vi** (undtagen diegetisk karakter-dialog), jf. `TONE_OF_VOICE.md` "Brand voice".
- **Ingen em-dash** nogensteds, heller ikke i Discord-udkast.
- **Intet opfundet indhold:** Discord-teksten er per definition ikke opfundet, fordi den er et ordret udsnit
  af en allerede godkendt sitetekst (§3). Skriv aldrig en sætning der ikke allerede står i `patchNotes.js`.
- **Korte:** samme længdedisciplin som sitet. 2/9-udkastet holdt hver sprogblok under 2.000 tegn
  (issue-kommentar 2/9); det er observeret praksis, ikke en talfæstet regel andetsteds, men et fornuftigt
  loft at sigte efter for en catch-up der dækker flere versioner.

## 5. Efterkontrol (audit): hvad rutinen dækker

Efterkontrollen sammenligner tre ting for et givent vindue: merged PR'er (git-log), sitets entries
(`patchNotes.js`) og hvad der faktisk er postet i Discord. Dokumenterede kørsler:

- **2/9** (7 dage, 26/8-2/9): 120 merges matchet; 7 spillervendte ændringer manglede på sitet, tilføjet som
  v7.234 i PR #4605. Discord-catch-up for 7.148-7.231 postet samme dag.
- **6-7/9:** ejeren bad 6/9 om et 14-dages-vindue (kommentar i
  [#4521](https://github.com/NicolaiDolmer/CyclingZone/issues/4521)). Det eneste sporbare resultat er et
  Discord-udsnit for v7.256-7.261 (commit `5f7548787`), ikke en fuld krydskontrol af vinduet. En fuld
  14-dages-efterkontrol er altså ikke dokumenteret kørt.

- **1/10** (7 dage, 24/9-1/10, [#6014](https://github.com/NicolaiDolmer/CyclingZone/issues/6014)): 223 merges,
  prod-flag (`app_config`) og Discord krydstjekket. 6 spillervendte ændringer manglede på sitet, tilføjet som
  v7.330; `rollout` sat på alle entries 7.297-7.329. Rapport: [`docs/reports/2026-10-01-patch-notes-7day-audit.md`](reports/2026-10-01-patch-notes-7day-audit.md);
  Discord-udkast: [`docs/drafts/2026-10-01-patch-notes-catchup-discord.md`](drafts/2026-10-01-patch-notes-catchup-discord.md).

Denne rutine er ikke schemalagt automatisk; den køres når ejeren beder om det, eller når en session opdager
at Discord er kommet bagud.

## Kilder

| Emne | Kilde |
|---|---|
| Udrulnings-markering (`rollout`) | §2a, ejer 1/10, [#6014](https://github.com/NicolaiDolmer/CyclingZone/issues/6014) |
| Format-regler (felter, ét tal, EN/DA, em-dash) | [`TONE_OF_VOICE.md`](TONE_OF_VOICE.md) §"Patch notes · format", låst 14/8, [#3680](https://github.com/NicolaiDolmer/CyclingZone/issues/3680) |
| "Udsnit, ikke ny tekst"-reglen | ToV §2.2, samme afsnit |
| Udsnit-praksis (eksempel) | [`docs/drafts/discord-patch-notes-2026-09-17.md`](drafts/discord-patch-notes-2026-09-17.md) |
| Fragmenter + nummer ved merge | §1, [#8346](https://github.com/NicolaiDolmer/CyclingZone/issues/8346), `scripts/patch-notes-number.mjs`, `frontend/src/data/patch-notes/README.md` |
| CI-gate (version + fragmenter) | `scripts/check-patch-notes-version.js` |
| Advisory coverage-guard | `scripts/check-patch-notes-coverage.js`, [#3638](https://github.com/NicolaiDolmer/CyclingZone/issues/3638) |
| Efterkontrol-værktøj | `scripts/patchnotes-audit.sh` |
| Ejeren poster selv | Issue [#4521](https://github.com/NicolaiDolmer/CyclingZone/issues/4521) kommentarer 2/9 + 6/9; memory `feedback_never_send_player_messages_on_owners_behalf.md` |
| Bølge-lane-PR skriver sit eget fragment (afløser "ingen patch note i bølge-lane-PR") | §3, [#8346](https://github.com/NicolaiDolmer/CyclingZone/issues/8346) |
| Kanaler (Discord) | [`COMMS_PLAYBOOK.md`](COMMS_PLAYBOOK.md) §2.1 |
| Åben kadence-diskussion | Issue [#4521](https://github.com/NicolaiDolmer/CyclingZone/issues/4521), kommentar 6/9 |
