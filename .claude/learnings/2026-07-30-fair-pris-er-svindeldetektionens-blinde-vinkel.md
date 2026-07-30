# En fair pris er værdibaseret svindeldetektions blinde vinkel

**Dato:** 2026-07-30
**Kontekst:** Ugentlig fair-play-scan → epic #3131 (#3132-#3139)

## Hvad skete der

Den ugentlige fair-play-scan kørte fire regler fra #2226, alle prisbaserede: pris-ratio,
ensrettet nettostrøm, email-lighed, hurtigt videresalg under værdi. Jeg rapporterede
"ingen bekræftet snyd" og afviste eksplicit én handel som uinteressant, fordi den lå på
**præcis 1,00× markedsværdi**.

Ejeren spurgte ind til netop den handel. Ved nærmere eftersyn: en konto på engangs-mail
oprettet, maxede lånet efter 55 sekunder, betalte 649.853 CZ$ til et etableret hold efter
3 min 52 s, og forsvandt efter 24,6 minutter. Det er den **eneste gang i spillets historie**
at en konto har betalt over 100.000 til et menneskehold inden for 2 timer efter oprettelse.

Handlen viste sig efter efterforskning ikke at være snyd (forskellige IP-registre, forskelligt
browser-fingeraftryk). Men **alle mine kontroller var strukturelt ude af stand til at se den**,
uanset om den havde været snyd eller ej.

## Rodårsagen

Værdibaserede regler måler *prisen på en handel*. De kan per konstruktion ikke se en
angrebsklasse hvor prisen er fair, og hvor det der udvindes er noget andet end værdi —
her ~888.000 CZ$ i nyskabt kapital (startkapital + lånekapacitet) som en engangskonto kan
overføre til et etableret hold og derefter forlade med gælden.

Værre: min hurtig-flip-kontrol havde et eksplicit `and sale_ratio << 1` i filteret. Jeg havde
**bygget blindheden ind i queryen** og bagefter læst det tomme resultat som et positivt bevis
på at der ikke var noget.

## Regel fremadrettet

1. **Når et detektionsfilter indeholder et prædikat, så spørg hvad prædikatet gør usynligt.**
   Et tomt resultatsæt fra et snævert filter er ikke evidens for fravær.
2. **Svindeldetektion skal have mindst ét signal der ikke måler transaktionens værdi.**
   Kontoalder ved transaktionen, konto-levetid efter, og identitets-overlap er alle
   værdi-uafhængige. → #3135, #3137
3. **Kalibrér tærskler mod målte data, ikke mod intuition.** #2226's "< 0,5× er mistænkeligt"
   viste sig at flagge ca. halvdelen af alle ærlige, konkurrenceudsatte salg — medianen i
   auktioner med 2+ uafhængige budgivere er **0,49×**. Tallet lød rimeligt og var forkert. → #3136

## Den anden fejl: jeg læste ikke de eksisterende issues først

Jeg gennemførte hele analysen uden at have læst #2776 — en fair-play-sag fra 22/7 hvor
1,97 mio. CZ$ blev flyttet for 2 kr. Den opdagede jeg først da jeg skulle planlægge issues
bagefter.

#2776 indeholdt to ting jeg selv måtte genopdage undervejs:

- `signup_attribution.first_seen_at` som browser-fingeraftryk (det signal der endeligt
  afgjorde sagen for mig)
- **"Brug outer joins på sælgersiden"** — fordi ryttere købt fra bank/AI ikke har hold-id.
  Præcis den fælde ramte min egen første query: to systemauktioner med
  `seller_team_id = NULL` faldt ud af joinet.

Dette er [[feedback_read_existing_plans_before_building]] igen. Reglen gælder også når
opgaven ligner ren analyse frem for kodning — en scheduled task med en færdig
opgavebeskrivelse føles selvforsynende, men beskrivelsen var skrevet før #2776 fandtes.

**Konkret:** en fair-play- eller sikkerhedsanalyse starter med at læse tidligere sager i
samme kategori, ikke med at køre queries.
