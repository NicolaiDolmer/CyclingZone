# Startprompt: Claude Code, 19/10 eftermiddag (DolmerPC)

Kør `git pull --ff-only` i `C:\Dev\CyclingZone`, læs `docs/NOW.md` og denne fil. Svar på dansk. **Fokus (ejer 19/10): merges + nye ruter (løbsidentitet #6857) + Udvikling 2.0 (#6499).** Codex bygger; Claude reviewer, merger og planlægger, token-effektivt. **Højst 4 Codex-sessioner på DolmerPC** (maskinen bliver varm). Merges: spørg ejeren ÉN ad gangen med link + "hvad gør den" + status (ejer 19/10); kun ordret "merge" er go.

## Merget og verificeret 19/10 (10)
#6878 #6879 #6880 #6891 #6892 #6893 #6894 #6895 #6896 #6897. #6504 done (del A+B, migrationer post-verificeret). Known issues: 7 rettede → fixed. Push: VAPID sat (Infisical prod + Railway), `push_enabled = beta`, ejerens Android abonnerer. MASTERPLAN + artifact ny rækkefølge. Discord-udkast 7.363-7.368 i `docs/drafts/discord-patch-7363-7368-2026-10-19.md` (ejeren poster). Issues: 0 blocked, 18 triageret.

## Åbne PR'er og næste skridt (i merge-rækkefølge)
1. **#6906** gældsmålet viser 0 (spillerrapport, #6903): venter Codex-review + markør. Kort, klar.
2. **#6902** eget flag `race_form_peaks` (off): Codex-markør skal sættes igen på HEAD (to commits efter `2e96386`). Roadmap-tekst ejer-godkendt.
3. **#6839** "Kør nu" viser "Kører…" (ejer-valg A): Codex-P2 (polling) + ES/FR rettet; venter nyt Codex-review + markør.
4. **#6900** vagt før sæsonskiftet (#6898): **P1 fra Claude-review** — S4 `end_date` er null i prod, så gaten ville blokere skiftet. Codex retter (afled sidste træningsdato fra kalenderen). Review igen før merge.
5. **#6899** rangliste M1 (#6765): Codex tilføjer kill-switch `ranking_shadow_enabled` (off), overvågning (kø/tid), paritet uden for 19-22, måling på Supabase-branch. Merge slukket før 23/10; tænd efter S5; M2 (læserskift = farten) efter 7 dages ren paritet. Plan: expand → migrate → contract.
6. **Tænd motor v2 for nye løb** efter #6902: #6819 (v2 lovlig) → #6820 (v2 aktuel). Hvert trin ejer-go. Formtoppe tændes FØRST ved skiftet 25/10 (`race_form_peaks` on, ejer-go). Tænd-kort: `pr-screens/6818/card.png`; tal privat i `balance-internals/6156/6818-2026-10-19/`.

## Nyt arbejde (fokus)
- **Nye ruter = løbsidentitet #6857:** prøvekørsel lovet ejeren **onsdag 21/10**. Teknisk design klar (`docs/superpowers/specs/2026-10-18-6857-loebsidentitet-teknisk-design.md`). Start en Codex-session til byg + dry-run i dag; Claude reviewer og laver det visuelle kort til ejeren.
- **Udvikling 2.0 #6499:** prøvekørsel mod prod til ejeren **23/10**, tænding kun på ordret go (effekt 25/10). Forbered dry-run-script/kort 21-22/10.
- **Visuelle forslag (ejer bad om dem):** #6904 menuen (fjern vandret scrollbar + overskrift "Account & help" over faste links) og #6905 omdømme-boksen (ejer hælder til at fjerne; vis "fjern" vs "gør meningsfuld" side om side).

## Tjek i morgen tidlig
- CYCLINGZONE-9B: 0 nye falske afstemnings-alarmer efter aftenens afregning (#6504/#6894).
- Første frigivelse giver én `rider_ownership_events`-række med `to_team_id = null` (#6891).
- Natlig Playwright Smoke grøn → luk #5792.
- Push: kom ejerens første push? (#6590).

## Efter S5 (26/10+)
- Mandat-oprydning: tjek 0 aktive S3-mandater efter skiftet (#6773, ejer 19/10: skiftet rydder op).
- Én fast test-Postgres = prod 17.6 (#6901). Vægur-rester #6866/#6868. Hurtigere CI #6864 (baseline-sample på issuet).
- 96 "delvist leveret"-issues fra done-auditten (#6890) gennemgås i portioner; 26 i tvivl tages i beslutningsblokken.

## Patch notes
Næste note (efter merge): gældsmålet (#6906), "Kør nu" (#6839, også rettelsen #6822 på den rigtige sti). Beskyt/Spar (#6652) holdes ude (ejer 19/10). Discord: ejeren poster 7.363-7.368, derefter 7.369+.
