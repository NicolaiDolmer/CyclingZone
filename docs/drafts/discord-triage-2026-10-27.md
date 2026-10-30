# Discord-triage 27/10/2026

Refs #7153. Læst via Discord REST, kun GET. Vindue: 25/10 kl. 13:11 til 27/10 kl. 13:12 dansk tid. Alle tekstkanaler blev forsøgt læst, og aktive samt arkiverede forumtråde med aktivitet i perioden blev læst. Staff indgår. Ingen læsefejl returneret. Prioriteringen her gælder svar og undersøgelse, ikke en omprioritering af MASTERPLAN.

Private afsendernavne, hold, ryttere, billeder og staff-links er udeladt. Kildekortet ligger privat i OneDrive `private-handoffs/merge-26-10/discord-triage-27-10/`. Ingen beskeder er sendt.

## Prioriteret opfølgning

| Prioritet | Problem/spørgsmål | Issue og næste skridt |
|---|---|---|
| Først | Ingen træning mellem sæsoner; meget lav eller manglende fremgang efter indhentning | #7282 er leveret. Kurve B-opfølgningen findes på #3564/#6110. Kontrollér næste afregning før et løfte om at alt er rettet. |
| Først | Form falder før første løb | Sæsonstartrettelsen er leveret i PR #7288. Kontrollér næste afregning; undgå at love tilbageførsel. |
| Først | Matrix flytter udtagelser til andre datoer, retter sig ved genåbning | **Ny #7294**. Konkret reproduktionsforløb; runtime endnu ikke reproduceret. |
| Først | Forrige sæsons sejre tæller som nye hos bestyrelsen | **Ny #7295**. Skeln sæsonmål fra flerårige mål før rettelse. |
| Først | Dashboard sender til et uventet næste løb | **Ny #7296**. Kontrollér pulje, dato, udtagelse og forventet rækkefølge; forkert løbsvalg er ikke bevist. |
| Derefter | Handler efter sæsonskiftet står i forrige sæson | #7285. Undersøg historikkens sæsonafgrænsning. |
| Derefter | Rytter står til salg efter at have forladt holdet | #7284. Kontrollér ejerskab mod annonce, før oprydning. |
| Derefter | Træningsprogrammer ser ud til at være tildelt igen efter fravalg | **Ny #7298**. Skeln tildeling, rapportlabel og fallback. |
| Derefter | Prognosen ændrer sig ved sæsonskiftet | #5683, forskel mellem sider #6853. Forklar prognose versus skjult potentiale, uden at kalde ethvert fald normalt. |
| Derefter | Uens profiler i Hold/Taktik/Etaper | #7289, PR #7292 afventer visuelt bevis. Ingen ændring af den PR i denne leverance. |
| Derefter | Delt kaptajn mangler i matrix/udtagelse | #7239/#7003. Eksisterende scope; ingen ny dublet. |
| Derefter | Manglende forklaring af medicinsk afdeling og næste investering | **Ny #7297**. Løsning kræver ejerens designvalg. |
| Senere | Holdlinks sender til managerprofil frem for holdsiden | #7286. Eksisterende rapport. |
| Senere | Historiske præmiepenge kan ikke sammenlignes | #7287. Ønske om tabeller; ingen dokumenteret regnefejl. |
| Senere | Matrixens overlap og tidsakse er svære at aflæse | #4535. Gem de nye forslag til designkort; de er ikke build-go. |
| Senere | Omdømme vises forskelligt, junior-markering mangler, massefjernelse fra transferlisten | #7232, #7233, #7234. Status skal verificeres på den relevante side før svar om levering. |
| Spørgsmål | Dagligt udviklingsloft og opsparet fremgang | Kode læst: `backend/lib/dailyTraining.js`, `settleProgressBar` og tick-løkkerne. Forklar kvalitativt, ingen interne tal. |
| Spørgsmål | Nye bestyrelsesmilepæle | `boardBonusGoal.js` viser ekstra mål med baseline og bonuskilde. Den konkrete tilbudstekst skal kontrolleres før svar om konsekvens. |
| Spørgsmål | Er vejret allerede fastlagt? | `routeSegments.js:attachSegmentsAndWeather` og `raceStageProfileGenerator.js` genererer vejret sammen med etapeprofilen. Ingen live-vejrudsigt. |

