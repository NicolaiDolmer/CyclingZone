# Svarudkast uge 33 (18/8) - ejeren poster selv, alt her er udkast

> Kilder: in-app player_feedback (9 ubesvarede), Discord-sweep 11/8-18/8, forum.
> Status-tags: KLAR (send som den er) / VERIFICER (jeg mangler at efterprove noget) / DIN BESLUTNING.

## A. In-app feedback (svar via admin-reply)

### A1. 15/8, modbud accepteret mens rytter var paa auktion (DA) - KLAR
> Tak for den praecise gennemgang, den var guld vaerd. Du har fundet et aegte hul: forhandlingssporet og auktionssporet kender ikke hinanden i dag. Der er oprettet en rettelse der goer dem sikre sammen: accept af et modbud blokeres naar rytteren staar paa auktion med bud, og et auktionssalg lukker automatisk aabne tilbud paa rytteren. Den er paa vej ud. Godt fanget.

### A2. 11/8, "Ugyldig handling" ved afvis af forhandlet tilbud (DA) - KLAR
> Det var en aegte bug, og den blev rettet 15/8. Forhandlede byttetilbud kan nu afvises igen fra transfersiden. Sig til hvis du stadig ser fejlen.

### A3. 9/8, "8 timer og jeg ved stadig intet" (DA) - KLAR
> Du har helt ret, og det var ikke godt nok. Der bygges lige nu et statusbanner direkte i spillet: naar noget er i stykker, vil du kunne se det i appen med det samme, med hvad vi ved og hvad vi goer. Tak fordi du sagde det direkte i stedet for bare at logge af.

### A4. 9/8, laan optaget til koeb der blev annulleret (DA) - DIN BESLUTNING
Udkast (kraever at du beslutter kompensation foerst):
> Det var en rigtig traels kaede at staa i, og jeg forstaar frustrationen. [HVIS KOMPENSATION: Jeg har set paa dit forloeb og saetter X ind paa din konto som kompensation for laaneomkostningerne.] [HVIS IKKE: Selve koebet blev annulleret som del af fejlrettelsen, men laanet og de andre beslutninger kan jeg ikke rulle tilbage uden at skabe nye skaevheder. Det er ikke det svar du haabede paa, men det er det aerlige svar.] Tak for taalmodigheden den dag.

### A5. 1/8, ide: "form" som traeningsfokus (DA) - KLAR
> God tanke. Formen drives i dag af hvile og traethed (hvile giver form, haard traening koster), saa et rent form-fokus ville overlappe med hvile. Traeningssystemet er netop lagt om, saa kig paa det igen naar ugens opdatering er ude, og sig til hvis der stadig mangler noget til faerdigudviklede ryttere.

### A6. 30/7, board-plan taeller ikke etapesejr (EN) - VERIFICER
Skal reproduceres foer svar (taeller 1-aars-planen etapesejre korrekt?). Udkast naar verificeret:
> You were right, this was a real counting bug / This one actually works as intended because [X]. [Afhaengigt af fund.]

### A7. 27/7, resultat-notifikation aabner samlet stilling, ikke etapen (EN) - KLAR
> This was a real bug and it was fixed today: result messages and the race digest email now deep link straight to the stage result. Thanks for reporting it.

### A8. 27/7, "riders are booked for other race" ved gem af opstilling (EN) - KLAR
> This was part of a deeper scheduling bug that was properly fixed today: rider swaps between overlapping races were being blocked by a safety rule, which could leave lineups short and throw this error. Lineups now fill and update as they should. Thanks for the detailed report, it helped pin it down.

