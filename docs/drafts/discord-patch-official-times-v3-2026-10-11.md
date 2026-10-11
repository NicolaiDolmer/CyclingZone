# Udkast: official_times_v3 tændt (#6452)

Bruges KUN når ejeren har sagt "tænd", og flip-PR'en (#6452) er merget. Ejeren poster selv.

## Discord #patch-notes (kun EN, postes som rå tekst)

```
New race rules from the next race start

Every race that starts from now on runs on the new race rules. Races that have already started finish on the rules they started with.

- A team without an order chases on its own when it has a rider who can win the day's finale: a sprinter on flat stages, a puncheur on hilly stages, a climber in the mountains.
- Chase always adds power to the chase. Leave the chase to others means your team doesn't help, and it never slows the bunch down. Your own order always comes first.
- On a mountain stage that ends on a descent, the last climb counts like a summit finish.
- On a hilly time trial, Time trial is the main ability. Climbing only counts for the uphill part.
- With no Sprint captain, a Captain who is a sprinter gets the sprint train on flat stages.
- The team classification uses times without bonus seconds.
- Races use each rider's Form. Form peaks do not count in races yet.

The Help page has the details under Break orders and GC reaction.
```

## Patch note til `frontend/src/data/patchNotes.js` (EN først, DA under)

Lægges ind ved tænding af den session der merger (patchNotes.js kræver samtidig `docs/NOW.md`-ændring, jf. `scripts/check-patch-notes-version.js`, og NOW.md er hovedsessionens). Næste versionsnummer over den øverste på main; `date` = merge-dagen.

```json
{
  "version": "<næste>",
  "date": "<merge-dag>",
  "changes": [
    {
      "category": "improved",
      "audience": "player",
      "rollout": "switched_on",
      "topic": "Races",
      "en": {
        "title": "New race rules from the next race start",
        "body": "Every race that starts from now on runs on the new race rules. A team without an order chases when it has a rider who can win the day's finale: a sprinter on flat stages, a puncheur on hilly stages, a climber in the mountains. Chase always adds power, and Leave the chase to others never slows the bunch. On a mountain stage that ends on a descent, the last climb counts like a summit finish. Races that have already started finish on the rules they started with."
      },
      "da": {
        "title": "Nye løbsregler fra næste løbsstart",
        "body": "Alle løb, der starter fra nu af, kører på de nye løbsregler. Et hold uden ordre jager, når det har en rytter, der kan vinde dagens finale: en sprinter på flade etaper, en puncheur på kuperede etaper, en klatrer i bjergene. Jag giver altid ekstra kraft, og Overlad jagten til andre bremser aldrig feltet. På en bjergetape, der slutter med en nedkørsel, tæller den sidste stigning som en topafslutning. Løb, der allerede er startet, kører færdigt på de regler, de startede med."
      },
      "refs": [6452, 6441, 6200]
    },
    {
      "category": "improved",
      "audience": "player",
      "rollout": "switched_on",
      "topic": "Races",
      "en": {
        "title": "Time trials, sprint trains and form",
        "body": "On a hilly time trial, Time trial is the main ability and Climbing only counts for the uphill part. With no Sprint captain, a Captain who is a sprinter gets the sprint train on flat stages. The team classification uses times without bonus seconds. Races use each rider's Form; form peaks do not count in races yet."
      },
      "da": {
        "title": "Enkeltstarter, sprint-tog og form",
        "body": "På en kuperet enkeltstart er Enkeltstart den vigtigste evne, og Klatring tæller kun for stykkerne opad. Uden sprint-kaptajn får en kaptajn, der er sprinter, sprint-toget på flade etaper. Holdklassementet bruger tiderne uden bonussekunder. Løbene bruger hver rytters form; formtoppe tæller ikke i løbene endnu."
      },
      "refs": [6349, 6352, 6338, 6156]
    }
  ]
}
```
