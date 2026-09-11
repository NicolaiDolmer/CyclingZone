# Forum-afstemning: hvor lang tid før start skal assistenten fylde en tom trup? (udkast 11/9 2026)

Ejeren poster selv (COMMS_PLAYBOOK §1). Kategori: feedback_ideas. Ingen billede nødvendigt.
Baggrund: D-034 (GDD, 10/9) er besluttet i retning `late_fill`, men flippet af
`assistant_selection_mode` og `assistant_late_fill_hours` (#4201, `backend/lib/assistantSelectionMode.js`)
venter på spillernes svar på ét spørgsmål: hvor tæt på start skal assistenten gribe ind. Samme
afstemning afgør om PR #5108 (påmindelse før udtagelsesfristen, #4983) kan merges.

---

## Titel (EN)

The future of: when should the assistant step in on an empty squad?

## Opslag (EN)

Hep! Quick one today, and it decides something I am about to ship.

Right now, if you never pick a squad for a race, nothing happens until the race actually starts. The game fills the empty spots at the very last moment, when the race begins, up to the minimum of 6 riders. You get no warning and no chance to fix it yourself first.

I want to change that: if your squad is completely empty, the assistant fills it a set number of hours before the race starts instead of at the start itself. That gives you a window to notice and fix it before it locks in. A squad that already has some riders in it is not touched by this, it is only for squads that are 100% empty.

What I do not know yet is how many hours that window should be. Vote in the poll, and tell me in the thread if the number depends on the race type for you, a one-day race versus a Grand Tour.

## Afstemning (EN)

- A. 12 hours before start
- B. 24 hours before start
- C. 48 hours before start
- D. At the squad selection deadline
- E. Never fill for me, I want to do it myself

---

## Titel (DA)

Fremtiden for: hvor lang tid før start skal assistenten gribe ind på en tom trup?

## Opslag (DA)

Hep! Kort en i dag, og den afgør noget jeg er ved at sende live.

Lige nu sker der ingenting hvis du aldrig udtager en trup til et løb, før løbet rent faktisk starter. Spillet fylder de tomme pladser i sidste øjeblik, altså når løbet begynder, op til minimum 6 ryttere. Du får ingen advarsel og ingen chance for selv at rette det først.

Jeg vil gerne ændre det: er din trup helt tom, fylder assistenten den et bestemt antal timer før løbet starter i stedet for ved selve starten. Det giver dig et vindue til at opdage det og selv rette det, hvis du vil. En trup der allerede har nogle ryttere i sig, rører assistenten ikke, det gælder kun trupper der er 100 % tomme.

Det jeg ikke ved endnu, er hvor mange timer det vindue skal være. Stem i afstemningen, og skriv i tråden om tallet afhænger af løbstypen for dig, et endagsløb versus en Grand Tour.

## Afstemning (DA)

- A. 12 timer før start
- B. 24 timer før start
- C. 48 timer før start
- D. Ved udtagelsesfristen
- E. Assistenten skal aldrig fylde for mig, jeg vil selv

---

Ingen datoer, ingen tal om hvor mange spillere der rammes, ingen løfter om hvornår flippet sker
(feedback_roadbook_no_dates_happy_tone). Bogstaverne A-E i opslaget matcher afstemningen 1:1.
Svarmulighed B (24 t) er dagens tekniske default i `assistantSelectionMode.js`, men opslaget siger
det ikke, for ikke at forudindtage svaret.