### A9. 23/7, modbud vender fortegnet paa betaling (EN) - VERIFICER
Undersoeges som del af forhandlings-gennemgangen (#3940). Udkast naar verificeret.

## B. Discord, ubesvarede spoergsmaal

### B1. jeppek, #bugs 14/8: loen-preview 324 mod faktisk 5.191 (EN) - KLAR
> Good catch, and sorry for the slow reply. This is now tracked as a bug: the salary preview and the actual contract after an academy move must match, and today they do not. Fix is on the list this week.

### B2. friisisch, #bugs 15/8: "upcoming races cleared" ramte igangvaerende loeb (EN) - KLAR
> You are right that the text and the behaviour do not match. We are deciding whether moving a rider mid race should be blocked entirely or allowed with an honest message, but silent removal from a running race is wrong either way. Tracked and on the list.

### B3. jeppek 14/8: auktions-sortering paa mobil (EN) - KLAR
> Mobile auction sorting is a real gap, it is on the list now. Thanks.

### B4. cybersimon 13/8: Daily Training-kolonner kan ikke sorteres (EN) - KLAR
> Tracked. Sorting in the daily training table is on the list.

### B5. thelamba/jeppek 15/8: se egne transferlistede ryttere + pris (EN) - KLAR
> Agreed. Showing the listed price on the rider page and on your own roster is already tracked, it is coming.

### B6. cybersimon 11/8: "limited upside" ogsaa i traenings-fanen (EN) - KLAR
> This one gets solved by the big training update this week: every rider gets a development forecast on the profile, so you will see where a rider is heading before you train, and the old label goes away entirely.

### B7. valverde4ever, #dansk-snak 18/8: "rating 87, er det nyt?" (DA) - KLAR
> Ja og nej. Ratingerne blev genberegnet i sidste uge saa tallene passer til rytternes faktiske niveau. Mange tal blev lavere over hele linjen, saa en 87 i dag er staerkere end en 87 foer. Det er samme skala for alle, saa ingen har mistet noget i forhold til andre.

### B8. knud_r_flink, #dansk-strategi 15/8: "18% setback virker hoejt, og betyder fatigue noget?" (DA) - KLAR
> Godt spoergsmaal, og svaret er vildere end du tror: setback har ALDRIG ramt en eneste rytter. Jeg gik hele historikken igennem, nul udloesninger siden launch. Derfor fjernes den helt fra spillet nu. Den pris der faktisk betyder noget, er traethed: haard traening koster traethed, som driver form og skadesrisiko. Saa ja, fatigue betyder noget, og det er den eneste pris der goer.

### B9. thelamba, #results-d3-b 14/8: "skulle der ikke vaere etape-resultater herinde?" (EN) - DIN BESLUTNING
Vil du have at resultat-botten ogsaa poster etape-resultater i divisionskanalerne? Udkast ved ja:
> It was the plan, and it fell between two updates. Stage results in the division channels are coming back on.

### B10. thelamba, #transfer-history 15/8: mistanke om aftalte handler (DA) - DIN BESLUTNING + mit forslag
Anbefalet aerligt svar (uden at doemme nogen):
> Rimeligt spoergsmaal at stille aabent. Alle direkte handler logges, og jeg kan se de konkrete beloeb og forloeb. Jeg kigger paa de handler du naevner. Mere strukturelt er der arbejde i gang med at rytterpriser bliver markedsdrevne, og med tydelige markeringer naar en handel afviger markant fra en rytters vaerdi. Regler mod aftalt spil skal haandhaeves paa data, ikke paa mistanke, saa det er den vej vi gaar.
[Jeg kan koere tallene paa de konkrete handler foer du svarer, sig til.]

## C. Forum

### C1. "Question: Profile riders and Popularity" (18/8, EN) - VERIFICER
En medspiller svarede "det er det samme". Skal verificeres i koden foer du bekraefter (popularity-scoren vs profile riders-visningen). Udkast naar verificeret.

### C2. Forum-forbedringstraaden (statusopdatering, EN) - KLAR
> Quick update on this: forum improvements are tracked and coming in waves. First up: search, unread markers, quote replies with notifications, and reactions. Reporting a post will also require a short reason. Keep the ideas coming.

### C3. "Is Development dead now?"-traaden - se docs/discord/2026-08-18-state-of-development.md (hovedsvaret)
