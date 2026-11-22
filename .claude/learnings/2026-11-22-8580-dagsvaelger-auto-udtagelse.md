# 2026-11-22 · #8580 dagsvælgeren sagde "Træning" på løbsdage

**Symptom:** Efter tænding (17:39 UTC) viste dagsvælgeren i I dag R5 "Træning" på alle 8 dage for Turbo Tester. Holdet kørte løb i dag med 12 ryttere, og divisionen havde etaper hver dag. Ejeren slukkede kontakten kl. 18.46 (dansk tid).

**Rodårsag:** `weekDateRaces` talte kun holdets ryttere fra bindingerne (`race_entry_days`). Mange menneske-hold udtager ikke selv. For dem fylder `raceRunner` truppen ved løbsstart (`race_entries.is_auto_filled`) uden en binding, så `ownRiders` blev 0, og datoen stod som træning. Fable-dommens fund 2 ("divisionens løb uden holdets ryttere = træning") byggede på antagelsen, at et hold kun kører løb, det selv er udtaget til. Det er forkert, fordi assistenten fylder hvert hold uden tilmeldinger.

**Hvorfor testene ikke fangede det:** Dommer-scenarierne (UGE-1..7) og testene havde ingen sag for et hold uden manuel udtagelse. Prod-billedet før tænding blev taget på holdets egen konto, men kun til mekanikken (pile, layout), ikke til dag-typen mod de faktiske løb.

**Forebyggelse:**
- Dommer-scenarie UGE-4b (auto-udtagelse) i `docs/audits/7456-program-dommer-scenarier.md` med test i backend og frontend.
- `ownRiders` falder tilbage på holdets tilmeldinger (`race_entries`, også auto). Løb uden tilmeldinger, som ikke er slut, er `autoLineup` og vises som "Løb · auto" med en note.
- Prod-verifikation af en dag-visning skal sammenholde hver dags label med løbsplanen (`race_stage_schedule`) og holdets faktiske deltagelse, ikke kun mekanikken.
