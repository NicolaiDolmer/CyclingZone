# GSC-totaler skal hentes separat

Refs #3797/#1407. Scriptet summerede top-25-søgeord i hver periode. Udvalget kan skifte, og anonymiserede queries udelades; sammenligningen måler derfor ikke hele ejendommens udvikling. En note om underskøn reparerer ikke sammenligningen.

Rettelse: to forespørgsler uden query-dimension leverer ejendomstotalerne. Toplister vises separat. Pacific-datoer og endelige data gør perioderne eksplicitte. Tomme svar markeres ukendte; fejl gengiver aldrig rå Google-svar.

Regression: fixture med ejendomstotal større end query-udsnittet, Pacific-midnat, DST, skuddag, tomme svar og afvist Git-output. Live-målinger gemmes alene i det private fællesområde.
