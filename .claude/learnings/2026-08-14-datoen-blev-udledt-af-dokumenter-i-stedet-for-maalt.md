# Datoen blev udledt af dokumenter i stedet for målt

**Dato:** 2026-08-14 · **Issue:** #3721 · **Fundet af:** ejeren, efter at have set en patch note med forkert dato

## Hvad der skete

Hele #3721-sessionen kørte med den antagelse at det var **16/8**. Det var **14/8**.

Datoen nåede: patch note v7.128 (`"date": "2026-08-16"`, på vej til spillerne), et session-dokuments filnavn (`2026-08-17-...`), seks issue-bodies, en PR-body, fem kodekommentarer og NOW.md.

## Rod-årsag

Systemprompten oplyste `Today's date is 2026-08-14` i sessionens **første besked**. Den blev tilsidesat.

Mekanismen var en baglæns-udledning fra indhold:

1. Session-prompten jeg fik udleveret hed `2026-08-16-traeningssidens-struktur-prompt.md` og skrev "Skrevet: 15/8 aften".
2. `docs/NOW.md` og flere issues talte om "ejer-beslutning 15/8" og "målt 15/8".
3. Konklusion: "hvis 15/8 allerede er sket, må i dag være 16/8."

Fejlen er at dokumenter blev behandlet som et **ur**. De er indhold. Et dokument kan være skrevet i fremtiden, dateret forkert, eller beskrive en anden dag end den det blev gemt på.

**Forstærkende faktor:** repoet er selv misdateret. Commit `46f76381` hedder "session 15/8 lukket" og er skrevet 14/8 kl. 17:24. Patch notes v7.126 og v7.127 er dateret 2026-08-15 på main. Hver gang jeg så en 15/8-reference, bekræftede den den forkerte model.

**`date` blev aldrig kørt.** Ikke én gang i en session med over hundrede shell-kald.

## Hvorfor guarden ikke fangede den

Der findes en regel for præcis det her: [[feedback_verify_numbers_from_specs_before_shipping]] — "et tal i en spec/prompt er IKKE verificeret". Den blev anvendt disciplineret i samme session på trænbarheds-labelen (384 kombinationer målt), på setback (kæden verificeret mod prod), og på trænings-planerne (4.587 rækker talt).

Reglen blev ikke anvendt på datoen, fordi en dato ikke føltes som "et tal fra en spec". Den føltes som kontekst.

## Fix

Rettet i `fix(3721): ret datoen` — patch notes, dokumentnavn, NOW.md, kodekommentarer, testfixtures, plus issues #3758-#3763, PR #3764 og to issue-kommentarer via `gh`.

Ikke rettet: commit-beskeder tidligere på branchen (pushet, omskrives ikke), og v7.126/v7.127 på main, som ser forkerte ud men ikke er mine.

## Læring

**Datoer er tal.** Kør `date` én gang ved sessionsstart og brug det resultat, også når hvert dokument i repoet siger noget andet. Især når de gør — et repo hvor datoerne er inkonsistente er præcis det miljø hvor en udledt dato bliver forkert og ser rigtig ud.

Memory opdateret: [[feedback_verify_numbers_from_specs_before_shipping]] bærer nu dato-instansen og reglen "kør `date`, dokumenter er indhold, ikke et ur".
