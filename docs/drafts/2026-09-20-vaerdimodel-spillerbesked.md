# Udkast: spillerbesked om den nye værdimodel (ejeren poster selv)

> **Til ejeren (ikke en del af beskeden).** Skrevet af Claude 20/9 efter dine svar i dag (#5443). Ingen datoer og ingen tal, jf. din regel for roadbook-beskeder; datoen kommer i en ny besked, når du har godkendt modellen. To versioner: en kort til tråden "Players stuck in value" i #bugs (svar til knud_r_flink og egomadsen) og en længere til #the-roadbook. EN først, DA under. Ret frit; det er din stemme.
>
> Det beskeden lover, og som derfor SKAL holde: (1) værdi og rating regnes på de samme evner, (2) ingen frysninger, (3) værdier kan gå både op og ned, (4) markedet får gradvist mere at sige, inkl. tomme auktioner og bud, (5) du kan se hvorfor en værdi flyttede sig, (6) kun søndage. Punkt 5 (kvitteringen) er ikke bygget endnu; stryg den linje, hvis den ikke er med i første udgave.

---

## A. Kort svar i tråden "Players stuck in value" (#bugs)

**EN**

You were right, and it took me too long to see why.

A rider's rating and a rider's value have been looking at different abilities. When I widened the rating recipes in August, the value formula never followed. So a sprinter could train, improve, climb in rating, and his value would not move, because the value was still watching one single ability he never trained. Ryan Cooper and Wessel Mertens are exactly that case.

I'm not patching those riders one by one. I'm replacing the value model with one that reads the same abilities as the rating you already see on the card, for every rider in the game. I'll post the details in #the-roadbook before anything changes.

**DA**

I havde ret, og det tog mig for lang tid at se hvorfor.

En rytters rating og en rytters værdi har kigget på forskellige evner. Da jeg gjorde rating-opskrifterne bredere i august, fulgte værdiformlen aldrig med. En sprinter kunne derfor træne, blive bedre og stige i rating, uden at værdien rørte sig, fordi værdien stadig kun holdt øje med én enkelt evne, han aldrig trænede. Ryan Cooper og Wessel Mertens er præcis det tilfælde.

Jeg lapper ikke de ryttere én for én. Jeg skifter værdimodellen ud med en, der læser de samme evner som den rating, du allerede kan se på kortet, for alle ryttere i spillet. Jeg skriver detaljerne i #the-roadbook, før noget ændrer sig.

---

## B. Længere besked til #the-roadbook

**EN**

**A new value model is coming**

Rider values have been the part of the game I've been least happy with, and several of you have shown me exactly where it breaks: riders who improve week after week while their value stands still.

Here is what I found. The rating on a rider's card and his value were calculated from different abilities. For some rider types the value only listened to one ability. Train anything else and nothing happened. On top of that, I had frozen parts of the value system over the summer to avoid sudden jumps while I rebuilt rider types. Those freezes kept the peace, but they also kept the mistakes.

So I'm doing it properly:

- **One recipe.** A rider's value is built from the same abilities as the rating you see on his card. If the rating moves, the value follows.
- **No more frozen parts.** Everything that was parked over the summer gets removed, so the model is one coherent thing again.
- **The market gets a voice, step by step.** What you actually pay for riders will gradually count for more. Real bidding wars count. Bids that lost an auction count. And an auction nobody bid on counts too: if no manager wants a rider at his listed price, that says something.
- **You can see why.** When a value changes, the rider will tell you what moved it.
- **Still Sundays only.** Values keep updating once a week, never in between.

I want to be straight about one thing: this will move values in both directions. Many riders have been priced too low and will rise. Some have been priced too high, mostly riders whose value leaned on a single strong ability, and they will fall, in some cases a lot. That isn't a punishment for good riders. It's the price catching up with the rating you could already see.

I'll show you the model before it goes live, and I'll tell you the day in a separate post. If you have a rider you think looks wrong afterwards, tell me. That's how we found this one.

**DA**

**En ny værdimodel er på vej**

Rytterværdierne er den del af spillet, jeg har været mindst tilfreds med, og flere af jer har vist mig præcis, hvor det knækker: ryttere der bliver bedre uge efter uge, mens værdien står stille.

Her er, hvad jeg fandt. Ratingen på rytterens kort og hans værdi blev regnet ud fra forskellige evner. For nogle ryttertyper lyttede værdien kun til én evne. Trænede du noget andet, skete der ingenting. Oven i det havde jeg frosset dele af værdisystemet hen over sommeren for at undgå pludselige hop, mens jeg byggede ryttertyperne om. Frysningerne holdt ro på tingene, men de holdt også fast i fejlene.

Så nu gør jeg det ordentligt:

- **Én opskrift.** En rytters værdi bygges af de samme evner som den rating, du ser på hans kort. Flytter ratingen sig, følger værdien med.
- **Ikke flere frosne dele.** Alt det, der blev parkeret hen over sommeren, bliver fjernet, så modellen igen hænger sammen.
- **Markedet får en stemme, trin for trin.** Det I faktisk betaler for ryttere, kommer gradvist til at tælle mere. Rigtige budkrige tæller. Bud der tabte en auktion tæller. Og en auktion ingen bød på tæller også: hvis ingen manager vil have en rytter til hans listede pris, siger det noget.
- **Du kan se hvorfor.** Når en værdi ændrer sig, fortæller rytteren dig, hvad der flyttede den.
- **Stadig kun søndage.** Værdierne opdateres fortsat én gang om ugen, aldrig ind imellem.

Én ting vil jeg sige lige ud: det her flytter værdier i begge retninger. Mange ryttere har været sat for lavt og vil stige. Nogle har været sat for højt, mest ryttere hvis værdi hvilede på én enkelt stærk evne, og de vil falde, i nogle tilfælde meget. Det er ikke en straf for gode ryttere. Det er prisen, der indhenter den rating, du allerede kunne se.

Jeg viser jer modellen, før den går live, og jeg fortæller dagen i et særskilt opslag. Har du bagefter en rytter, du synes ser forkert ud, så sig det til mig. Det var sådan, vi fandt den her.
