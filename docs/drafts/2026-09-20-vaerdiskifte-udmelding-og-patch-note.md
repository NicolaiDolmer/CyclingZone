# Udkast: udmelding om værdiskiftet + patch notes (ejeren poster selv)

> **Til ejeren (ikke en del af beskeden).** Skrevet af Claude 20/9 aften efter dine tre beslutninger (#5443): alt på én gang, lønnen venter til efter sæsonskiftet, én ekstraordinær kørsel uden for søndag. Afløser afsnit B i `2026-09-20-vaerdimodel-spillerbesked.md`, som lovede tre ting der ikke længere passer til første skridt: "ingen frosne dele" (fremskrivningen af unge ryttere bliver stående), "du kan se hvorfor" (kvitteringen er ikke bygget) og "kun søndage" (denne ene gang er en undtagelse). Discord er kun EN, jf. dit ord 20/9. Ingen datoer og ingen tal i Discord-beskeden, jf. roadbook-reglen. Afsnit A i det gamle udkast (kort svar i tråden "Players stuck in value") kan stadig postes som det er.
>
> Det beskeden lover, og som derfor SKAL holde: (1) værdi og rating regnes på de samme evner, (2) alle ryttere rettes på én gang, op og ned, (3) lønkrav ændrer sig ikke med denne opdatering, (4) det sker i én ekstra opdatering uden for søndag, og du siger til aftenen før, (5) derefter igen kun søndage.

---

## 1. Discord, #the-roadbook (EN)

**Rider values are getting fixed, properly**

Several of you showed me riders who get better week after week while their value stands still. You were right, and I found out why.

The rating on a rider's card and his value were calculated from different abilities. For some riders the value only listened to one single ability. Train anything else and nothing happened. On top of that, some riders were still priced as the rider type they had back in August, not the type they are today.

So I have rebuilt it:

- **One recipe.** A rider's value is now built from the same abilities as the rating on his card. When the rating moves, the value follows.
- **The right type.** Every rider is priced as the type he actually is today.
- **Everyone at once.** All riders are corrected in one go, so no value in the game is knowingly wrong while you trade.
- **Wages stay as they are.** This update does not change what a rider asks for in his next contract. I will look at that separately after the season change.

I want to be straight about one thing: values move in both directions. More riders go up than down. The riders who fall the most are specialists whose whole price rested on one strong ability, like a pure time trialist. That is not a punishment for good riders. It is the price catching up with the rating you could already see.

Values normally only update on Sundays. This one time I am running a single extra update in the week, so you have time to look at your squad before the season change. I will post here the evening before it happens. After that it is Sundays only again.

If a rider looks wrong to you afterwards, tell me. That is how we found this one.

---

## 2. Patch note til hjemmesiden: dagens rettelse 20/9 (mangler i dag)

**EN**
**396 riders were stuck at the wrong value.** Since August, some riders were valued as the rider type they had before the type update, so their value only moved when one specific ability improved. On Sunday I corrected the type for the 396 riders on manager teams whose value goes up from the fix. Nobody went down. The rest of the value model follows in a later update, and I will tell you before it happens.

**DA**
**396 ryttere sad fast på en forkert værdi.** Siden august er nogle ryttere blevet værdisat som den ryttertype, de havde før type-opdateringen, så deres værdi kun flyttede sig, når én bestemt evne blev bedre. Søndag rettede jeg typen for de 396 ryttere på managerhold, hvis værdi stiger af rettelsen. Ingen gik ned. Resten af værdimodellen følger i en senere opdatering, og jeg siger til, før det sker.

---

## 3. Patch note til dagen hvor skiftet køres (postes IKKE før)

**EN**
**Rider values now follow the rider.** A rider's value is calculated from the same abilities as his rating, and every rider is priced as the type he is today. All riders were corrected at once, up and down. More riders rose than fell. The biggest falls are specialists whose price rested on one strong ability. Wage demands did not change with this update, and signed contracts are never touched. From here, values update on Sundays only again.

**DA**
**Rytterværdier følger nu rytteren.** En rytters værdi regnes ud fra de samme evner som hans rating, og hver rytter prissættes som den type, han er i dag. Alle ryttere blev rettet på én gang, op og ned. Flere ryttere steg end faldt. De største fald er specialister, hvis pris hvilede på én stærk evne. Lønkrav ændrede sig ikke med denne opdatering, og underskrevne kontrakter røres aldrig. Herfra opdateres værdier igen kun om søndagen.

---

## 4. Hjælpetekst (help.json, en+da), til samme PR som patch note 3

Skal forklare i to-tre sætninger: værdien bygger på de samme evner som ratingen for rytterens type, plus hans alder og forventede karriere; lønkrav bygger på hvad rytteren forventes at køre ind på én sæson og er ikke det samme tal; værdier opdateres om søndagen. Skrives når patch note 3 lægges ind, så tekst og kode følges ad.
