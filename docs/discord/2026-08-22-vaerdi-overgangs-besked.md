# Discord-udkast · værdi-overgangen (fremrykket, ejer-direktiv 21/8)

> **Klar til copy-paste. Ejeren poster selv.** Kopiér fra RÅteksten, ellers falder linjeskift ud.
>
> **Kanal:** #the-roadbook (EN), DA til de danske kanaler.
>
> **ERSTATTER besked 2 i [`2026-08-17-cutover-beskeder.md`](2026-08-17-cutover-beskeder.md)** — den sagde "values stand still Sunday" og "no date", hvilket ikke længere passer efter ejer-beslutningen 21/8 om at fremrykke overgangen.
>
> **SKAL postes FØR selve kørslen** (læring #3709: spillerne hører det fra os først).
>
> **⚠️ Tallet "about 11 %" gælder KUN hvis c = 0,89 (anbefalingen). Vælges c = 0,67, er tallet "about a third" — ret BEGGE sprog før posting.** Dry-run-tal 21/8: c=0,894 → −10,6 % (Σ 300,7 → 268,8 mio.), c=0,666 → −33,4 % (→ 200,2 mio.).

---

## EN

**Values: the transition starts this weekend**

Last week I told you the next value update would blend the old formula with a new one built on real trades. Rebuilding and re-measuring that model twice taught me something better: the market already agrees with the current model about which riders are worth more than others. It only disagrees about two things — the overall level, and a handful of rider types whose prices were based on very thin data.

So instead of a new formula, the transition starts with one clean correction, running this weekend, before the season change:

**1. The level comes down to what riders actually trade for.** Real trades between managers happen below the listed values, so all values are adjusted down by about 11 % to match the evidence from the negotiated market.

**2. Rider types are re-priced on fair footing.** A few types had their price tag fitted on a handful of riders — puncheurs most of all, priced almost 8x above neutral on 19 data points. That surcharge is dampened hard. If you own a puncheur, his value will drop a lot. He is not getting worse — his old price was never backed by evidence. Climbers, sprinters and the common types barely move from this part.

Three things to hold on to:

- **No salary changes from this.** Wages are set by their own system from Sunday, as covered in the salary post earlier this week.
- **Every affected team gets a notification**, and the adjustment is logged per rider.
- **This is a one-time correction, not a new habit.** After it runs, values update only on Sundays, gradually, with weekly limits — and keep moving toward what you actually pay.

One more step follows after the season change: values move onto the corrected rider types from the type rework, as announced earlier. That step gets its own update before it runs.

The direction is unchanged: real actions, real consequences, values anchored in what the market really pays.

---

## DA

**Værdier: overgangen starter i denne weekend**

I sidste uge fortalte jeg jer at næste værdi-opdatering ville blande den gamle formel med en ny bygget på rigtige handler. At bygge den model om og måle den igen — to gange — lærte mig noget bedre: markedet er allerede enigt med den nuværende model om hvilke ryttere der er mere værd end andre. Den er kun uenig om to ting — det samlede niveau, og en håndfuld ryttertyper hvis priser var baseret på meget tynde data.

Så i stedet for en ny formel starter overgangen med én ren korrektion, som kører i denne weekend, før sæsonskiftet:

**1. Niveauet kommer ned til det ryttere faktisk handles til.** Rigtige handler mellem managere sker under de listede værdier, så alle værdier justeres ned med cirka 11 % så de passer med evidensen fra det forhandlede marked.

**2. Ryttertyper prissættes på fair grundlag.** Nogle få typer fik deres prisskilt fittet på en håndfuld ryttere — mest af alle puncheurs, prissat næsten 8x over neutral på 19 datapunkter. Det tillæg dæmpes hårdt. Ejer du en puncheur, falder hans værdi meget. Han bliver ikke dårligere — hans gamle pris var aldrig bakket op af evidens. Klatrere, sprintere og de almindelige typer flytter sig næsten ikke af denne del.

Tre ting at holde fast i:

- **Ingen lønændringer af dette.** Lønnen styres af sit eget system fra søndag, som beskrevet i løn-opslaget tidligere på ugen.
- **Alle berørte hold får en notifikation**, og justeringen logges pr. rytter.
- **Det er en engangs-korrektion, ikke en ny vane.** Efter den kører, opdateres værdier kun om søndagen, gradvist og med ugentlige lofter — og bevæger sig fortsat mod det I faktisk betaler.

Ét skridt mere følger efter sæsonskiftet: værdierne flytter over på de rettede ryttertyper fra type-omlægningen, som tidligere annonceret. Det skridt får sin egen opdatering før det kører.

Retningen er uændret: rigtige handlinger, rigtige konsekvenser, værdier forankret i det markedet faktisk betaler.

---

## Kilder og forbehold

- Niveau-tallet: dry-run 21/8 mod hele populationen (6.342 ryttere inkl. AI-hold, Σ 300,7 mio.) — c=0,894 (seneste 30-dages forhandlings-median) giver −10,6 %. Gate-forhåndsmåling: n90=76 kvalificerede forhandlede handler, rullende medianer 0,99/0,85/0,89 (spænd 0,136 ≤ 0,15). Logget på #3750.
- Puncheur-tallet: #4000-scorecardet (ejer-godkendt 20/8): offset 2,071 = 7,9x på n=19 → 1,7x ved k=100; puncheur-værdier −78,4 % normaliseret. 92 spillerejede puncheurs (målt 21/8).
- "Ingen lønændringer": #3989 (løn = CPV × 0,35) er værdi-uafhængig; korrektionen skriver kun base_value. OBS til ejeren: dæmpnings-backfillen ændrer OGSÅ current_production_value → løn-dry-runnet (×2,21) genkøres FØR søndagens genberegning, så løn-beskedens "~2x" er verificeret frisk.
- "Kun om søndagen": marketValueSundaySweep + gate-målingen er søndags-gated; engangs-korrektionen er undtaget som ejer-godkendt engangskørsel (audit 14/8).
- Rækkefølge på dagen (bindende, #4000/#3353): besked postes → snapshot → c-apply (--confirm-apply, ejer-go) → deploy af dæmpnings-flip → fuld backfill (backfillRiderBaseValue) → post-verify + genkørt løn-dry-run → patch note.
