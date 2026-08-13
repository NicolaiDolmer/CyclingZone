# Session-prompt — transparens: spillerne skal kunne stole på det de ser

**Ejer-mandat 13/8, ordret:** *"Det er hamrende vigtigt, at spillerne kan stole på den information de ser."* og *"Det er nød til at være sådan, at spillerne ikke tror at en rytter kan komme op på 99 i rating i en rytertype, hvor det overhovedet ikke er muligt for dem."*

**Køres:** efter #3666 + #2454 er deployet (landing 1). Ikke før — halvdelen af problemet forsvinder af sig selv dér, og den anden halvdel kan først formuleres når den nye skala er live.
**Model:** Opus 5, høj reasoning. Subagenter: sonnet.
**Form:** måling først, derefter copy og UI. Vis ejeren visuelt undervejs.

---

## Prompt (kopiér ind som første besked)

> Vi laver transparens-sessionen. Rammen er min egen: **spillerne skal kunne stole på det de ser.** Efter tre uger med rystelser er tilliden det vi mangler, ikke tallene.
>
> Læs først: `docs/sessions/2026-08-13-transparens-session-prompt.md` (denne fil — den bærer beslutningerne fra 13/8), #3664's designsession-kommentar, og `docs/superpowers/specs/2026-08-13-rating-fundament-v3-design.md` §D5.
>
> **Mål alt før du foreslår noget.** Den sidste session fandt to ting som ingen havde målt, og begge ændrede designet. Antag ikke at en flade er ærlig, fordi den ser ærlig ud.
>
> Stil mig spørgsmål ét ad gangen med din anbefaling først.

---

## Det konkrete problem der er tilbage efter landing 1

Landing 1 fjerner de fabrikerede 99'ere: rating-tallet bliver absolut, og den bedste rytter i spillet lander på ~85 i stedet for 99. Men **tre løgne overlever**, og de skal alle findes og lukkes.

### 1. Loft-båndets øverste kant overdriver med vilje

Vi viser `sandhed + halvbredde`. En rytter med sandt loft 46 vises som "34-58" — og 58 kan han **aldrig** nå. Det er ikke en fejl; det er selve maskeringen. Hvis øverste kant altid var sandheden, kunne spilleren bare aflæse den.

**Beslutning 13/8:** båndet formuleres som *"et sted herinde"*, aldrig som *"kan nå op til"*. Én formulering, hele vejen igennem, EN først og DA under.

**Opgave:** find hver eneste streng i `rider.json`, `help.json` og komponenterne der formulerer et bånd som en øvre grænse, og omskriv dem. Det er en grep-opgave, ikke en skøns-opgave — lav en liste før du retter.

### 2. Spilleren kan ikke se hvad der tæller

Det er den vigtigste. En rytter viser 24 i sin rolle, spilleren træner en uge, tallet flytter sig ikke — og der findes **ingen flade** hvor han kan se hvilke evner der overhovedet indgår i tallet.

Målt 13/8: efter omlægningen flytter det viste tal sig **slet ikke** for 38,3 % af rytterne på en uge (op fra 28,8 %). Uden opskriften synlig er det uforklarligt.

`#3643`'s træningskort viser opskriften ("tæller for sprinter") lokalt. **Denne session skal beslutte om den også hører hjemme på rytterprofilen og i hjælpen** — overlapper #3623 og #3667's tredje punkt.

### 3. Navnesammenfaldet (#3649 lag 2)

"sprint" er samtidig en evne, et træningsfokus og en ryttertype. Ejeren måtte forklare det manuelt i Discord 11/8. Ejerens egen formulering er teksten der mangler i UI'et:

> "Theres a stat named sprint / A training type named sprint / And a rider type named sprinter. These things is not the same."

---

## Spørgsmål sessionen skal stille ejeren

1. **Hvor meget skal opskriften eksponeres?** Kun på træningskortet (#3643), eller også på rytterprofilen og i hjælpen som en opslagstabel over alle 8 roller? Anbefaling først. Vis et mockup.
2. **Skal loft-båndets bredde forklares for spilleren?** I dag er det tavst hvorfor båndet snævrer ind ved scouting. Et "jo mere du scouter, jo smallere" er en tillids-gevinst — men det afslører også at midten ikke er sandheden. Afvej.
3. **Hvad gør vi ved rating 99?** Toppen af skalaen står tom, fordi ingen har maxet sine evner. Ejeren accepterede det 13/8, men spillerne har ikke fået det forklaret. Er det en hjælpetekst, en patch note, eller noget synligt i UI'et?
4. **Er der andre flader der lover noget de ikke holder?** Sessionen skal selv finde dem — se opgaven nedenfor.

---

## Obligatorisk opgave: en audit, ikke et gæt

Før noget besluttes: **gennemgå hver spillervendt flade der viser et tal om en rytters fremtid** og afgør om påstanden er sand. Kandidater at starte fra (ikke udtømmende — find selv resten):

- Scoutingfanens legende og verdict-tekster (`buildVerdict`, `rider.json`)
- Udvikling-fanens loft-zone og projektions-bånd (`developmentProjection.js`)
- Hero'ens potentiale-visning
- Akademiets tilbudskort
- `help.json`'s `riderRating`- og `typeRatingScaleFaq`-poster (begge kendt løgnagtige, se #3667)
- Træningsfladens loft-beskeder (#3639/#3649)

Skriv resultatet som en tabel: **flade · hvad den påstår · er det sandt · hvad den skal sige i stedet.** Den tabel er sessionens egentlige leverance; koden følger efter.

---

## Faldgruber

- **Verificér mod runtime, ikke mod en anden tekst.** #3591's præmis viste sig at være 0 af 3.293 da den blev målt. Designsessionen 13/8 fandt to ting mere: frontend-vægtkopien var allerede drevet, og der fandtes et femte uadskilleligt rollepar ingen havde målt.
- **Ikke-inverterbarheden er ufravigelig** (#1543/#1162). Enhver ny transparens skal testes mod `scoutingInversionHarness`: kan en spiller regne sandheden ud af det vi nu viser? Hvis ja, er det ikke transparens, det er en lækage.
- **Ingen opfundet copy.** EN først, DA under. Teksten skal kunne holdes op mod spec'en.
- **Patch notes + `help.json` (en+da)** ved enhver brugerrettet ændring — eller skriv hvorfor ikke.

## Relateret

#3667 (kommunikationspakken — denne session leverer råmaterialet) · #3649 lag 2 · #3623 · #3643 · #1543/#1162 (maskeringen) · #3664 (designsessionen)
