# #7859 Spoiler-skjold bygget på wireframe v6c

Ejer 16/11: de første skitser (#8241) tog ikke udgangspunkt i løbssidens wireframe v6c, hvor skjoldet allerede er designet. Denne skitse starter derfra.

- Åbn `index.html` direkte i en browser. Ren HTML: ingen import fra appen, bygges ikke af Vite, ingen produktkode.
- `?v=1` til `?v=9` vælger visning. `&marks` viser de nummererede afvigelser fra wireframet. `&shot` skjuler skitse-bjælken.
- CSS-blokken "wireframe v6c" er kopieret uændret fra wireframet, så løbssiden ser ud præcis som dér. Alt efter den er skitsens eget og bruger de samme tokens og opskrifter.
- Alle løb, ryttere, hold og tal er syntetiske (hold hedder Team A-H og "Your team").

## Billeder

`pr-screens/7859-wireframe/7859-wf-<nr>-<navn>-<1440|390>.png`. Hvert billede har nummer, navn og én sætning brændt ind øverst, afvigelserne listet under, wireframe v6c til venstre og skitsen til højre med afvigelserne nummereret. Wireframe-billederne er taget af den private wireframe-fil med holdnavne skiftet til aliaser. Visning 5-9 dækker sider, wireframet ikke viser; der står wireframets hoved og etapestribe til venstre som det mønster, der genbruges.

## Visninger

| # | Visning | Hvad den viser |
|---|---|---|
| 1 | Løbssiden, skjold fra | Standard for alle (ejervalg 16/11): en færdig etape åbner i Resultater som i wireframet |
| 2 | Skjold til, Story | Wireframets l.420 og l.528: hovedet siger "Stage finished · result hidden by your spoiler shield", referatet stopper hvor filmen er, "The finale is ahead · keep watching" |
| 3 | Skjold til, Results | Wireframets l.535/821: "Results are hidden by your spoiler shield · Show results" |
| 4 | Efter Show results | Etapen er set; kontakten bliver ved med at være slået til (afvigelse, se nedenfor) |
| 5 | Forsiden | Dagens etaper og Seneste resultat med wireframets ord |
| 6 | Indbakke og spillet | Indbakke, klokke og pop-up: "Stage 1 of [løb] is finished" |
| 7 | Browser-notifikationer og indstilling | Push med samme neutrale tekst; "Spoiler shield for all races" står som Off fra start |
| 8 | Ranglisterne | Stillingen efter din sidst sete etape, "Show latest" i sidehovedet (ingen banner) |
| 9 | Hvor skjoldet virker | Alle steder et resultat afsløres (listen fra skitsen 16/11 på `design/7859-spoiler-skjold-skitser`), hvad skjoldet gør dér, og hvilken visning der viser det |

## Afvigelser fra wireframet

1. Kontaktens slukkede spor har fået en tynd kant. Wireframets spor stod med 1,3:1 mod kortet (WCAG 1.4.11 kræver 3:1).
2. Klatringernes navne i filmen er lyse. Wireframet tegner dem mørkt på den mørke film (1,3:1).
3. Show results viser kun den etape, man står på, og kontakten forbliver slået til. I wireframet slår Show results skjoldet fra for hele løbet. Det er nødvendigt for "sidst sete etape" på ranglisterne; ellers afslører næste etape sig selv.
4. Etapestriben og Samlet viser vinder og fører for etaper, man har set; usete etaper står stadig som "Finished" og "Hidden".

## Åbne spørgsmål til ejeren

- Issue-teksten siger, at indbakken "altid" skal sige "Etape X er færdig"; S1 i specifikationen siger "når skjoldet er slået til". Skitsen viser S1: neutral tekst med skjoldet, som i dag uden.
- Mail-digesten er ikke aftalt. Forslag: samme neutrale tekst som indbakken.
- Discord er ikke en del af løsningen (ejervalg 16/11); Discord-delen fjernes med arkiv-note, når spillet selv og browser-notifikationerne dækker den.
