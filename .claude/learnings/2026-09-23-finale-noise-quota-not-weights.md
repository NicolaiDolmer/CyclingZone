# Finale-afvigelser: stikprøvestøj løses med kvote, ikke med vægte

Refs #5405.

**Symptom.** Tre finale-linjer på S4's sæson-aggregat var røde, selvom vægtene allerede stod
på båndenes midte. Hver kalibrering lukkede nogle linjer og åbnede andre.

**Årsag.** Hver etape trak sin finale uafhængigt. En divisions andel var derfor en
tilfældig stikprøve omkring vægten, og på et terræn med få etaper (brosten) var båndet ikke
bredere end én standardfejl. En korrekt generator var rød i en stor del af sæsonerne. At
flytte en vægt for at ramme netop dette træk ville bare have flyttet problemet.

**Rettelse.** `balanceFinaleQuotas` fordeler finalerne efter kvote pr. division (stratificeret
rang i stedet for et frit træk), og afrundingen vælges inden for ejerens bånd. Fordelingen
sker i `drawTierAttempt`, så gate, realisme-scorecard, dry-run og insert ser samme finaler;
materializeren indsætter tierens beregnede profiler, og backfill genskaber dem.

**Læring.**
- Et aggregat-bånd over uafhængige træk kan ikke gøres grønt af vægte, kun af at fjerne
  støjen. Mål først hvor ofte en *korrekt* generator er rød (simulér mange sæsoner).
- Når støjen er væk, bliver strukturelle modsætninger synlige: her lå summen af terrænernes
  "opad" tæt på det samlede bånds loft. Det var skjult af tilfældigheden, ikke fraværende.
- En fordeling på tværs af løb skal ske ét sted som alle skrive- og måle-stier går igennem.
  Ellers måler gaten ét parcours og basen får et andet.
