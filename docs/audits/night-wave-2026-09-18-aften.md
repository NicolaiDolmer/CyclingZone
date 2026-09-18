# Aftenbølge 18/9 (kl. ca. 19:45 - 01:30): spilleroplevelse + U23-kæden, ejeren til stede til kl. ca. 22:45

Orkestrator: Claude Code (Fable) på DOLMERPC. To `wave.js`-kørsler, 11 spor, 0 frys, 0 stoppede laner. Prompt: `docs/drafts/next-session-prompt-2026-09-18-aften.md`.

## Merget (alt internt; intet spillerne kan se)

| PR | Hvad | Note |
|---|---|---|
| #5393 | Løbsforsinkelser målt til bunds (rapport) | `docs/audits/2026-09-18-3624-loebsforsinkelser.md` |
| #5394 | Mobil-mockups for træningssiden, 3 former på 412 px | ejeren valgte mockup 2 |
| #5395 | U23-bånd-varianter i generator-rapporten | reviewer-fund (balance-tal i offentlig kode) rettet før merge; tal kun i `balance-internals/` |
| #5396 | ÉT delt senior-trup-prædikat i 13 senior-læsere + forward-guard | bit-identisk i prod: 8.025 senior / 517 akademi holdt ude (backfill ikke kørt); deploy verificeret |
| #5399 | Branch-opgørelse + ugentlig stale-branch-rutine + orphan-mappe-rapport i close-out-cleanup | INGEN sletning; listen kræver ejer-go |
| #5401 | `U23_BIRTH_BAND` (variant A) + `drawU23BirthAbilities()` | akademiets bånd og G5 bevist urørt; generatoren (spec A6) er IKKE bygget |
| #5398 | Notify-fasen til udgående kø (`race_notify_outbox`) bag flag `race_notify_outbox_enabled` = OFF | flag OFF = bit-identisk; **flip er ejer-only**; migration via auto-migrate, post-verificeret |
| main | `beta_requests` ud af liveness-whitelisten (tabellen fik rækker, `audit` var rød på alle backend-PR'er) · 112-målingen og kalenderform-rapporten gemt · 3 kort-sider i `docs/audits/2026-09-18-aftenboelge-kort/` | |

Status for #5399/#5401/#5398 i tabellen: se "Nat-merges" nederst (udfyldt ved close-out).

## Venter på ejerens "merge" (spillervendt, skærmbilleder klar)

- **#5397 Træningssiden på mobil** (mockup 2, tabel; eget udvalg af tal; "Gruppér efter type" væk på mobil; D-047-grenen fjernet; desktop uændret). Reviewer GODKENDT, CI grøn. Samlet før/efter: `pr-screens/3643-before-after.png` i PR'en. Småting set af orkestratoren: billedteksten i før/efter-billedet bruger ae/oe/aa, og mock-navnet "M. Soerensen" bør være "Sørensen".
- **#5400 Én besked pr. løb + roligt dashboard** (#5384 + #5389). Reviewer fandt to blokerende fund (etapeløbs-beskeder på tværs af dage kollapsede til én; ny testfil var `.js`), begge rettet i opfølgende commit; CI grøn. Skærmbilleder `pr-screens/5384-*` og `5389-*`.

## Ejer-beslutninger 18/9 aften (alle skrevet på deres issues)

1. **Træningens realisme-regel (låst, #5267):** en løbsdag er én dato i cykelåret · rytteren kører ét løb ELLER træner · et etapeløb binder rytteren til sidste etape, hviledag = hvile · alle divisioner får lige mange løbsdage, dage uden løb er rene træningsdage. **Model C (dato × 5 slots) er afvist.**
2. **Kalenderen (#5267/#5169):** målt ved 112 falder overlap til 26/21/14/14 % (gulve 45/55/40/40). Ejeren: *"Find en vej med begge dele"*, og overlap skal stadig være det almindelige. Runde 2 fandt vejen: naturlig pakning holder alle gulve; R12's re-søgning er synderen; anbefalet K2 (synkroniserede etapeløbs-blokke) + træningsdage i hullerne. **K2 er ikke pakket endnu, kun regnet som loft.** #5169 merges ikke i nuværende form.
3. **B4 (#5264) rettes FØR merge** (bryder regel 3, mangler rene træningsdage, løb-eller-træning hænger på et andet flag). B3 (#5281) merges samme dag som flaget tændes. Rettelsen venter på kalenderformen.
4. **Løbsforsinkelser (#3624):** ja til notify ud af køen bag slukket flag. Flip får eget kort + måling på en stor klynge kl. 12 eller 18.
5. **Lofter og potentiale (#5351):** ejer-retning: lofterne ud af modellen, potentialet styrer farten. Ikke en byggeorder. Aftale-gennemgangen (kun lokalt, `balance-internals/2026-09-18-potentiale-session/det-har-vi-aftalt-om-potentiale.html`) viste at det meste ER aftalt (fart ikke højde 15-16/8, top 28 år 11/7, knaphed i toppen 15/8, grundregler efter 27/9), at 1-99-migrationen blev droppet 13/8 men lovet spillerne tre gange, og at 6 ting reelt mangler en beslutning.
6. **U23-fødselsbåndet (#5376):** variant A. Gælder KUN engangs-genereringen af U23-trupper til AI-hold ved cutover; ryttere fødes fortsat som 16-årige.
7. **Mobil-træning (#3643):** mockup 2 (tabel) · mobil får eget udvalg af tal · "Gruppér efter type" væk på mobil.

## Læringer

- **Orkestratoren spurgte om ting der allerede var besluttet** (top-alder, tophøjde, potentiale-skala) og opfandt en betydning ("potentiale 88 = ender på 88"). Ejeren: *"Kan du ikke finde ud af, hvad det er vi allerede har aftalt?"* Regel: kør en aftale-gennemgang (beslutninger + løfter + prod-tal) FØR første designspørgsmål. Skrevet i memory.
- **To egne skitser brød ejerens realisme** (træning mellem etaper i et etapeløb), den ene EFTER han havde rettet den første. Tjek skitser mod reglen før de vises.
- **Indlejrede widgets forsvinder for ejeren.** Kort sendes som fil (HTML/PNG) i samme tur som spørgsmålet; balancetal i `balance-internals/`.
- **Liveness-whitelisten bider når en ny tabel får sin første række:** `audit` blev rød på alle backend-PR'er. Rettet på main; overvej at lade detektoren selv-hele (advarsel i stedet for fejl ved stale whitelist-entry).
- **Undersøgelsesspor efterlader rapporten utracket** (2 af 3 i aften) og ét nægtede at kommentere på issuet. `wave.js`' investigate-brief siger "intet commit" tre gange og vinder over scopeText. Bør rettes i briefen: rapportfil committes og pushes på sporets branch.
- **`protect-claude-process.sh` gav falsk positiv to gange** i oprydningsfasen (Stop-Process + sti med `.claude`).

- **FEATURE_STATUS.md ramte token-loftet** (fail > 3.000) da nattens nye flag kom til. Rettet strukturelt i generatoren (kortere linktekst), men marginen er 5 tokens: næste nye feature bider igen. Filen auto-loades ikke; overvej at hæve loftet eller droppe Verified-kolonnen.

## Ikke nået / åbent

- #5383 (tekst ud over bokse): venter på ejerens skærmbilleder.
- Dependabot: #5379 (frontend, grøn) merges i en session uden kørende laner + `npm run sync-deps`; #5356 (marketing) har en ægte byggefejl.
- Patch note: ingen i nat, fordi intet spillervendt er merget. Skrives samlet når #5397/#5400 er merget.

## Nat-merges (ejeren sov; kun internt, grøn CI + GODKENDT reviewer, via `scripts/merge-queue.ps1` én ad gangen)

| PR | Merget (dansk tid) | Verificeret |
|---|---|---|
| #5399 | 01:04 | CI (main) grøn |
| #5401 | 01:12 | CI (main) + Deploy verify grønne |
| #5398 | 01:17 | CI (main) + Deploy verify grønne · prod kl. 01:25: `race_notify_outbox` findes, RLS on, 0 policies, 0 rækker, `race_notify_outbox_enabled` = off · `training_tick_per_race_day` og `race_engine_v4` stadig off |

Ingen flag er flippet, intet er slettet, intet spillervendt er merget. Done-flip: #5376. #3624, #5391, #5267, #3643 forbliver åbne (flip + måling / slette-go / kalenderform / "merge").
