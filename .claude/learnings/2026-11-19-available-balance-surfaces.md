# Saldo på tværs af spillets flader (#8357)

Sidebjælken viste kontosaldo, mens dashboardet viste disponibel saldo. Brug én holdafgrænset læsning til saldofelterne, og vis bundne bud særskilt. Et fejlet opslag må aldrig nulstille en kendt binding. Bevar den særskilte linje for låst salgsprovenu.

Ved auktionsafregning kan et bud forsvinde fra bindingen, før kontosaldoen er genlæst. Vis kun den senest kendte kontosaldo med etiketten Saldo, mens holdopslaget er i gang eller har fejlet.

Reserver højden til saldovisningen fra første frame i auktionshovedet, så historieknappen beholder sin placering under indlæsning.
