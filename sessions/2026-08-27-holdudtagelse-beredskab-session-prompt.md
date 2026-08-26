# Session-prompt: Sæsonstart-beredskab — holdudtagelse mod den nye S3-kalender

> Skrevet onsdag 27/8 kl. 00:15. **Sæsonen starter fredag 28/8 kl. 11.**
>
> Kalenderen blev regenereret i nat: 529 løb, 28/8 → søndag 27/9, scorecard 0 regelbrud.
> Kan startes PARALLELT med regenererings-sessionen — men rør IKKE `seasons`, `races`,
> `race_stage_*` eller feature-flags; den anden session ejer dem (se 🤖 Working agent i `docs/NOW.md`).

## 0 · Læs dette først

**Kør `date` før du skriver en dato nogen steder.**

**Mål mod prod med read-only SELECTs (Supabase-MCP), gæt ikke.** Slå kolonnenavne op i
`database/schema-snapshot.json` først.

**Arbejd i et worktree** (`scripts/new-worktree.ps1`) — hoved-checkoutet må ikke skifte branch.

## 1 · Mål

Holdudtagelsen skal være fejlfri, når 30 hold udtager forfra på den nye kalender.
Ejer-krav 25/8: "Holdudtagelse skal være fejlfri." Det var udtagelses-fejlene
(#4217/#4200/#4201/#4175) der udskød sæsonstarten — de må ikke gentage sig fredag.

## 2 · Tilstand efter nattens regenerering

- Alle 1.101 udtagelser slettet. Backup: `backup_4236_race_entries` m.fl. (5 tabeller).
- 237 form-peak-planer bevaret med `target_race_id = null` — spillerne skal re-targete.
- Ny løbsdags-akse: `game_day` er kontiguert PER PULJE (0 løbsdage over flere datoer, målt).
  GT'er har 2 hviledage der OPTAGER løbsdagen (spænd = etaper + 2) — de 3 GT'er har
  bevidste game_day-huller; det er IKKE en fejl.
- `race_entries.binding_span` beregnes mod den NYE akse — #4236/#4276-koden kørte første
  gang i prod i nat. Ingen entries findes endnu, så første rigtige test er spillernes udtagelser.
- Assistenten udtager 1 t før løb (#4174), men `auto_entry_generator_enabled` er OFF indtil
  ejeren tænder den (regenererings-sessionens sidste skridt — tjek flagget før du antager noget).

## 3 · Opgaver

1. **Kode-gennemgang:** binding_span-beregning + udtagelses-endpoints mod den nye akse.
   Særligt: GT-hviledage (optager løbsdag), overlap-reglen (1 rytter = 1 løb pr. løbsdag)
   og at spændet beregnes fra `race_stage_schedule.game_day`, ikke fra datoer.
2. **Tests:** backend-udtagelses-tests + e2e-udtagelses-flowet. Udtagelse er delt-lib →
   TIER FULL: fuld lokal suite før evt. push (`scripts/verify-local.ps1` + alle 3 playwright-projekter).
3. **Preview-verifikation:** udtag et hold som testbruger mod den nye kalender og dokumentér
   med rigtige screenshots (ejer-krav: kunne teste på preview før live).
4. **Fredag-morgen-tjekliste:** skriv en kort read-only SQL-tjekliste (kl. 9–11) til
   assistent-dækning, overlap pr. løbsdag og binding-sanity — læg den i denne fil eller NOW.md.
5. Fund → issues (søg dubletter først) + fixes via PR fra worktree. **Ingen prod-mutationer.**

## 4 · Må ikke

- Ingen writes mod `seasons`, `races`, `race_stage_*`, `race_entries`, feature-flags.
- Rør ikke #4278 (D4 for bjergrig — ejer-beslutning: tages efter sæsonstart).
- Ingen scope-udvidelse til dashboard/forum/UI-rework.

## 5 · Kendte løse ender (kun hvis tid, ellers lad ligge)

- #4281 — Playwright Smoke kører kun på PR'er; main kan stå rød uopdaget.
- verify-invariants.js har forældede typelister (finance/notification) + 24 hold over
  trupgrænse, 2 over gældsloft, 4 dobbelt-listede ryttere, 132 uforankrede anlæg (#3593).
  Målt i nat; ikke kalender-relateret. Regenererings-sessionen opretter issues i close-out.