Udbrud/klassement og monumenter er allerede dækket af #7258/#6804/#7214. Kun rapporterne er registreret her; motor- og taktik-PR'er er urørte. Kontraktlængde, skader ved sæsonstart og akademioptag havde allerede ejersvar i perioden og får ikke samme svar igen.

## Svarudkast til ejeren

Udkastene nedenfor er ikke postet. Kontrollér om nye svar eller releases er kommet efter læsevinduet.

### #general, EN: træning og form

I found a problem in training between seasons, and another in the development curve. The missing training day now appears in the reports shared here. I've also changed the curve and the starting fatigue for new seasons. I still need to check the next training report before calling this sorted. If an ability you trained is still getting no progress, please send the rider and the program you used.

### #dansk-snak, DA: træning

Der skal være træning hver dag, også mellem sæsonerne. Den manglende dag vises nu i de rapporter, I har delt. Jeg har også ændret udviklingskurven og starttrætheden i nye sæsoner. Jeg vil lige se den næste træningsrapport, før jeg siger, at det hele er på plads.

### #general, EN: prognose

The number the scout shows is a prognosis, not the rider's hidden potential. The prognosis can change as the scout's picture changes. That doesn't mean every drop at the season change is right. I've kept those reports together so I can check the change properly rather than just call it normal.

### #questions-and-answers, EN: transferhistorik

That should belong to the new season. I've logged the transfer history separately from the training problem, so fixing training doesn't leave this forgotten. I haven't confirmed a fix for the history yet.

### #bugs, EN: transferliste

Thanks, I've logged this. I need to check why the listing is still there after the rider has left your team. I haven't confirmed yet whether it's just the display or the listing itself.

### #staff-chat / tråden Planlægning, udtagelse mv., DA

Tak for de konkrete eksempler. Jeg har skilt fejlen med datoerne fra ønskerne til et bedre overblik. Udtagelserne skal blive på løbets datoer, også inden man genåbner siden. Delt kaptajn og profilerne er allerede på listen. Farver, overlap og form tager jeg med i det samlede design, så det ikke bare bliver endnu et lag ovenpå.

### #staff-chat, DA: bestyrelse og dashboard

Jeg har registreret både sejrene, der ser ud til at høre til den forkerte sæson, og løbet på dashboardet. Jeg skal lige kontrollere dem hver for sig. Jeg vil ikke ændre på dine mål eller din udtagelse ud fra en forkert visning.

### #staff-chat, DA: faciliteter

Enig i, at du skal kunne forstå, hvad du får, før du investerer. Jeg har taget det med som en konkret opgave, især forklaringen af den medicinske afdeling og næste opgradering. Jeg har ikke valgt løsningen endnu.

### #staff-chat, DA: vejret

Vejret bliver lavet sammen med etapen, så det, du ser nu, er planlagt vejr til løbet. Det er ikke en vejrudsigt, der bliver mere præcis, når dagen nærmer sig.

### #dansk-snak, DA: opsparet udvikling

Den fremgang, der ikke kan blive til en stigning i dag, bliver liggende til senere. Hvis du fortsætter med at træne samme evne, kan der derfor ligge en kø af fremgang. Det er ikke en ekstra stigning samme dag. Når evnen har nået sit loft, kan den ikke fortsætte med at stige.

### #dansk-spørgsmål-og-svar, DA: bestyrelsesmilepæl

Det er et ekstra mål fra bestyrelsen, men jeg vil lige kontrollere det konkrete tilbud, før jeg siger præcist, hvad du får ud af at acceptere det. Jeg kan se, at du måtte spørge igen for at få et svar. Det skulle du ikke have været nødt til.

### #feedback-and-ideas, EN: holdsider og historik

I've logged the team page detour and the request for historical tables as separate tasks. Going through a rider just to reach the team page is an awkward workaround. For the prize money, I still need to check the totals before saying whether the winner shown is wrong.
