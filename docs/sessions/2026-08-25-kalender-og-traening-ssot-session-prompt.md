# Session-prompt: kalenderen færdig, derefter træningens SSOT

Kopiér blokken nedenfor ind som første besked i den nye session.

---

```
Læs docs/NOW.md og docs/CALENDAR_RULES.md først. To spor i denne session, i rækkefølge.

## SPOR 1 (vigtigst) — gør løbskalenderen færdig

Kalenderen blev repareret 24/8, men Discord-sweepen samme aften fandt problemer der ikke er løst.

**#4190 — et løb bruger ikke sammenhængende løbsdage.** Ejer-ønske, hans egne ord:
"et løb der tager 10 dage, der bruger 10 løbsdage. endagsløb = en dag". Målt i prod:
11 af 13 D1-etapeløb har huller, i snit 4,6 dage, størst 12 (La Corsa dei Due Mari:
7 etaper spredt over løbsdag 10-28). jeppek diagnosticerede årsagen selv: Giroen kører
3 løbsdage i en periode hvor de andre kører 1, hvilket spreder resten ud.

VIGTIGT: aksen kan IKKE omskrives i S3 — sikkerhedsporten i repairGameDayAxis4161.mjs
nægter så snart første etape er afviklet, og S3 startede 25/8. Det er altså en
GENERATOR-opgave der skal stå klar før S4's kalender bygges, ikke en reparation.
Byg reglen + gates, ikke en datafix.

Reglen skal have alle tre niveauer, jf. CALENDAR_RULES.md §9: pakker-test,
sæsonskifte-preflight og verify-invariants mod prod. Monument-indskuddet (#4075)
lægger BEVIDST en løbsdag ind i sekvensen — de to regler skal kunne sameksistere.

**#4174 — kalenderen kræver op til 29 ryttere, kun 21 % af holdene kan stille fuldt.**
Rammer spillerne nu: forum-tråden "Too few riders or too many races?" og flere i #staff-chat.
Det er en balance-beslutning (overlap-cap × startfelt vs. trupstørrelse) og den er ejerens.
Kom med målte muligheder, ikke en anbefaling i luften.

**#4191 — race_entry_days churner 1 mio. rækker på 8 timer.** Skrive-stien bag
spillerens gem-knap. Mål før og efter.

## SPOR 2 — træningens single source of truth (#4192)

Ejer-direktiv 24/8: "lav en single source of truth angående træning, find alt vi har
lavet og planlagt, stil spørgsmålstegn ved alt, og lav en plan fremadrettet og langsigtet".

Samme øvelse som CALENDAR_RULES.md, og den øvelse virkede: den fandt tre regler der kun
eksisterede som hensigter, og én af dem var brudt i live-data.

FØRSTE LEVERANCE, ejer-valgt: en liste over alle ca. 35 beslutninger fra de tre specs
(2026-08-06-loebsdags-model, 2026-08-09-3564-progressionskaeden, 2026-08-14-3659-
rytterudvikling) med dato, hvad de siger, og OM DE FAKTISK ER BYGGET. Ejeren markerer
selv hvilke der skal genåbnes. Byg ikke noget før den liste er godkendt.

Kendt afvigelse at starte fra: spec'en fra 6/8 siger "på løbsdage udføres det planlagte
pas ikke". Koden beregner i stedet løbets udbytte SOM det planlagte pas × 1,15
(dailyTraining.js:275-283), og abilityMult returnerer 0 for intensitet 'rest'
(dailyTraining.js:85). Derfor får en rytter på Hvile nul udvikling af at køre løb —
1.520 ryttere på 103 hold er i den situation lige nu. Ejerens dom: "Hvis man kører løb
eller træner, så kan man ikke begge dele." Planen må altså ikke være input på en løbsdag.

Den hårdeste måling der skal forklares eller forkastes: over en hel karriere er
forskellen mellem at træne rigtigt og forkert 3 point ud af 60.

## Sådan skal der arbejdes

- Mål ALTID med season_id-filter. game_day er sæson-relativ, og et tal uden filter er
  et forkert tal.
- Stol ikke på kommentarer eller issue-tekst. Verificér i koden og mod prod, og skriv
  hvad du målte.
- Ingen prod-skridt uden konkret GO på netop dét skridt. Dry-run → tal → GO → apply →
  post-verify.
- Ét spørgsmål ad gangen, med tallene inde i selve spørgsmålet. Ejeren ser ikke altid
  prosaen over spørgsmålskortet.
- Vis visuelt undervejs når noget kan tegnes. Lange tekstblokke bliver ikke læst.
- Skær aldrig scope pga. tid. Flag rækkefølge-konflikter og risiko i stedet.

## Spørg mig om mindst dette

- Hvilke af de 35 træningsbeslutninger skal genåbnes?
- Hvad skal afgøre hvor meget en løbsdag udvikler, når planen ryger ud som input:
  løbets profil og indsats, et fast niveau, eller løbets klasse?
- #4174: hvad er det rigtige rytterkrav på den hårdeste dag, når kun 21 % kan levere 29?
```

---

## Hvad der blev gjort 24/8, så det ikke gøres om

| Leverance | Hvor |
|---|---|
| Monument = eksklusiv løbsdag, gated på tre niveauer + dagligt CI-job | PR #4185 |
| Monument-reglen genoprettet i live S3 (107 rækker, 5 brud → 0) | ejer-GO, verificeret |
| `game_day_start` resynket for 334 løb | ejer-GO |
| `d4PoolCount`-default = alle D4-puljer (#4172) | PR #4185 |
| `condeferrable`-vagt mod prod (#4163) | `scripts/constraint-form-audit.sql` |
| Hjælpetekster: løbsdage og træning, etaper pr. dato | PR #4186, live |
| Løbskortet viser datoer i stedet for løbsdags-spændet | #4193 |

`docs/CALENDAR_RULES.md` er SSOT for kalenderen. Læs den før enhver kalender-opgave.
