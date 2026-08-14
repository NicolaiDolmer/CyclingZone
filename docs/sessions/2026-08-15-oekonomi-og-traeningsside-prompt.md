# Session-prompt: økonomi-beslutningerne og træningssidens struktur

**Model:** Opus 5 i hovedtråden · **Indsats:** high · **Form:** beslutnings-session først, derefter bygge-spor
**Skrevet:** 14/8 ved close-out af workflow-sessionen

---

## Prompt (kopiér ind som første besked)

> Læs `docs/NOW.md`, `docs/MASTERPLAN.md` og disse to i den rækkefølge:
>
> 1. `docs/superpowers/specs/2026-08-14-oekonomi-designkritik.md` — dommen over værdi- og løndesignet. Læs §1, §3.1, §5 og §7.
> 2. `docs/superpowers/specs/2026-08-14-vaerdi-og-loen-fundament-design.md` — de fire beslutninger fra 14/8 og de to advarsler om at to af dem faldt.
>
> **Del 1 er beslutninger, ikke kode.** Syv står i designkritikkens §7 med anbefaling ved hver. Stil dem ét ad gangen, anbefaling først, i klart sprog. Forklar altid hvad et issue handler om; jeg husker det ikke ud fra et nummer.
>
> **Del 2 er træningssidens struktur** (#3721), som er en selvstændig opgave og ikke må blandes sammen med økonomien.
>
> **Stil mange spørgsmål.** Hellere ét ad gangen for mange end at bygge på en antagelse. Gætter du på hvad jeg mener, så sig at du gætter.
>
> Vis mig ting visuelt frem for at beskrive dem. Vær kritisk over for dit eget arbejde. Intet merges uden mit go.

---

## Læringer fra 14/8 der SKAL bæres med

Læs [`.claude/learnings/2026-08-14-maal-bygget-paa-et-tal-jeg-ikke-havde-sporet.md`](../../.claude/learnings/2026-08-14-maal-bygget-paa-et-tal-jeg-ikke-havde-sporet.md). Kort:

1. **Spor et tal til sin producent før du giver det en rolle i en gate.** To gates faldt 14/8 fordi de var bygget på tal jeg behandlede som givne. Et forhold hvor tæller og nævner produceres af det samme system måler systemet, ikke virkeligheden. En metrik der bruger systemets eget output som facit måler enighed, ikke sandhed.
2. **En `git branch`-print er ikke en guard.** Det bed to gange 14/8, anden gang selvom branchen stod på skærmen. Guarden skal stoppe committen: `B=$(git branch --show-current); [ "$B" = "main" ] || exit 1`. Workflow-agenter efterlader hoved-checkoutet på deres egen branch.
3. **Læs koden før du designer oven på den.** Hele værdi-designet 14/8 handlede om at give markedet mere at sige, uden at nogen havde læst den kodelinje der forbyder markedet at sige noget. Det tog kritikken en time at finde.
4. **Et bart `#N` er ubrugeligt.** Beskriv altid hvad et issue er.
5. **Design først, angrib bagefter.** Rækkefølgen var rigtig 14/8. Det der virkede var at sætte kritikere til at modbevise frem for at validere, og derefter modprøve hver kritik mod prod. De fleste kritikker falder på at deres scenarie ikke opstår i den virkelige population.

---

## Hvad der skete 14/8, kort

**Leveret og merget:** patch notes-formatet låst og hele backloggen v7.112 til v7.122 postet · trænings-kvitteringen (#3709 trin 1, lukkede #3649, #3651, #3706) · radar-skalaen (#3707) · patch note v7.124.

**Designet:** værdi- og løn-fundamentet, fire ejer-beslutninger.

**Og så blev det kritiseret sønder og sammen**, som ejeren bad om. To af de fire beslutninger faldt.

## Del 1 · De syv beslutninger

Alle står i `2026-08-14-oekonomi-designkritik.md` §7 med anbefaling og pris. Rækkefølgen herunder er efter hvad der blokerer mest.

| # | Beslutning | Hvorfor den kommer først |
|---|---|---|
| 1 | Fjern loftet på egen-rytter-udbudspris, erstat med 5x-loft + to-budgiver-krav ([#3729](https://github.com/NicolaiDolmer/CyclingZone/issues/3729)) | **Alt andet hviler på den.** Uden den kan markedet aldrig sige at noget er mere værd end modellen tror, og hele planen om spillerdrevne værdier har intet datagrundlag |
| 2 | Skal banken sælge på rigtig auktion med reserve i stedet for gulv lig fuld værdi | Rører spillets største pengedræn (53,3 %). Må ikke ships uden drænvagten |
| 6 | Løft D4's indtægt før #3393 ([#3730](https://github.com/NicolaiDolmer/CyclingZone/issues/3730)) | **Eneste beslutning der er blokerende for #3393.** 55 nye hold ville få 55,4 % af deres indtægt i løn |
| 3 | Erstat 75/25-kalenderblandingen med evidensvægt pr. rytter (Bühlmann, `Z = n/(n+12)`) | Afviger bevidst fra ejer-beslutning 1 og fjerner beslutning 3 helt. Prisen ved at afvise står i §7 |
| 4 | Lønnens grundlag = Ankerværdien i stedet for den viste Værdi | Billigt, bevarer ejer-beslutning 4 ordret, fjerner den usikkerhed der holdt #3393 i draft |
| 5 | `anchorSalary` kalibreret hver sæson mod 35 % af målt indtægt, ét globalt A | Ét A pr. division ville bryde ejer-beslutning 4 |
| 7 | Tidsbaseret transferskat nu eller først hvis drænet falder | Ligger tættest på doktringrænsen. Anbefaling: byg måleren, ikke skatten |

**Forudsætninger der ikke er beslutninger, men skal med i billedet:** [#3719](https://github.com/NicolaiDolmer/CyclingZone/issues/3719) og [#3720](https://github.com/NicolaiDolmer/CyclingZone/issues/3720) fra den parallelle session måler at præmien pr. hold er 3,7 til 6,6 gange fra det upkeep-kalibreringen antog. Et fundament bygget på simuleret præmieindtjening kan ikke kalibreres mens præmien selv er ude af kontrol.

### #3449 og #3393, status

**#3449 skal ikke merges.** Fire grunde i `docs/audits/2026-08-14-oplaas-vaerdier-og-loefter.md`. Den første er en kalender: sweepet kan kun køre om søndagen, så fredagsløftet var strukturelt umuligt. Anbefalingen er: rebase, behold koden og de 49 unit-tests, **slet modelartefaktet**, hold PR'en som draft, refit efter typebeslutningen mod en ikke-cirkulær metrik.

**#3393 er draft indtil beslutning 4, 5 og 6.** Lønkurvens konkave form er målt god og bør ikke laves om: den fjerner 8 af 9 dele af alders-inversionen.

## Del 2 · Træningssidens struktur ([#3721](https://github.com/NicolaiDolmer/CyclingZone/issues/3721))

Selvstændig opgave. Bland den ikke med økonomien.

Træningssiden og rytterprofilen er designet indholdsmæssigt uden at nogen har designet **siden**. Rosteret er det sjette element på `/training`, målt med kun én rytter i truppen. Rytterprofilen viser nu evnelisten to steder, fordi Overblik-fanen allerede har alle 15 evner med en fremdriftsbar.

**Det gater #3709 trin 2**, som lægger et nyt fokus på samme flade, og trin 4, som lægger en tabel mere. Ejer-citat 14/8: *"Bør vi ikke gøre det mere simpelt og lettere at finde rundt inde på træningssiden. Lige nu er der allerede rigtigt meget scrolling."*

**Behandl træningssiden og rytterprofilen som ÉN opgave.** Dubletten ligger mellem dem. Hører sammen med #3660 og #3659.

## Ting der venter på ejeren

- **Post v7.123 og v7.124** på Discord (`docs/discord/2026-08-14-patch-notes-7123.md` og `-7124.md`). Indsæt fra råteksten, ikke fra en gengivet visning
- **Post beskeden om værdier og lønninger.** Udkast EN + DA i `docs/audits/2026-08-14-oplaas-vaerdier-og-loefter.md`. Løftet fra 11/8 brydes, og tavshed er det eneste udfald der er værre end en udskydelse
- **#3486** `VERCEL_TOKEN`, to minutters klik, låser #1784
- **Fire åbne PR'er:** #3725 og #3728 (dokumenter fra 14/8) · #3727 (den parallelle session) · #3512, #3449, #3393 (drafts)

## Løfte-hovedbogen

15 løfter til spillerne er uindfriede eller kun halvt indfriet, sorteret fra 20 dage ned til 0 i `docs/audits/2026-08-14-oplaas-vaerdier-og-loefter.md` del 2. De tre der skal tages først: beskeden om værdier (i dag) · #3618 akademi-tilbuddenes udløbskvote (det eneste løfte der bliver **mere** usandt mens vi ser på det, kø vokset 368 til 772 på tre dage) · #3715 og #3620 de forkortede kontrakter (det eneste hvor ventetid gør reparationen sværere; rod-årsag før datareparation).

## Rammer

- 23/8-cutoveren er dato-bundet. #3459 race-day-flip er færdig og har egen kill-switch. **#3514 mandat anbefales droppet fra cutoveren** efter sin egen 19/8-regel; intet er bygget
- Agent-regler: `git checkout -b <branch> origin/main` først · sekventielt, ingen under-agenter · gh gennem `scripts/lib/gh-retry.sh` · PR-body med `## Brugerverifikation` og mindst ét `[x]` · kun ÉN fuld e2e-suite ad gangen
- **Verificér branch i selve commit-kæden.** Det bed 14/8: en workflow-agent efterlod checkoutet på en PR-branch, og en docs-commit landede det forkerte sted
- **Tjek om der kører en anden session** før du går i gang. 14/8 kørte to uden at vide om hinanden ([#3712](https://github.com/NicolaiDolmer/CyclingZone/issues/3712)). Working agent-feltet kan kun rumme én, så kig også på nyligt oprettede issues og åbne branches
