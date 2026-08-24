# Discord-udkast: fire Monumenter flytter dato (#4203 / PR #4208)

> **Ejeren poster selv.** Udkastet er til copy-paste. EN først, DA under, som al spiller-vendt copy.
>
> ## ⛔ MÅ IKKE POSTES
>
> **Byttet blev rullet tilbage 24/8 kl. 22:05.** Migrationen kørte 21:20, men brød #4075: alle fire flyttede Monumenter delte løbsdag med 1-2 andre løb, så ikke alle ryttere kunne stille op. Den daglige kalender-invariant-audit fangede det, og ejeren besluttede at rulle tilbage.
>
> **Kalenderen i prod er nu den oprindelige.** Ingen løb har skiftet dato. Datotabellerne herunder beskriver en kalender der ikke findes.
>
> Udkastet er bevaret, fordi teksten kan genbruges når byttet laves rigtigt sammen med GT-komprimeringen (#4176). **Ret datoerne mod prod før du poster.**

**Kanal:** #announcements (eller den kanal ugenoter plejer at ligge i)

---

## English

**Four Monuments are moving to a different day**

Four of the five Monuments were scheduled inside a Grand Tour window, sharing the day with Giro, Tour or Vuelta stages. A Monument is supposed to be the biggest one day race of the season, and it cannot be that when the same riders are deep into a three week tour on the same afternoon.

The four are moving out of the Grand Tour windows, and four smaller one day races move into the slots they leave behind. Nothing is cancelled and nothing is added. Eight races change their date:

| Race | Was | Now |
|---|---|---|
| Milano-Riviera | 31 Aug | 29 Aug |
| De Vlaamse Ronde | 14 Sep | 5 Sep |
| L'Enfer du Nord | 19 Sep | 7 Sep |
| La Doyenne des Ardennes | 3 Sep | 10 Sep |
| Le Mur de Huy | 7 Sep | 31 Aug |
| La Classique Bretonne | 9 Sep | 3 Sep |
| Taunus-Klassiker | 10 Sep | 14 Sep |
| Grand Prix du Saint-Laurent | 10 Sep | 19 Sep |

La Classica d'Autunno is unchanged. The Monuments now run in the order you would expect them to: Sanremo, Ronde, Roubaix, Liege, Lombardia.

**What you need to do.** If you had already picked a line-up for one of these eight races, open it and check it. A rider who is now needed somewhere else on the new date has been taken out of the selection, and the assistant will fill the empty seats before the race starts. Your other races are untouched.

No results have been run yet this season, so nothing that has already happened changes.

## Dansk

**Fire Monumenter flytter dag**

Fire af de fem Monumenter lå inde i et Grand Tour-vindue og delte dagen med etaper fra Giro, Tour eller Vuelta. Et Monument skal være sæsonens største endagsløb, og det kan det ikke være når de samme ryttere er midt i et treugers-løb samme eftermiddag.

De fire flytter ud af Grand Tour-vinduerne, og fire mindre endagsløb rykker ind i de pladser de efterlader. Intet aflyses, og intet kommer til. Otte løb skifter dato:

| Løb | Før | Nu |
|---|---|---|
| Milano-Riviera | 31. aug | 29. aug |
| De Vlaamse Ronde | 14. sep | 5. sep |
| L'Enfer du Nord | 19. sep | 7. sep |
| La Doyenne des Ardennes | 3. sep | 10. sep |
| Le Mur de Huy | 7. sep | 31. aug |
| La Classique Bretonne | 9. sep | 3. sep |
| Taunus-Klassiker | 10. sep | 14. sep |
| Grand Prix du Saint-Laurent | 10. sep | 19. sep |

La Classica d'Autunno er uændret. Monumenterne kører nu i den rækkefølge man ville forvente: Sanremo, Ronde, Roubaix, Liege, Lombardia.

**Det du skal gøre.** Havde du allerede sat hold til et af de otte løb, så åbn det og kig det igennem. En rytter der på den nye dato skal bruges et andet sted er taget ud af udtagelsen, og assistenten fylder de tomme pladser inden løbet går i gang. Dine øvrige løb er urørte.

Der er ikke afviklet et eneste løb i sæsonen endnu, så intet af det der allerede er sket ændrer sig.

---

## Note til ejeren, ikke til Discord

Fire hold mistede tilsammen 23 **manuelle** udtagelser, altså valg de selv havde truffet. Tallene er de faktiske, aflæst i `backup_4203_removed_entries` efter kørslen:

| Hold | Manager | Manuelle ryddet |
|---|---|---|
| Team Hansen Pro Cycling | Simon Hansen | 11 (6 + 5) |
| Bacon Fræsers | Egomadsen | 5 (4 + 1) |
| Team Easy-On | Henning Primdahl | 4 |
| 24/7 Aspire-Light Velo Team | Robsteren | 3 |

De er bevidst **ikke** nævnt ved navn i opslaget. Overvej en kort DM til de fire i stedet, så de ikke selv skal opdage det. Alle fire har 31-37 ryttere, så de kan sagtens vælge om.

De resterende 333 af de 356 ryddede udtagelser er assistentens auto-udfyldning og kræver ingen handling.
