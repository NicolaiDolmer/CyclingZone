# Tre lag uden dækning: hvordan to løgne kunne stå på Scouting-fanen i månedsvis

**Dato:** 2026-08-13 · **Issues:** #3667, #3671 · **PR'er:** #3672 (merged), #3676, #3675

## Symptomet

Transparens-auditten fandt to påstande på rytterprofilens Scouting-fane der var direkte usande:

- `help.json › sections.riders.scouting`: *"Potential is always shown as stars and a verdict, **never as a number**"* — mens `RiderScoutingTab.jsx` printede `{now} · {ceilLo}–{ceilHi}` som rene tal.
- Chippen ved verdict'et sagde **"Høj tillid"** om et loft-bånd der kan være 10 rating-point bredt. `buildVerdict` sætter `confidence = own || level >= maxLevel ? "high"` — feltet måler hvor **fuldt scoutet** rytteren er, ikke hvor præcist estimatet er. To linjer længere nede sagde `recalcNote` at båndet afspejler spejderens præcision. De to udsagn stod på samme kort og modsagde hinanden.

Begge havde stået længe. Ingen gate fangede dem.

## Rod-årsagen: tre lag der hver især var blinde

**Lag 1 — ingen e2e-spec.** Ingen af de 52 spec-filer åbnede nogensinde Scouting-fanen. Fladen blev aldrig renderet i CI.

**Lag 2 — id-blind scouting-mock.** `mockHandlers` returnerede `SEED_SCOUTING_REPORT` (`own: true`, fuldt loft-bånd) for **enhver** rytter-id, også rivaler. En spec der ville teste "en rivals potentiale er skjult" ville have set det stik modsatte af hvad prod gør.

**Lag 3 — id-blindt REST-filter.** `restRows("riders")` kendte kun `pending_team_id=eq.` og `team_id=eq.team-e2e`. En `.eq("id", riderId)` faldt igennem til hele `RIDERS`, og `restObject` tog `[0]`. **Enhver `/riders/<id>` rendrede rider-1.**

Lag 3 skjulte lag 2: så længe hver rytter-URL landede på ens egen rytter, kunne man ikke se at scouting-mocken var id-blind. Og lag 1 betød at ingen nogensinde kiggede.

Det er en falsk-grøn-maskine. En test med navnet *"en rival-rytters potentiale er skjult indtil du scouter ham"* ville have været grøn uden nogensinde at have set en rival — og ville være blevet ved med at være grøn hvis skjulningen gik i stykker.

## Min egen fejl undervejs

Jeg påstod i to commit-beskeder, to PR-bodyer og over for ejeren at mocken for `GET /api/riders/:id/scouting-report` **manglede**, og tilføjede en ny. Det var forkert: `mockHandlers` har haft `/scouting-report → SEED_SCOUTING_REPORT` siden #3334. Min tilføjelse blev tjekket først i `apiResponse` og skyggede for den eksisterende — to seeds for samme endpoint, hvor den ene var usynlig.

Præmissen kom af at preview-serveren ikke viste fanen. Den rigtige årsag var at `frontend-mock` redirecter til `/login` — auth, ikke en manglende mock. **Jeg sluttede fra symptom til årsag uden at grep'e efter mocken.** Det er præcis den fejl hele sessionen handlede om, begået midt i den.

Fejlen blev fanget ved et tilfælde: jeg læste `mockHandlers.js` af en anden grund under close-out og så importen af `SEED_SCOUTING_REPORT`.

## Rettelserne

- Chippen hedder nu **"Fuldt scoutet" / "Delvist scoutet" / "Knap nok scoutet"** med en tooltip der siger at *bredden* afhænger af spejderens rating. Verdict-kortet har fået en linje om at dommen er spejderens vurdering, ikke en kendsgerning.
- `restRows("riders")` filtrerer på `id=eq.` og `id=in.(...)`, ankret på `?` eller `&` så mønstret ikke rammer inde i `team_id=eq.`. Ukendt id → tom liste, så profilen fejler **synligt** i stedet for tavst at vise en anden rytter.
- `/scouting-report` spejler nu #1543: rytter uden for eget hold → `{ hidden: true }`.
- `scouting-verdict.spec.js` — 3 tests × 3 projekter. Én af dem er en anti-inversions-guard: `lo < hi` på alle otte rækker, så loftet aldrig kan kollapse til ét aflæseligt tal (#1543/#1162).
- `RiderScoutingTab.confidence.test.js` — forward-guard: mærkatet må ikke indeholde "tillid"/"confidence"/"præcis", og hver `confidence`-værdi skal have både label og titel i EN+DA.

## Læringer

1. **En flade uden e2e-spec er en flade hvor copy kan lyve i månedsvis.** Auditten fandt løgnene ved at læse koden — men det var et menneskeligt tilfælde, ikke en gate. Spørg ved nye player-facing flader: findes der en spec der faktisk åbner den?
2. **En mock der ignorerer sit filter er værre end ingen mock.** Ingen mock fejler højlydt. En id-blind mock producerer grønne tests der beviser det modsatte af produktionen. Når en mock får et id ind, skal den enten bruge det eller returnere tomt — aldrig svare med "den første".
3. **Verificér præmissen, ikke kun konklusionen.** "Preview viser ikke fanen" → "altså mangler mocken" er en slutning, ikke en observation. Ét `grep` ville have afvist den. Reglen om at verificere før man påstår gælder også ens egen diagnose af hvorfor noget ikke virker.
4. **Fejl der skjuler hinanden findes kun ved at rette den ene.** Lag 2 blev først synligt efter lag 3 var rettet. Når man retter et test-infrastruktur-hul, så kig efter hvad rettelsen nu blotlægger — i stedet for at antage at man er færdig.
5. **Stakkede PR'er auto-lukkes når base-branchen slettes ved merge.** #3674 blev lukket af GitHub da #3672 merged med `--delete-branch`. Rebase på main + ny PR er oprydningen. Overvej at basere på `main` fra start, medmindre der er en reel filkonflikt.
