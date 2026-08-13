# Session-prompt 14/8: patch notes skal kunne læses af en spiller

**Ejer-mandat 13/8, ordret:** *"Jeg vil gerne have dem forbedret markant, de er for lange og rodede. Slet ikke nemme nok for spillerne at læse. Så gennemgår vi alle dem der mangler i en periode."*

**Issue:** [#3680](https://github.com/NicolaiDolmer/CyclingZone/issues/3680)
**Model:** Opus 5. Det er en skrive- og smagsopgave, ikke en kodeopgave.
**Form:** beslut formatet FØRST, skriv derefter. Ikke omvendt.

---

## Prompt (kopiér ind som første besked)

> Vi omskriver patch notes. Din egen v7.119 og v7.120 fra i går er eksemplet på problemet, så start med at læse dem.
>
> Læs: `docs/sessions/2026-08-14-patch-notes-format-prompt.md` (denne fil), [#3680](https://github.com/NicolaiDolmer/CyclingZone/issues/3680), `docs/TONE_OF_VOICE.md`, og de sidste ti poster i `frontend/src/data/patchNotes.js`.
>
> Vis mig forslag frem for at beskrive dem. Jeg vil se den samme patch note skrevet på to eller tre måder og vælge, ikke læse en analyse af hvad der er galt.
>
> Stil mig ét spørgsmål ad gangen med din anbefaling først.

---

## Det konkrete problem

Målt på filen:

| Version | Tegn (en+da) |
|---|---:|
| v7.111 | 3.517 |
| v3.90 | 3.316 |
| v7.120 | 2.809 |
| v7.118 | 2.612 |

Typisk post er 900 til 1.400 tegn **pr. sprog i ét ubrudt afsnit**, med fire ting flettet sammen: hvad der var galt, hvorfor, hvad målingen viste, hvad der er rettet, og et forbehold. Læseren skal selv skille dem ad.

v7.119 og v7.120 handlede ordret om at gøre spillet lettere at stole på. De blev skrevet så tæt at pointen forsvandt. Det er den værste mulige flade at være ulæselig på.

## Tre beslutninger sessionen skal have

Anbefaling først, ét spørgsmål ad gangen.

1. **Målform.** Fast struktur (fx *hvad ændrede sig* / *hvad betyder det for dig*) eller kortere fri tekst? Hvor kort: to linjer, fem? Vis den samme note i begge former frem for at beskrive dem.
2. **Én tekst eller to?** In-app og Discord er i dag næsten identiske. De har forskellige læsere: in-app kommer man til med vilje, Discord ruller forbi på en telefon.
3. **Hvor meget måling må blive i teksten?** *"892 ryttere står i den tilstand"* er konkret og stærkt, men tallene bærer også en stor del af vægten. De kan være bevis, og de kan være støj.

## Bagefter: backloggen

Når formatet er låst, omskrives det der ligger uposteet. **Post ikke de eksisterende udkast som de er.**

- `docs/discord/2026-08-12-patch-notes-catchup.md` (v7.112 til v7.117)
- `docs/discord/2026-08-13-patch-notes-7118-7120.md` (v7.118 til v7.120)

## Faldgruber

- **Skriv, vis, vælg.** Ejeren vil se forslag, ikke læse en analyse. Byg et show_widget eller skriv varianterne ud i klar tekst tidligt.
- **Længde er ikke et performance-problem.** Prosaen er statisk JSON siden #2108 og tæller ikke i JS-bundlen. Trim af v7.120 blev forsøgt 13/8 og flyttede nul KB. Det er ren læsbarhed.
- **Pligten ændrer sig ikke.** Patch notes er fortsat obligatoriske ved enhver brugerrettet ændring, og `check-patch-notes-version.js` er stadig CI-gate.
- **Hard copy-regler gælder:** ingen em-dash nogen steder, EN først og DA under, ingen opfundet indhold. Se `docs/TONE_OF_VOICE.md`.
- **Ejeren poster selv.** Alt bliver udkast til copy-paste.

## Relateret

#3680 · #3667 (transparens-pakken, som v7.119/v7.120 kom fra) · `docs/TONE_OF_VOICE.md`
