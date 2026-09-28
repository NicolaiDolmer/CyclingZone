# #5828: et nyt synligt tal skal sammenlignes med det gamle

Omdømme-motoren var kalibreret på sin egen rå fordeling. Da tallet skulle
erstatte popularitet på rytterfladerne, viste en read-only sammenligning, at
en del etablerede ryttere ville få et lavere synligt tal trods et uændret
spillerløfte. Bestyrelsens stjernemål havde samtidig en anden gammel
definition end popularitet alene, så et simpelt `max(popularity, reputation)`
ville stadig kunne ændre opfyldelsen af et allerede aftalt mål.

Rettelsen skelner mellem rå motorværdi og overgangens synlige tal. Det viste
tal har populariteten som gulv. Nye bestyrelsesmål mærkes med den scorekontrakt,
de blev født under; eksisterende mål uden mærke evalueres fortsat efter den
oprindelige kontrakt. Backfillens dry-run tæller også ryttere uden hændelser,
så manglende afledte rækker ikke forveksles med en korrekt lancering.

Fremover: før et eksisterende spiller-tal erstattes, mål forskellen på samme
population og test alle læsere og aftalte mål. Kalibrér på det tal spilleren
faktisk ser, men rapportér den rå motorværdi separat. Flag-flip kræver stadig
ejer-go efter fuld populationsverifikation.
