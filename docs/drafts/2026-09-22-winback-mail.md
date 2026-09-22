# Win-back-mail, ejer-godkendt tekst 22/9 (#2760)

Pladsholdere: [Holdnavn] = teamName · [placering] i [pulje] = rankInDivision + poolLabel (linjen udelades hvis rank mangler) · "N days ago"-varianten udgår; statuslinjen er den samme for alle.

## EN

**Subject:** We missed you. Season 4 starts 28 September.

Hi,

[Holdnavn] is still yours, exactly as you left it. It kept racing while you were away and currently sits [placering] in [pulje].

A lot has happened since you were last here, and more lands with season 4:

- **Training has been rebuilt.** Three new hard sessions, a training score from 1 to 99 on every rider, and from season 4 your riders train per race day instead of per calendar day, so a busy week and a quiet week finally feel different.
- **A real board.** Your board now hands you mandates and holds proper meetings. Ignore them at your own risk.
- **The academy got Graduation Day.** Your talents turn 23 and you decide who moves up, who is sold and who is released. U23 and junior squads are next.
- **Rider values get fixed properly.** Value follows the rating you see on the card, so training you can see becomes value you can see.
- **Same chances to develop, whatever your division.** In season 4 every division has the same number of training days, so your riders develop as fast in division 4 as in division 1.
- **A new race engine arrives with season 4.** Races are run in segments, so breaks, climbs and finales play out where they should.

Season 4 starts 28 September. Teams that stay away are parked outside the divisions at the switch, so if you want back in, this is the week.

[Knap: Go to your team]

## DA

**Emne:** Vi har savnet dig. Sæson 4 starter 28. september.

Hej,

[Holdnavn] er stadig dit, præcis som du forlod det. Holdet kørte videre mens du var væk og ligger lige nu som [placering] i [pulje].

Der er sket meget siden sidst, og mere lander med sæson 4:

- **Træningen er bygget om.** Tre nye hårde pas, en træningsscore fra 1 til 99 på hver rytter, og fra sæson 4 træner dine ryttere pr. løbsdag i stedet for pr. kalenderdag, så en travl uge og en stille uge endelig føles forskelligt.
- **En rigtig bestyrelse.** Din bestyrelse giver dig nu mandater og holder rigtige møder. Ignorér dem på eget ansvar.
- **Akademiet har fået Graduation Day.** Dine talenter fylder 23, og du bestemmer hvem der rykker op, sælges eller frigives. U23- og juniortrupper er det næste.
- **Rytterværdierne bliver rettet ordentligt.** Værdien følger den rating du ser på kortet, så træning du kan se bliver værdi du kan se.
- **Samme muligheder for udvikling, uanset division.** I sæson 4 har alle divisioner lige mange træningsdage, så dine ryttere udvikler sig lige så hurtigt i division 4 som i division 1.
- **En ny løbsmotor kommer med sæson 4.** Løbene køres i segmenter, så udbrud, stigninger og finaler afgøres der hvor de skal.

Sæson 4 starter 28. september. Hold der bliver væk parkeres uden for divisionerne ved skiftet, så vil du med igen, er det denne uge.

[Knap: Gå til dit hold]

## Forudsætninger før afsendelse

- "A real board" og "training score on every rider" er sande for alle først når `board_mandate_model_enabled` og `training_score_visible` er flippet fra beta til on (ejerens flip). Ellers blødes de to linjer op til "arrives with season 4".
- Tørkørsel: frisk segment (30 dage uden login + mailsamtykke + suppression), antal EN/DA, 3 eksempler. Send-go er ejerens. Flag `winback_send_enabled` tændes kun under selve kørslen.
