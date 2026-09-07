# Player survey: what to build next (EN/DA draft), ejeren poster selv

> Skrevet 7/9 2026 til issue #4943 (ejer-direktiv 6/9: spørgeskema til alle spillere senest 7/9)
> og #4820 (indholdsplan 4/9: "Spørgeskema / Hvad er vigtigst / Hvad fungerer dårligst").
> Fristen 7/9 er overskredet ved leveringen af dette udkast; ingen spillerbesked er sendt endnu.
> Tone: `docs/TONE_OF_VOICE.md` (jeg-stemme, EN først/DA under, ingen tankestreg).
> Kandidat-områder verificeret mod `docs/MASTERPLAN.md` (7/9) + #4820's egen liste.
> Ejeren sender selv. Claude leverer kun udkastet.

---

## 1. Værktøjs-anbefaling

**Anbefaling: Google Forms**, med link postet i Discord og en kort besked i appen.

| Værktøj | Benefit | Cost | Alternativ |
|---|---|---|---|
| **Google Forms** (anbefalet) | Gratis, kan være anonymt, alle 8 spørgsmålstyper (skala, multi-select, fritekst), svar eksporteres direkte til Sheets til syntese | Kræver et link ud af Discord/appen, så nogle svarer aldrig | Ingen, det er standardvalget for et engangs-spørgeskema |
| **Discord-poll** | Nul friktion, svares direkte i kanalen | Kun 10 svarmuligheder pr. poll og ingen fritekst, så "hvad fungerer dårligst" og "én ting jeg skal vide" kan ikke stilles | God til et enkelt opfølgende spørgsmål senere, ikke til hele skemaet |
| **In-app skema** | Højeste svarprocent, fanger spillere der aldrig åbner Discord | Kræver byggearbejde (formular, lagring, syntese), og fristen 7/9 er allerede overskredet | Overvej det som fast kanal næste gang, når #954 (transparens-hub) er der |

Google Forms dækker alle 8 spørgsmålstyper i ét skema uden kode, og svarene kan tælles op med det samme. Post linket i Discord (§3) og suppler med den korte in-app-besked (§3), så begge kanaler når spillerne, jf. #4943's åbne punkt 1 (kanal).

---

## 2. Spørgeskemaet (Google Forms, max 8 spørgsmål)

### Q1. Overall satisfaction (scale, required)

**EN:** How satisfied are you with Cycling Zone right now, overall?
1 (not satisfied) to 5 (very satisfied)

**DA:** Hvor tilfreds er du med Cycling Zone lige nu, alt i alt?
1 (ikke tilfreds) til 5 (meget tilfreds)

### Q2. What's most important to build next (pick up to 3, required)

**EN:** What is most important for me to build next? Pick up to 3.
- Race engine (stages, following a race live)
- Training programs
- Transfers and auctions
- Season calendar and routes (including national championships)
- Team and rider identity (faces, personalities, staff)
- Community and forum
- Premium features
- U23 / junior team
- Dashboard and stats
- Economy and sponsors

**DA:** Hvad er vigtigst for mig at bygge næste gang? Vælg op til 3.
- Løbsmotoren (etaper, følge et løb live)
- Træningsprogrammer
- Overgange og auktioner
- Sæsonkalender og ruter (inklusive nationale mesterskaber)
- Hold- og rytteridentitet (ansigter, personligheder, personale)
- Fællesskab og forum
- Premium-funktioner
- U23 / ungdomshold
- Dashboard og statistik
- Økonomi og sponsorer

### Q3. What works worst today (pick up to 3, plus free text, required)

**EN:** What works worst today? Pick up to 3 from the same list, and tell me more below if you want.
*(same 10 options as Q2)*
Free text: What's the worst part, in your own words?

**DA:** Hvad fungerer dårligst i dag? Vælg op til 3 fra samme liste, og uddyb gerne nedenfor.
*(samme 10 muligheder som Q2)*
Fritekst: Hvad er det dårligste, i dine egne ord?

### Q4. What would make you play more (free text, required)

**EN:** What would make you play more?

**DA:** Hvad ville få dig til at spille mere?

### Q5. What would make you invite a friend (free text, required)

**EN:** What would make you invite a friend to join?

**DA:** Hvad ville få dig til at invitere en ven med?

### Q6. Premium (free text, required)

**EN:** What would premium need to include for you to feel it's worth paying for? (If you're not interested in premium at all, say so too.)

**DA:** Hvad skulle premium indeholde, for at det var pengene værd for dig? (Er du slet ikke interesseret i premium, så skriv gerne det også.)

### Q7. One thing I should know (free text, required)

**EN:** If there is one thing I should know about your experience, what is it?

**DA:** Hvis der er én ting jeg skal vide om din oplevelse, hvad er det så?

### Q8. Manager name (optional)

**EN:** Your manager name, if you'd like me to follow up with you directly. Optional.

**DA:** Dit managernavn, hvis du gerne vil have at jeg følger op direkte med dig. Valgfrit.

---

## 3. Post-tekster

### 3a. Discord-opslag (@everyone)

**EN:**
> @everyone I would love your help with something.
>
> I put together a short survey about where Cycling Zone should go next: what matters most to you, what's not working, what would make you play more. Eight questions, most of them quick picks.
>
> **[LINK TIL GOOGLE FORMS]**
>
> Your honest answers shape what I build next. Thank you for taking the time.

**DA:**
> @everyone Jeg vil rigtig gerne have din hjælp til noget.
>
> Jeg har lavet et kort spørgeskema om hvor Cycling Zone skal hen: hvad der betyder mest for dig, hvad der ikke fungerer, hvad der ville få dig til at spille mere. Otte spørgsmål, de fleste er hurtige valg.
>
> **[LINK TIL GOOGLE FORMS]**
>
> Dine ærlige svar former hvad jeg bygger næste gang. Tak fordi du giver dig tid.

### 3b. In-app besked (2 linjer + link)

**EN:**
> Help shape what's next: an eight-question survey on what matters most to you.
> **[LINK TIL GOOGLE FORMS]**

**DA:**
> Vær med til at forme hvad der kommer: et spørgeskema med otte spørgsmål om hvad der betyder mest for dig.
> **[LINK TIL GOOGLE FORMS]**

---

## 4. Verifikation

- Ingen tankestreg (: eller ) i noget af ovenstående, tjekket linje for linje.
- EN altid før DA, i hvert afsnit.
- Ingen tal eller datoer i post-teksterne (§3), kun i den interne header (som ikke er player-facing).
- Ingen forbudte termer fra `TONE_OF_VOICE.md` ("freemium", "Founder Supporter", "free forever", "støt" som verbum) brugt noget sted.
- 10 kandidat-områder i Q2/Q3 verificeret mod `docs/MASTERPLAN.md` (7/9, bane 1-3) og #4820's egen liste: løbsmotor, træning, overgange/auktioner, kalender/ruter/mesterskaber, identitet/ansigter/personale, forum/fællesskab, premium, U23, dashboard, økonomi.
