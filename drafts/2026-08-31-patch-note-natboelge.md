# Patch note-udkast 7.223 - natbølgen 30-31/8

> **Ikke skrevet ind i `patchNotes.js` endnu, og det er med vilje.** Ingen af bølgens PR'er er merget. En patch note der beskriver noget der ikke er live, lyver for spillerne. Skriv den ind når PR'erne lander, og fjern de punkter hvis PR ikke merges.
>
> **Rækkefølge (bidt 30/8):** entryen indsættes ØVERST i `PATCHES`-arrayet. Er der en anden uindsat patch note på vej, så afklar rækkefølgen først i stedet for at udlede den.

Seks spillervendte ændringer. Alle EN først, DA under.

---

## 1. Achievements - `fixed`

**PR #4466, Refs #4414. Rapporteret af thelamba 29/8.**

- **EN:** "High Roller could not be earned"
  High Roller asked for a bid over 500,000 CZ$ in its description, but the code required a bid over 2,000,000,000. It now unlocks at 500,000 as promised, and every manager who already qualified gets it on their next visit.
- **DA:** "High Roller kunne ikke opnås"
  High Roller lovede et bud over 500.000 CZ$ i sin beskrivelse, men koden krævede et bud over 2.000.000.000. Den låser nu op ved 500.000 som lovet, og alle managere der allerede kvalificerede sig får den ved næste besøg.

---

## 2. Race results - `fixed`

**PR #4472, Refs #3145. Rapporteret tre gange af spillere.**

- **EN:** "Time trials no longer claim riders sacrificed themselves"
  On an individual time trial nobody rides for anybody, so the helper sacrifice story beat is gone. On road stages it now only appears when a helper actually paid for the work.
- **DA:** "Enkeltstarter påstår ikke længere at ryttere ofrede sig"
  På en enkeltstart kører ingen for nogen, så ofrings-teksten er væk. På landevejsetaper vises den nu kun når en hjælper faktisk har betalt for arbejdet.

---

## 3. Race Hub - `fixed`

**PR #4468, Refs #3410. Rapporteret af thelamba 5/8.**

- **EN:** "The rider pool explained the wrong reason for a lock"
  The note under the pool said a locked rider was busy in an overlapping race, even when the real reason was that every race shown had already started or you had withdrawn from it.
- **DA:** "Rytterpuljen forklarede den forkerte grund til en lås"
  Noten under puljen sagde at en låst rytter var optaget i et overlappende løb, også når den reelle grund var at alle viste løb allerede var begyndt, eller at du havde meldt fra.

---

## 4. Help - `improved`

**PR #4476, Refs #4382. Spørgsmål fra egomadsen og thelamba.**

- **EN:** "The board's 3-year and 5-year plans are documented"
  Help now covers the full lifecycle: when a multi-year plan expires and goes back to negotiation, that all three plan types can trigger a bonus offer, and why the timing of that offer varies.
- **DA:** "Bestyrelsens 3- og 5-årsplaner er dokumenteret"
  Hjælp dækker nu hele forløbet: hvornår en flerårsplan udløber og går tilbage til forhandling, at alle tre plantyper kan udløse et bonustilbud, og hvorfor tidspunktet for tilbuddet varierer.

---

## 5. Discord - `fixed`

**PR #4460, Refs #3483.**

- **EN:** "A dead Discord connection now tells you"
  A connection that permanently fails releases itself instead of staying silent, so you get a reconnect prompt in settings.
- **DA:** "En død Discord-forbindelse siger nu til"
  En forbindelse der permanent fejler kobler sig selv fra i stedet for at tie, så du får en genforbind-besked i indstillingerne.

---

## 6. Academy - `fixed`

**PR (#4484), Refs #4484. Fundet af den daglige Sentry/Railway-triage 31/8.**

- **EN:** "An academy graduate could get stuck with no way to resolve them"
  A rider who spent time in your academy across two seasons could end up impossible to promote, sell or release: the button returned an error, and the nightly auto-resolve failed on them too. They are now resolved normally.
- **DA:** "En akademi-graduerende kunne sætte sig fast uden vej videre"
  En rytter der havde været i dit akademi over to sæsoner kunne ende umulig at promovere, sælge eller frigive: knappen svarede med en fejl, og den natlige auto-afgørelse fejlede også på ham. Han afgøres nu normalt.

---

## Ikke i patch noten

Resten af bølgen er guards, SSOT-dokumenter, CI og interne oprydninger uden spillerflade. De hører ikke hjemme i en patch note.
