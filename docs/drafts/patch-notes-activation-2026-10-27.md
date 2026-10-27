# Tændingsklare tekster, 27/10

Refs #7153 #7003 #6649 #7290. Design-go: ejerens bestilling 27/10 og private beslutninger 26-27/10. Dette er klargjort tekst, ikke en meddelelse om aktivering. Dagsform og bakker må først kopieres til patchNotes.js/Hjælp efter observeret tænding. Ordrer er nu observeret on og er flyttet til 7.385 og Hjælp. Ved udgivelse bruges den faktiske dato og næste ledige patch-version. Bekræft også modtagere: beta eller alle.

## Modsatte ordrer (#7281), leveret i 7.385

Observeret: PR #7281 merget, begge flag on i read-only prod. PC1 bekræftede tændingen kl. 13:48 på #7153. Test: vælg en konflikt, se begrundelsen og Vælg én; et tog uden relevant spurtkaptajn spærrer intet.

EN title: Orders that agree

What changed
Conflicting orders can no longer be selected together. A short line explains why.

What it means for you
Choose one of the conflicting orders before you save.

DA titel: Ordrer der passer sammen

Hvad er ændret
Modsatte ordrer kan ikke længere vælges sammen. En kort linje forklarer hvorfor.

Hvad betyder det for dig
Vælg én af de modsatte ordrer, før du gemmer.

Help EN: Conflicting orders cannot be combined. The explanation beside the choice tells you what to change before saving.

Hjælp DA: Modsatte ordrer kan ikke kombineres. Forklaringen ved valget viser, hvad du skal ændre, før du gemmer.

## Dagsform (#7272)

Krav: PR #7272 merget, aktivering/revision observeret af PC1, og anvendelse fra første relevante etape bekræftet. Test: et optaget løbsinput og genafspilning bruger samme dagsform. GT/monumenter er et selvstændigt opfølgningsspor, ikke lovet løst her.

EN title: A different day on the bike

What changed
Riders can have a better or worse day in a race.

What it means for you
Ability still matters, but your favourite can have an off day.

DA titel: En forskellig dag på cyklen

Hvad er ændret
Ryttere kan have en bedre eller dårligere dag i løbet.

Hvad betyder det for dig
Evnerne tæller stadig, men din favorit kan have en dårlig dag.

Help EN: Race-day form can make a rider perform better or worse in that race. It is separate from the form you manage through training and form peaks.

Hjælp DA: Dagsformen kan give rytteren en bedre eller dårligere præstation i det løb. Den er adskilt fra den form, du styrer med træning og formtoppe.

## Bakker, trin A (#7290/#7291)

Krav: #7272 merget, koblingen i raceRunner leveret og route_profile_hills aktiveret og læst tilbage af PC1. #7291's merge alene er ikke en tænding. Test: markeret rute i optaget input, deterministisk checksum, ingen markør skrevet til DB.

EN title: The race follows the hills in the profile

What changed
The smaller hills in the elevation profile now count as rolling terrain in the race.

What it means for you
Use the profile when planning your team. This change does not turn those hills into classified climbs.

DA titel: Løbet følger bakkerne i profilen

Hvad er ændret
De mindre bakker i højdeprofilen tæller nu som rullende terræn i løbet.

Hvad betyder det for dig
Brug profilen, når du planlægger holdet. Ændringen gør ikke bakkerne til kategoriserede stigninger.

Help EN: Smaller hills in the elevation profile count as rolling terrain. Stronger selection on those hills is a separate change and is not included here.

Hjælp DA: Mindre bakker i højdeprofilen tæller som rullende terræn. En stærkere udskilning på bakkerne er en separat ændring og er ikke med her.

## Verifikation af den aktuelle tekst-PR

7.385 om grundtræthed og modsatte ordrer, rettelserne af 7.383/7.384 og tilsvarende EN/DA Hjælp går ud i denne PR. Copy-only: den præcise ordlyd kan læses i diffen. Ingen layoutændring. Lokal tier FULL følger locale-reglen; PC1 beholder merge- og aktiveringsansvaret.
