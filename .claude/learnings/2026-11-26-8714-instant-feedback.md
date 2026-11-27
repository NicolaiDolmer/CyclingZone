# #8714 — samtidige gemninger og rollback

To træningsgemninger kunne hver aflede kapacitet fra samme udgangspunkt, mens et mellemliggende svar kunne overskrive det seneste synlige valg. Træningsskærmene viser brugerens valg med det samme og sender skrivninger i rækkefølge. Autoritative planer og pladstal kommer fra serveren.

Indbakken kunne gendanne et helt gammelt øjebliksbillede, når én skrivning fejlede. Visningen afleder nu læst og slettet fra bekræftede rækker plus ventende handlinger. Ved fejl fjernes kun den berørte handling. Læsninger, der startede før en ændring, må ikke overskrive resultatet, og nye realtime-rækker bevares.

Regressionsprøverne kontrollerer skrivningernes rækkefølge, uafhængig rollback og visning af et ventende træningsvalg.
