# Prompt til ny session

Kopiér alt under linjen.

---

Token-effektiv arbejdssession. Læs `docs/NOW.md` og `CLAUDE.md` først. Korte svar — ejeren afbryder lange tekster.

## Regler for denne session (ejer-direktiv 25/8)

1. **SSOT før arbejde.** Rører opgaven kalenderen, læs `docs/CALENDAR_RULES.md` FØR du rører noget. Samme for `docs/GAME_INVARIANTS.md`. Se #4221.
2. **Tal skal bære deres kilde.** Rapporterer du et tal som OK, skriv hvilken regel det måles mod og om det er et MÅL (ejer-godkendt) eller et GULV (regressionsværn). Et gulv er aldrig en godkendelse. Findes der intet mål — sig det og spørg.
3. **Ejeren designer, du bygger.** Du bestemmer ikke spilregler. Stil spørgsmål ved enhver tvivl.
4. **Ét spørgsmål ad gangen.** Aldrig to emner i samme kort. Hele konteksten skal stå INDE i spørgsmålet — ejeren ser ikke prosaen udenom.
5. **Verificér gates før du stoler på dem.** Måler den planen eller det der står i basen? #4219 kostede tre unødvendige prod-runder på den fejl.
6. **Lav rent faktisk arbejde.** Ikke opgavelister.

## Start sådan

1. Læs Discord-kanal `1522915781766283296`, sidste 10 dage. Find hvad ejeren peger på som vigtigst.
2. Foreslå en plan for i dag og i morgen. Design den MED ejeren — stil spørgsmål.
3. Gå i gang.

## Kvalitetskrav (ejer 25/8)

> "Kvaliteten i vores projekt skal forbedres markant, og alle kernefunktionerne i spillet skal optimeres utroligt meget, til at stå langt mere fejlfrit. Vi må ikke længere lancere en eneste feature som ikke er langt tættere på at være færdigbygget end nu. Der er alt for mange funktioner på det sidste, som er blevet bygget halvfærdigt eller endnu værre — knap nok startet op."

Prioritér at gøre eksisterende kernefunktioner fejlfrie frem for at bygge nyt.

## Tilstand lige nu (verificeret mod prod 25/8 kl. ~10:30)

- **Sæson 3 er IKKE startet.** 0 løbsdage kørt. `stage_scheduler_enabled` + `auto_entry_generator_enabled` er **slået fra**. Tænding er ejer-only.
- **Ny kalender er skrevet:** 531 løb, 1.271 etaper, fredag 28/8 → søndag 27/9. Alle 15 puljer dækker alle 31 kalenderdage.
- **Alle udtagelser er slettet** (ejer-beslutning: alle udtager forfra). 1.940 form-peak-planer er bevaret med `target_race_id` nulstillet.
- **Branch `fix/4214-spaend-binding-og-assistent-opt-in`** er pushet, ikke merged. Indeholder spænd-binding, assistent-opt-in, scorecard-gate, `seasonRollover.mjs`.
- Backup-tabeller: `backup_4215_*`, `backup_4218_*`.

## Åbne opgaver, prioriteret

**Blokerer sæsonstart fredag 28/8:**
- **#4217** spænd-binding — kode klar og testet, DB-migrationen (`database/2026-08-25-4217-spaend-binding.sql`) er IKKE kørt. Uden den kan en rytter stadig forlade et etapeløb midtvejs.
- **#4175** holdudtagelse kan ikke gemmes med færre end fuldt hold minus én. Rammer spillerne fra første løbsdag.
- Spillerbesked med de nye datoer. Ejeren poster selv — du sender aldrig.

**Kvalitet:**
- **#4220** enkeltstarter skal ligne virkelig cykelsport. Ejeren 25/8: fritstående enkeltstartsløb er sjældne i virkeligheden, men etapeløb skal have 0-3 afhængigt af længde. Kræver research FØR regler. Alle tal skal ejer-godkendes.
- **#4219** `raceRouteRealismScorecard.js` måler sin egen plan, ikke basen. Kan give både falsk rødt og falsk grønt.
- **#4221** hard rules så SSOT-dokumenter altid bruges.
- **#4212** form peaks kan ikke fjernes.
- **#4206** 965 ryttere har identiske stats.

**Infrastruktur:**
- **#4214** Infisical machine identity — kræver at ejeren opretter den i web-UI.
- **#4215** scorecard i CI + preflight (delvist bygget).
- **#4216** `seasonRollover.mjs` bygget, ikke kørt i praksis.

## Spørgsmål der venter på ejeren

Stil dem ÉT AD GANGEN, kun når de bliver relevante:

1. **Enkeltstarter** (#4220): hvor mange pr. etapeløb, som funktion af etapeantal? Og hvor sjældne skal fritstående enkeltstartsløb være? Kræver research først.
2. **Brosten**: kompositionsmålet er 6 %, kalenderen leverer 3 % i D1 og 5 % i D2/D4 — inden for tolerance, men under mål. Skal det hæves?
3. **Nedkørsels-finale**: 11-15 % af etaper slutter på en nedkørsel. Der findes ingen regel. Skal der være et loft?
4. **#4174**: hvor højt skal inaktive holds trupper fyldes op? Ubesvaret siden 24/8.
5. **#4189**: må collaborators trigge @claude på ejerens kvote?

## Sådan når du prod

`infisical login` er allerede kørt på maskinen. Brug:
`infisical run --env=prod --silent -- node scripts/dev/<script>.mjs`

Brug ALDRIG `.env` direkte — det er blokeret af secret-hooken, med rette.
