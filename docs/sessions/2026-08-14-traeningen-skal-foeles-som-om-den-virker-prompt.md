# Session-prompt — træningen skal føles som om den virker

**Ejer-mandat 13/8, ordret** ([#3659](https://github.com/NicolaiDolmer/CyclingZone/issues/3659)):

> *"Vi er simpelthen nød til at gøre sådan, at spillerne har en mere forståelig process for dem omkring træning. Hvornår kan ryttere udvikle sig? Hvornår kan de ikke? I hvad? Hvordan? Hvornår rammer ryttere loftet. Hvorfor? Hvordan? De skal ikke overfaldes i ord. … Det er meget vigtigt, at spillerne føler, at rytterne kan udvikle sig igen, fordi spillerne lige nu, føler at udvikling på deres ryttere er gået i stå."*

**Form:** workflow-session — ejeren har godkendt multi-agent-orkestrering. **Model:** Opus 5, høj reasoning; sonnet-workers.
**Leverance:** godkendt forslag + spec + issues. **Der skrives ingen feature-kode i denne session** (ejer-valg, og #3659 siger ordret "forslag først").
**Kører EFTER landing 1 er merged og live.** Begrundelse i §Rækkefølge.

---

## Prompt (kopiér ind som første besked)

> Spillerne føler at deres ryttere er holdt op med at udvikle sig. Vi skal finde ud af om det er sandt, og derefter gøre træning og lofter forståelige uden at overfalde nogen i ord.
>
> Brug en workflow-session. Læs først `docs/sessions/2026-08-14-traeningen-skal-foeles-som-om-den-virker-prompt.md` — den bærer alt der allerede er besluttet og målt. Derefter #3659, #3643 og #3664-tråden (beslutning 7).
>
> Leverancen er et **godkendt forslag**, ikke kode: målingerne, spillernes egne ord, mockups jeg kan sige ja eller nej til, og til sidst en spec plus issues.
>
> Stil spørgsmål ét ad gangen med anbefaling først, og vis mig tingene visuelt undervejs — prosa er ikke nok når det er tal eller før/efter.

---

## Det første spørgsmål er ikke et UX-spørgsmål

Issuet er filed som UX. **Antag ikke at det er et UX-problem.** Målingen skal komme først, og den skal kunne afkræfte præmissen:

- Hvor mange evne-point tjener en rytter reelt pr. uge? Fordelt på alder, og på om holdet er menneske-ejet.
- Hvor mange ryttere har mindst én evne der ER på sit loft? Det er den gruppe hvor "træning gør ingenting" er **bogstaveligt sandt**, og for dem er svaret ikke en bedre forklaring.
- Hvor lang tid er der fra nu til loftet ved nuværende tempo, pr. aldersgruppe?

Hvis udviklingen faktisk er langsom, er svaret balance — og så skal sessionen sige det højt i stedet for at pakke det ind i en pænere flade. Hvis den er fin men usynlig, er svaret UI. **Begge udfald er acceptable; det er kun et udokumenteret gæt der ikke er.**

## Hvad der ALLEREDE er låst — genåbn ikke

| Beslutning | Konsekvens |
|---|---|
| **Træningsfladens indhold** (#3664 beslutning 7, ejer 13/8) | Fladen skal vise **fremgangsbar, ugens optjente point, opskriften ("tæller for sprinter"), loft-tilstand pr. evne og tempo**. Sessionen designer HVORDAN, ikke HVAD |
| **Tempo formuleres som hastighed** | "~1 point om ugen" — **aldrig** som ankomsttid. En ankomsttid afslører det maskerede loft |
| Rating-modellen fra landing 1 | Rating = vægtet snit af rollens evner; potentiel rating = samme på `ability_caps`. Én skala hele siden. Rør den ikke |
| Maskeringen (#1543/#1162) | Loftet må aldrig kunne aflæses eksakt. Se §Faldgruber — der er et åbent fund her |
| `capsShaping` = landing 2, efter cutover | `positioning` har spillets laveste loft men tæller i 5 af 8 opskrifter. Kendt mismatch — **fiks den ikke her** |
| #3668 (evne-skalaens rod) | Egen sag efter cutover. Taktik median 34 mod bjerg 6 er ikke rytterne, det er behandlingen |
| `PAGE_TEMPLATES.md` er bindende | T1/T2/T3. Én gold primary pr. view, hairline-borders, 5px radius, tabular figures, stroke-ikoner, ingen emoji, ingen AI-slop |
| Denne session bygger ikke | #3643's mobil-rework arver svaret som kravspec og bygges separat |

## Målt allerede — brug tallene, gentag ikke arbejdet

Alt read-only mod prod 13/8.

- **Den nye skala er MINDRE træningsfølsom end den gamle.** Andel ryttere hvor det viste tal slet ikke flytter sig på en uge: 28,8 % → **38,3 %** (målt på 2.445 ryttere på hold over ~5,6 døgn). Landing 1 gør altså isoleret set følelsen værre. Det er hele grunden til at denne session findes.
- **Ryttere tjener median 7 evne-point om ugen.** Bevægelsen findes — vi viser den bare ikke.
- **`ability_progress` findes allerede** som jsonb-kolonne på `rider_derived_abilities`, ved siden af `ability_caps`. Ingen migration nødvendig for at vise en dagligt fyldt bar pr. evne.
- **Lofterne var aldrig ødelagte.** Ikke én evne har loft ≥95 hos mere end en håndfuld af 8.731 ryttere; medianlofter 9-46. #3592's "88 % har loft 99" var fabrikeret af normaliseringen.
- **Fordelingerne efter landing 1** (n = 8.747): nuværende rating p25 9 · median 13 · p90 29 · maks 85. Potentiel rating median 44 · p90 65 · maks 85. Median luft nu→loft: **29 point**.
- **0 ryttere** mangler `primary_type` eller en evne-række. Ingen tom-tilstand at designe for.
- **Feedback-indbakken på hjemmesiden er tynd:** 9 rapporter i alt siden 23/7, heraf 4 de sidste 14 dage. Substansen ligger i Discord og forummet — vægt dem derefter.

## Spillernes feedback — sidste 14 dage

Ejer-krav. Kilder, i prioriteret rækkefølge:

1. **Discord** — alle tekstkanaler + forum-tråde. Kendt tråd: *"Is Development dead now?"* (flere svar 12/8), hvor spillere skriver at de **venter med at træne** indtil lofterne er opdateret.
2. **Feedback på hjemmesiden** — tabellen `player_feedback`. Fire poster i perioden; læs dem, men forvent ikke at de bærer analysen.
3. **Løfter ejeren har givet.** Kendt: *"Update to rider types ceilings is expected to be released tomorrow"* (12/8, #the-roadbook + #bugs). Hvad er lovet, og er det leveret?

Emner der skal dækkes: udvikling, progression, træning, akademier, lofter, ryttertyper.

**Formen på outputtet:** ét afsnit pr. tema med citat, dato og issue-nummer. Ikke en rapport ejeren skal grave i. Skeln mellem *"spilleren har misforstået noget"* (→ UI/copy) og *"spilleren har ret"* (→ balance eller bug) — den skelnen er hele pointen.

## Hvordan workflowet bør formes

**Fan-out på indsamling og verifikation. Ikke på designbeslutningerne** — dem tager ejeren, ét spørgsmål ad gangen.

- **Fase 1, parallel:** (a) feedback-sweep pr. kilde · (b) prod-måling af om udviklingen faktisk er gået i stå · (c) audit af hver flade der i dag påstår noget om udvikling, lofter eller træning · (d) hvad hjælpen og FAQ'en siger i dag. Struktureret retur, ingen redigering.
- **Fase 2, enkelttrådet med ejeren:** spørgsmål ét ad gangen med anbefaling først. Mockups vist visuelt **før** hver beslutning — ejer-krav, gentaget tre gange i rating-sessionen.
- **Fase 3, adversarisk:** én verifikator pr. forslag, prompted til at **modbevise** det. Vigtigst: lækker forslaget loftet? Overlever påstanden målingen?
- **Fase 4:** completeness-kritiker — hvilken flade er ikke kortlagt, hvilket løfte er ikke sporet, hvilken påstand er ubekræftet?

## Faldgruber

- **"De skal ikke overfaldes i ord."** Ejerens egen formulering. Et forslag der løser forståelsen med mere tekst har misforstået opgaven. Bar, tal og tilstand slår afsnit.
- **En fremgangsvisning må ikke lække loftet.** Viser du "3 point tilbage til loftet", har du udleveret loftet. Viser du en bar der fyldes mod en usynlig ende, har du ikke. Enhver mockup skal holdes op mod #1543/#1162.
- **Åbent fund, 13/8:** loft-båndet er målt **inverterbart** — en angriber der ser båndet på to scout-niveauer kan regne loftet ud med median-fejl 0,1-0,4 rating-point. Fundet er præ-eksisterende (ikke indført af landing 1), harnessen ligger i `backend/lib/ceilingBandInversion.test.js`. **Afklar status på det før du designer noget der viser fremgang mod loftet.**
- **Verificér mod runtime, ikke mod en anden tekst.** #3591's præmis var 0 af 3.293 da den blev målt. #3592's "88 % med loft 99" var et normaliserings-artefakt. Præmisser i dette område har en historik for ikke at holde.
- **Rating-tallet kan ikke bære følelsen.** Målt: den nye skala bevæger sig mindre, ikke mere. Et forslag der forsøger at gøre rating-tallet mere responsivt arbejder imod en ejer-låst beslutning.
- **Loop-guard:** 2 CI-fejl på samme symptom → stop og spørg.

## Rækkefølge — hvorfor efter landing 1

Træningsfladen viser præcis de tal landing 1 lægger om: rating, potentiel rating og loft-båndet. At designe forklaringen af tal der er ved at ændre sig ville være at designe mod et bevægeligt mål. Dertil lukker landing 1 #3649's første lag af sig selv, fordi træningsfladen og scoutingen så læser samme kilde — den modsigelse skal ikke stå i grundlaget for et redesign.

Ingen andre sessioner blokerer.

## Kilder

#3659 (ejer-direktivet, ordret citat) · #3643 (mobil-reworket der arver svaret) · #3644 (desktop-kvalitetspasset) · #3664-tråden (de 8 beslutninger, særligt nr. 7) · #3649 · #3583 · #3541 · #3456 · #3564 (progressionskæden) · #3459 (løbsdags-modellen) · `docs/design/PAGE_TEMPLATES.md` · `docs/superpowers/specs/2026-08-13-rating-fundament-v3-design.md`
