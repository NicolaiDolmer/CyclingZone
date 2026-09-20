# Udkast: ryttertype-svar til #dansk-snak (skrevet 11/9, UPOSTET pr. 20/9)

> Ejer-trin, se #5436. Ejeren poster selv. Baggrund: `docs/discord/2026-09-11-ryttertype-og-rating-visning-modeller.md`,
> spec `docs/superpowers/specs/2026-09-11-ryttertype-visning-og-punch-loft-design.md`, GDD D-049/D-050.
>
> **Afstem FØR posting:** (1) loft-retningen 18/9 ("lofterne ud, potentialet styrer farten", #5351) rammer
> punkt 3 og ordet "Loft" i begge udkast; (2) post rating-svaret v7.286 (#5429) først; (3) punkt 1 lover en
> preview, som forudsætter at #5435 er prioriteret.

## 1. Kort svar til egomadsen og valverde4ever (tråden 11/9 kl. 15:30-15:45)

Jeg var for hurtig før, undskyld. Her er det rigtige, nu hvor jeg har været i koden:

**Loft** = rollens max. Ens for alle i rollen, kun alder trækker det ned. Potentiale indgår ikke, så egomadsen har ret, og jeg tog fejl før.

**Potentiale** = fart. Hvor hurtigt rytteren vokser mod loftet. Det ændrer sig aldrig, og det vises ikke som et tal nogen steder. Det er bevidst.

**Prognose** = hvor han realistisk lander ved peak-alderen, ud fra hans evner nu, alder og fart. Bunden er "spredt træning", toppen er "dedikeret hver dag". Din aktuelle plan indgår ikke, så tallet hopper ikke når du skifter fokus. Det flytter sig kun når hans evner flytter sig.

Så potentialet ser I indirekte: jo højere fart, jo højere ligger hele båndet.

Mario er ikke i stykker. Sekundærtypen kommer fra hans fødte anlæg, ikke fra det næsthøjeste loft, og hos ham peger de to hver sin vej. Hvordan det skal vises, er en af de ting jeg har besluttet at lave om, se listen herunder.

## 2. Ryttertyper, rating og potentiale: hvad jeg har fundet, og hvad jeg gør

Tak for al snakken. Jeg har været koden og tallene igennem på alle jeres ryttere. Her er problemerne, og hvad jeg vil gøre ved dem. Det første punkt bygger jeg som en preview, I får lov at se den og sige ja eller nej, før den kommer i spillet.

**1. Ratingen er lavere end rytteren reelt er.**
Ratingen regnes i dag i den rolle rytteren er født til. Hos 6 ud af 10 af jeres ryttere er det ikke det højeste tal, han har. Nicolò står med 43, men er 54 som bjergrytter.
Løsning: ratingen bliver det bedste, han kan lige nu, med rollen ved siden af: "54 Bjergrytter". Samme tal på kort, i tabeller og på markedet.

**2. Typen føles låst og forkert, når man har trænet anderledes.**
Typen er det, rytteren er født til. Den ændrer sig aldrig, og det bliver den ved med. Men ordet "type" får jer til at læse den som "bedst i".
Løsning: badget kommer til at hedde "Naturlig rolle", og ved siden af står "Bedste rolle nu". Ét ord for det medfødte, ét for nutiden.

**3. Bakkerytter ligger højt i loft hos næsten alle bjergryttere.**
Jeg prøvede først at stramme regnestykket bag bakkerytter. Det hjalp ikke, det flyttede bare problemet til sprinterne. Årsagen er, at bjergryttere fødes med punch på samme loft som bakkeryttere. En bjergrytter er født som en komplet bakkerytter plus klatring.
Løsning: bjergrytterens punch-loft sænkes, så bakkerytteren kan skille sig ud på bakkeetaper. Det er en regelændring, så den måles først og lander i sæsonpausen.

**4. Den sekundære rolle er ikke det næsthøjeste loft.**
Mario er født Etapeløbsrytter/Rouleur, men tre roller ligger over Rouleur i loft. Det er ikke i stykker: den sekundære rolle trækkes ved fødslen sammen med den primære. Roller deler evner, så loft-listen kan altid vise en anden rolle højt.
Løsning: scouting-fanen deler "hans naturlige roller" fra "andre roller", og siger tydeligt at rækkefølgen mellem de andre er et estimat.

**5. Alt for mange har rouleur eller sprinter som sekundær rolle.**
Løsning: nye ryttere trækkes jævnt over alle otte roller fra sæsonpausen. Jeres nuværende ryttere røres ikke.

**6. Ingen ved, hvad prognose, potentiale og loft betyder.**
Løsning: en ordliste på rytterprofilen. Kort: Naturlig rolle er det, han er født til. Loft er rollens max for ham, sat af anlæg og alder. Potentiale er fart, hvor hurtigt han vokser mod loftet. Prognose er, hvor han realistisk lander ved sin peak, uanset hvad du gør med planen.

Det, jeg ikke gør: rytterne kommer ikke til at skifte type, og der kommer ingen straf for at bruge en rytter i en anden rolle.

## Mangler

- EN-version til #general (tilbudt 11/9, ikke skrevet).
