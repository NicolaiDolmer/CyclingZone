# Patch note-udkast: løbsmotor v4-flip

> **Status:** udkast til flip-dagen. Version og dato sættes den dag ejeren flipper `race_engine_v4` (RACE_ENGINE_RULES.md §5, F6 er ejer-gated). Format spejlet fra de tre seneste entries i `frontend/src/data/patchNotes.js` (v7.258-7.260); denne fil rører IKKE den fil.
> **Kilde:** samme fem emner som `sections.raceDay` i help.json (#4910) og `docs/drafts/discord-v4-wave.md`.
> **Bevidst udeladt:** ingen tal/procenter i teksten (fog of war, ejer 6/9), ingen interne mekanik-navne eller issue-numre i selve noten (de hører i `refs`, ikke i prosaen, jf. patch note-reglen om metodetal).
> **Format-reminder (docs/TONE_OF_VOICE.md):** titel = én linje om hvad der er anderledes; body = 1-2 sætninger der kan stå alene; ingen em-dash; EN først, DA under.

```json
{
  "version": "<sættes ved flip>",
  "date": "<sættes ved flip>",
  "label": "Beta",
  "changes": [
    {
      "category": "new",
      "audience": "player",
      "topic": "Races",
      "en": {
        "title": "Race day now plays out on the new engine",
        "body": "Crashes have real stages instead of all-or-nothing: most cost you a bit of time, a bad one can cost you the race but that's rare, and a mechanical never does. There's now a real time limit, with big groups arriving together saved as a grupetto. You can also set how hard each rider goes on the stage you have open, and teamwork, weather and rough roads all pull their weight."
      },
      "da": {
        "title": "Løbsdagen kører nu på den nye motor",
        "body": "Styrt har nu rigtige trin i stedet for alt eller intet: de fleste koster lidt tid, et slemt et kan koste løbet men det er sjældent, og et mekanisk uheld gør det aldrig. Der er nu en rigtig tidsgrænse, hvor store grupper der kommer samlet i mål reddes som en grupetto. I kan også sætte, hvor hårdt hver rytter skal køre på den etape I har åben, og holdspil, vejr og hårdt underlag trækker nu også deres vægt."
      },
      "refs": [3855, 4632, 2944, 2582, 4246]
    }
  ]
}
```

## Noter til den der flipper

- `refs` ovenfor er et forslag, ikke en facitliste: opdatér med de faktiske PR-numre fra paritets-bølgen (byggekø rk. 1-9, `docs/superpowers/specs/2026-09-06-race-engine-v4-flip-and-tactics-design.md` §3) når de er kendt.
- Denne note antager at ALLE fem emner (uheldstrappen, tidsgrænse, intention, holdspil, vejr/brosten) er koblet ind samtidig, jf. flip-scope-beslutningen (RACE_ENGINE_RULES.md §9 punkt 1: "v3-paritet + de tre krav"). Lander de i flere puljer, skal noten splittes tilsvarende, én entry pr. reelt spillerrettet skift.
- `sections.raceDay` i help.json er allerede skrevet og flag-gated (#4910); intet nyt hjælpe-arbejde kræves samme dag, kun at fjerne flag-gaten (se `HelpPage.jsx`'s `raceDayEnabled`) når det globale flag-svar findes.
