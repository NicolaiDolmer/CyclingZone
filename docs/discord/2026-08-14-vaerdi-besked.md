# Discord-udkast · værdi-beskeden (14/8)

> **Klar til copy-paste. Ejeren poster selv.** Kopiér fra RÅteksten, ellers falder linjeskift ud.
>
> **Kanal:** #the-roadbook (EN), hvor 11/8-værdibeskeden ligger. DA til de danske kanaler.
>
> **Formål:** melde ærligt ud at 75/25-blandingen lovet 11/8 ikke kommer i denne uge, hvorfor, og hvornår den så kommer. Dato **søndag 30/8** er ejer-valgt 14/8.

---

## EN

**Values: the update I said was coming this week is not coming this week**

On Monday I told you the next value update would use 75 % of the old formula and 25 % of the new one, and that values would come down across the board. I am not shipping it this week, and I would rather tell you why than let it go quiet.

I re-measured the new model against the most recent trades. It is currently less accurate than the one already running: it misses a rider's real sale price by around 38,000 CZ$ where the live model misses by around 29,000. Part of why it looked better a few days earlier is that about two thirds of auctions close right on the price the model itself suggested, so it was partly grading its own homework.

There is a second reason. The new model prices a rider from his rider type, and rider types are exactly what I have been rebuilding this week. Fitting a value model to types that are still moving means refitting it again days later.

So nothing changes this week. Your riders keep the values they have.

**The new date is Sunday 30 August**, the first Sunday of season 3. By then the rider type work is done and the model will have been refitted on the corrected types. If the refit still measures worse than what is running, I will say so here and move it again rather than ship something that makes values less accurate.

When it does run, it moves gradually. No rider can move more than 25 % in a single week, and most will move far less than that.

The direction has not changed. Values are moving toward what you actually pay for riders.

---

## DA

**Værdier: den opdatering jeg sagde kom i denne uge, kommer ikke i denne uge**

Mandag skrev jeg at næste værdi-opdatering ville bruge 75 % af den gamle formel og 25 % af den nye, og at værdierne ville falde over hele linjen. Jeg sender den ikke i denne uge, og jeg vil hellere fortælle jer hvorfor end lade det gå i sig selv.

Jeg har målt den nye model igen mod de nyeste handler. Den rammer lige nu dårligere end den der allerede kører: den rammer en rytters faktiske salgspris cirka 38.000 CZ$ forkert, hvor den nuværende rammer cirka 29.000 forkert. En del af grunden til at den så bedre ud for få dage siden er, at omkring to tredjedele af auktionerne lukker præcis på den pris modellen selv foreslog. Den rettede altså delvist sin egen stil.

Der er en anden grund. Den nye model prissætter en rytter ud fra hans ryttertype, og ryttertyperne er præcis det jeg har bygget om i denne uge. At tilpasse en værdimodel til typer der stadig flytter sig betyder at den skal tilpasses igen få dage efter.

Så der sker ikke noget i denne uge. Jeres ryttere beholder de værdier de har.

**Den nye dato er søndag 30. august**, sæson 3's første søndag. Til den tid er arbejdet med ryttertyperne færdigt, og modellen er tilpasset de rettede typer. Rammer den stadig dårligere end den der kører, siger jeg til her og flytter den igen frem for at sende noget der gør værdierne mindre præcise.

Når den kører, sker det gradvist. Ingen rytter kan flytte sig mere end 25 % på én uge, og de fleste flytter sig langt mindre.

Retningen er uændret. Værdierne bevæger sig mod det I faktisk betaler for ryttere.

---

## Kilder bag tallene

- **38.176 mod 28.968 CZ$** — markedsmodel v1.1 mod v4 (LIVE), MAE på tidsbaseret holdout (seneste 20 % af handlerne), genkørt read-only mod prod 10/8. Se [#3449](https://github.com/NicolaiDolmer/CyclingZone/issues/3449)s advarselsblok. Afrundet i beskeden.
- **To tredjedele** — 65,4 % af auktioner lukker på modellens eget anker ([#3729](https://github.com/NicolaiDolmer/CyclingZone/issues/3729)). Årsagen er `auctionRules.js:106-110`: startprisen på egen rytter må ikke overstige modellens værdi, og en bank-rytter må ikke gå under den.
- **Ryttertyperne flytter sig** — 74,8 % divergens mellem `primary_type` og `valuation_type` (målt 14/8; 62,4 % pr. 10/8, se #3449).
- **±25 % pr. uge** — `market_value_weekly_cap` = 0.25, ejer-besluttet 6/8. Blandingsvægten er `market_value_global_weight` = 0.5 gange rytterens handelsevidens, så de fleste flytter sig langt mindre end loftet.
- **Søndags-gaten** — `marketValueSundaySweep.js:238` returnerer `skipped: "not_sunday"`. Derfor kan datoen kun være en søndag.

## Forbehold ejeren skal kende

Løftet "værdier og lønninger mellem i dag og fredag", som MASTERPLAN og specen citerer fra 11/8, kunne **ikke findes ordret** i Discord ved en gennemgang af #patch-notes, #the-roadbook, #general, #annoncements og #dansk-snak 14/8. Udkastet siger derfor "denne uge", hvilket er sandt uanset. Er dagen lovet et sted der ikke blev tjekket, bør den nævnes direkte.

**Lønnen falder IKKE med værdien længere.** 11/8-beskeden sagde at når værdierne kommer ned, kommer de ønskede lønninger også ned. Efter løn-decouplingen (#2594) beregnes løn af `current_production_value`, ikke af `market_value` (`contractSeed.computeFrozenSalary`). Udkastet lover derfor intet om løn. Skal lønnen ned, er det #3393, et selvstændigt spor.
