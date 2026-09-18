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
  `scripts/check-patch-notes-version.js` er CI-gate: blokerer merge uden versionsbump.
- `scripts/check-patch-notes-coverage.js` er **rådgivende, ikke blokerende** ([#3638](https://github.com/NicolaiDolmer/CyclingZone/issues/3638),
  eksplicit ejer-beslutning: *"Flaggeren bør foreslå, ikke blokere"*): den flager sandsynlige manglende
  entries på frontend-ændringer, exitcode 0 altid.
- `scripts/patchnotes-audit.sh` er efterkontrol-værktøjet: sammenligner merged PR'er mod entries i
  `patchNotes.js`. Brugt til 7-dages-auditten 2/9 ([#4605](https://github.com/NicolaiDolmer/CyclingZone/pull/4605))
  og 7/9-sweepet (ejer-direktiv, 14-dages-vindue, se §5).

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

**Ingen patch note i en bølge-lane-PR:** bølge-worker-PR'er samler ikke patch notes undervejs; de lægges
samlet ved close-out for at undgå merge-konflikter i `patchNotes.js` (`feedback_parallel_workers_e2e_slot.md`).
Discord-udkastet følger samme rytme: det skrives når entries er samlet, ikke pr. enkelt-PR.

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
(`patchNotes.js`) og hvad der faktisk er postet i Discord. Kørt to gange:

- **2/9** (7 dage, 26/8-2/9): 120 merges matchet; 7 spillervendte ændringer manglede på sitet, tilføjet som
  v7.234 i PR #4605. Discord-catch-up for 7.148-7.231 postet samme dag.
- **7/9** (ejer-direktiv, 14-dages-vindue efter direkte besked i Discord #feedback-from-dolmer): samme
  metode, udvidet vindue.

Denne rutine er ikke schemalagt automatisk; den køres når ejeren beder om det, eller når en session opdager
at Discord er kommet bagud.

## Kilder

| Emne | Kilde |
|---|---|
| Format-regler (felter, ét tal, EN/DA, em-dash) | [`TONE_OF_VOICE.md`](TONE_OF_VOICE.md) §"Patch notes · format", låst 14/8, [#3680](https://github.com/NicolaiDolmer/CyclingZone/issues/3680) |
| "Udsnit, ikke ny tekst"-reglen | ToV §2.2, samme afsnit |
| Udsnit-praksis (eksempel) | [`docs/drafts/discord-patch-notes-2026-09-17.md`](drafts/discord-patch-notes-2026-09-17.md) |
| CI-gate (version) | `scripts/check-patch-notes-version.js` |
| Advisory coverage-guard | `scripts/check-patch-notes-coverage.js`, [#3638](https://github.com/NicolaiDolmer/CyclingZone/issues/3638) |
| Efterkontrol-værktøj | `scripts/patchnotes-audit.sh` |
| Ejeren poster selv | Issue [#4521](https://github.com/NicolaiDolmer/CyclingZone/issues/4521) kommentarer 2/9 + 6/9; memory `feedback_never_send_player_messages_on_owners_behalf.md` |
| Ingen patch note i bølge-lane-PR | memory `feedback_parallel_workers_e2e_slot.md` |
| Kanaler (Discord) | [`COMMS_PLAYBOOK.md`](COMMS_PLAYBOOK.md) §2.1 |
| Åben kadence-diskussion | Issue [#4521](https://github.com/NicolaiDolmer/CyclingZone/issues/4521), kommentar 6/9 |
