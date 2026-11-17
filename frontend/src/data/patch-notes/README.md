# Patch notes som fragmenter (#8346)

En PR skriver sin patch note som ÉN ny fil i `pending/`. Den rører ikke `../patchNotes.js` og giver intet versionsnummer, så to PR'er aldrig rører samme fil.

**Filnavn:** `pending/<issue>-<kort-slug>.json`, kun `a-z`, `0-9` og bindestreg, fx `pending/8069-planning-deadline.json`.

**Indhold:** samme felter som en post i `patchNotes.js`, men uden `version` og `date`:

```json
{
  "changes": [
    {
      "category": "fixed",
      "audience": "player",
      "rollout": "live",
      "topic": "Calendar",
      "en": { "title": "Each race once in the calendar", "body": "..." },
      "da": { "title": "Hvert løb én gang i kalenderen", "body": "..." },
      "refs": [5841]
    }
  ]
}
```

Reglerne for teksten står i `docs/PATCH_NOTES_RULES.md` (rollout, `flag` på beta-noter, tone). `scripts/check-patch-notes-version.js` validerer fragmentet i CI med de samme regler som en ny post. Lokalt: `node scripts/patch-notes-number.mjs check`.

**Nummer og dato:** merge-toget giver dem efter et verificeret tog (`scripts/merge-queue-closeout.mjs` kalder `scripts/patch-notes-number.mjs`). Ventende fragmenter flyttes ind øverst i `patchNotes.js` i merge-rækkefølge med dato = merge-dagen og slettes, som ét chore-commit på main.

**Synlighed:** ingen kode importerer `pending/`, så en ventende note vises ikke for spillerne, før den har fået sit nummer.

Manuel fallback (fx hvis toget ikke kørte close-out): `node scripts/patch-notes-number.mjs plan --ref origin/main` viser planen, `node scripts/patch-notes-number.mjs push` udfører den på main.
