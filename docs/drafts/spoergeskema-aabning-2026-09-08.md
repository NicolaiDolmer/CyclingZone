# Spørgeskema-åbning 8/9 2026 (#4943): Discord-udkast + patch note v7.265

> Skemaet ligger i spillet på `cyclingzone.org/survey/2026-09-features` (11 spørgsmål).
> Rækkefølge: ejer tester som admin (draft) → "kør" = status open → `sendSurveyInvite.mjs --dry-run` → "kør" = `--apply` → ejeren poster Discord-opslaget selv → patch note v7.265 merges.
> Tone: `docs/TONE_OF_VOICE.md` (jeg-stemme, EN først, DA under, ingen tankestreg, ingen tal eller datoer).
> Rettelse ift. v2-udkastet (`docs/discord/2026-09-07-spoergeskema-spillere-v2.md` §7): skemaet er IKKE anonymt længere. Svar gemmes på kontoen, så jeg kan krydse dem med division, sprog og anciennitet. Det siger jeg ligeud.

## 1. Discord-opslag (ejeren poster selv)

**EN:**
> @everyone I could really use your help with something fun.
>
> There is a short survey inside the game now about where Cycling Zone goes next. You rate each idea twice: whether you think it is a good idea at all, and how much it matters to you right now. That second part is what tells me which order to build things in, and it is the part I have been guessing at until now.
>
> It takes a few minutes. Your answers are saved on your account, so I can see how managers in different divisions think, but nothing is shared with anyone else. There is room to tell me what is not working as well.
>
> https://cyclingzone.org/survey/2026-09-features
>
> You will also find it in your inbox and on your dashboard. Every answer lands with me. Thank you.

**DA:**
> @everyone Jeg kunne godt bruge din hjælp til noget sjovt.
>
> Der ligger nu et kort spørgeskema inde i spillet om hvor Cycling Zone skal hen. Du giver hver idé to karakterer: om du synes den er god, og hvor meget den betyder for dig lige nu. Det andet er det der fortæller mig i hvilken rækkefølge tingene skal bygges, og det er præcis det jeg har gættet mig til indtil nu.
>
> Det tager få minutter. Dine svar gemmes på din konto, så jeg kan se hvordan managere i forskellige divisioner tænker, men intet deles med andre. Der er også plads til at fortælle mig hvad der ikke fungerer.
>
> https://cyclingzone.org/survey/2026-09-features
>
> Du finder det også i din indbakke og på dit dashboard. Hvert eneste svar lander hos mig. Tak.

## 2. Patch note v7.265 (frontend/src/data/patchNotes.js, samme format som v7.264)

```json
{
  "version": "7.265",
  "date": "2026-09-08",
  "label": "Beta",
  "changes": [
    {
      "category": "new",
      "audience": "player",
      "topic": "Community",
      "en": {
        "title": "A survey about what I should build next",
        "body": "There is a short survey in the game now. You rate each idea twice: is it a good idea, and does it matter to you? Open it from the card on your dashboard, the message in your inbox, or the link in the forum. Your answers are saved on your account and are only read by me."
      },
      "da": {
        "title": "Et spørgeskema om hvad jeg skal bygge næste gang",
        "body": "Der ligger nu et kort spørgeskema i spillet. Du giver hver idé to karakterer: er den god, og betyder den noget for dig? Åbn det fra kortet på dit dashboard, beskeden i din indbakke eller linket i forummet. Dine svar gemmes på din konto og læses kun af mig."
      },
      "refs": [4943]
    }
  ]
}
```

## 3. Tjek før afsendelse

- Ingen tankestreg i teksten.
- EN før DA i hvert afsnit.
- Jeg-stemme, ingen "vi".
- Ingen tal og datoer i Discord-teksten ud over selve linket.
- Ingen forbudte termer (ikke "Founder Supporter", "freemium", "free forever", "støt").
- "Anonymt" er fjernet, fordi svar gemmes på kontoen (`survey_responses.user_id`).
