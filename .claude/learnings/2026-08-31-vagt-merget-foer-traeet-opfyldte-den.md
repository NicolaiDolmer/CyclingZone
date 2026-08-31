# En vagt merget før træet opfyldte den — main blev rød

**Dato:** 31/8 2026 · **Issues:** #4479 (PR #4483), #4465 (PR #4477)

## Hvad skete der

PR #4483 tilføjede `promisedTestFilesExist.test.js`: en vagt der fælder hvis en doc
eller kodekommentar navngiver en `*.test.js`-fil der ikke findes. Den var korrekt,
mutationstestet og grøn på sin egen branch.

Jeg merged den. **Main blev rød med det samme.**

`docs/CALENDAR_RULES.md` forkortede på main `raceCalendarLanePackerInvariants.test.js`
til `…LanePackerInvariants.test.js` i to tabelrækker. Vagten læste navnet efter
ellipsen som en fil der ikke findes. To CI-kørsler på main fejlede, før jeg opdagede
det — og jeg opdagede det kun, fordi en *anden* PR's `backend-tests` pludselig
fejlede på noget den ikke havde rørt.

## Rodårsagen

En vagts branch er ikke det træ vagten skal håndhæve. #4483's branch var grøn, fordi
den var forgrenet før — eller uden — de to linjer i `CALENDAR_RULES.md`. Grøn CI på
branchen beviser at vagten virker på **branchens** tilstand, ikke at **main** opfylder
den.

Det er den samme familie som resten af dagens fund, bare vendt om: normalt lyver et
grønt flueben om at noget er dækket. Her sagde et grønt flueben sandt om branchen og
intet om destinationen.

## Reglen

**Før du merger en ny vagt: kør den mod `origin/main`, ikke kun mod din branch.**

```bash
git worktree add --detach /tmp/vagt-check origin/main
# kopiér vagten ind, kør den, og se om main faktisk opfylder den
```

Fælder den, er der to veje, og de er ikke ligeværdige:

1. **Ret træet i SAMME PR** som vagten. Så er main aldrig rød.
2. Ret vagten, hvis fundet er en falsk positiv.

Det jeg gjorde — merge vagten og rette træet i en senere PR — efterlod main rød i
mellemtiden og fik en tredje PR til at se ødelagt ud.

## Sidebemærkning: hvad der IKKE var problemet

Fristelsen var at kalde det en falsk positiv og løsne vagten. Det ville have været
forkert. Forkortelsen `…Foo.test.js` fandtes præcis **to** steder i hele træet, begge
i samme fil. Anomalien var forkortelsen, ikke vagten. En vagt man løsner første gang
den siger noget ubelejligt, er ikke en vagt.

Tjek altid udbredelsen før du beslutter hvem der har ret:

```bash
grep -rn '`…[A-Za-z]*\.test\.js' docs/ .claude/
```

To forekomster → ret dem. Halvtreds → vagten mangler en regel.

## Beslægtet

- `.claude/learnings/2026-08-28-groent-flueben-der-intet-verificerede.md`
- #4463 (nat-vagt grøn uden at måle) · #4479 (vagt lovet i prosa, aldrig bygget)
- #4482 (mekanik testet, men aldrig kaldt)
