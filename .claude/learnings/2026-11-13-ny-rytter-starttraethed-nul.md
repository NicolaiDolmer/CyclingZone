# 2026-11-13 · Nye ryttere startede på 0 i træthed og tabte form (#8089)

**Hvad skete:** En rytter, der kom til et hold (køb fra puljen, akademi-optag, ny managers starttrup), fik form 50 og træthed 0. Med træthed 0 falder formen de første dage uanset træning. Ejeren bekræftede 9/11 over for en spiller, at det var utilsigtet; han troede, starten var 20.

**Rodårsag:** Ét sted satte den første tilstand: triggerfunktionen `initialize_first_use_rider_condition` (plus to reserveveje i samme migration og to reserver i koden). Tallet 0 blev aldrig holdt op mod formreglen, som kræver en vis træthed, før formen kan holde eller stige. Sæsonstarten brugte allerede 20 (`seasonFatigueReset.js`), så de to starter var ude af takt.

**Omfang (målt af dommeren, kun antal):** 470 ryttere på menneskehold i sæson 5, ikke de ca. 200 den første undersøgelse fandt; nye manageres starttrupper var overset. Ejeren fik først det forkerte tal og måtte spørges igen.

**Rettelse:** PR #8131 (`6f364bb5`): startværdien 20 de tre steder i databasen og som fælles konstant i koden. Ingen bagudrettelse (ejerens valg, bekræftet med det rigtige tal). Dommer før første kodelinje og dom før merge.

**Læring:**
1. En startværdi for en tilstand skal prøves mod den regel, der bruger den, i det øjeblik den vælges: simulér dag 1 til 5 for en ny rytter som en fast prøve.
2. Når en undersøgelse tæller "de ramte", skal den tælle alle veje ind i samme kode (her: alle, der går gennem samme trigger), ikke kun dem, fejlmeldingen nævnte. Tallet skal efterprøves, før ejeren får det på et kort.
3. Dommerens prøver med private kurver må ikke i det offentlige repo; dommeren leverer en offentlig udgave uden kurver, så reglen har et værn i CI.

Refs #8089
