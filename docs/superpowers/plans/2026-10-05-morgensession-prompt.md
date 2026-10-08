# Prompt: morgensession man 5/10

Kopiér alt under stregen ind som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`. Anbefalet: Fable 5.1, indsats medium. (Filen hed oprindeligt "roadmap-hub-afslutning"; hubben gik live 4/10 sent, så den er nu morgenens start-prompt.)

---

Morgensession 5/10. Start med morgenblokken (beslutninger ét ad gangen), og planlæg derefter dagen. Byg ikke, før rækkefølgen er aftalt.

**Læs først**
1. `docs/NOW.md` og `docs/MASTERPLAN.md` (Brand + Uge 41)
2. `docs/STATUS_BOARD.md`
3. `.claude/learnings/2026-10-04-roadmap-hub-migration-apply.md`

**Morgenblok: tag disse med mig, ét kort ad gangen**
1. 🔴 Brand: ca. 20 ryttere på 9 spillerhold har ikke trænet i S4 og misser hver aften (#6129, målt 4/10 sent). Vis mig tal og løsning (starttilstand + kompensation), og vent på mit "kør".
2. Ryttertyper (#3813): står roadmap-punktet rigtigt efter delingen (Done 24/9 + "Explain on the profile why a rider can reach higher in an ability outside his two natural roles"), og er hjælpeteksten ("half as high") forkert?
3. Staging-klargøring (#5904) og jobkøen i Postgres (#6134, C-design; nyt fund: sæsonskiftet opdaterer en rangliste uden om den fælles vej). Codex venter på begge. #6153 (ranglisternes Node-del) må først merges efter staging-prøven.
4. Trin 0 for løbsmotor-pakken ligger på #6157: hvilke fund bliver til byg (Spar kræfter med 3+ hjælpere, udbrydere mærket "ikke indhentet", ordre-kolonnen før etape 1, hjælpetekster)?

**Planlæg derefter**
- **GitHub-audit (ejer 4/10: skal planlægges i morgensessionen):** brug skillen `github-housekeeping`. Aftal omfang og tidspunkt med mig først. Kendt rod fra 4/10: issues markeret `claude:done` men åbne (#6115, #6149, #6150, #6151, #6152, #6154, #6168, #5387, #5388, #5845), ca. 20 forældreløse worktrees og mange "stale" lokale branches (session-start-hooken lister dem).
- Planlægningssessionen til 1/1-2027 (#6148), inkl. tidspunktet for søndagens værdikørsel (kørte kl. 06:45 den 4/10).
- Uge 41-opfølgninger fra roadmap-sessionen: #6174 (sikkerhed: to skrivende funktioner bag backend), #6175 (roadmap-opfølgning), #6172 (merge-kø og auto-migrate), #6165 (ny bundle-model), #6164 (oprydning af gamle tilbud + inaktive managers), #6171.
- Go-kort #6053 (vælg rytter først): to CodeRabbit-fund + sync mangler; den står som "Coming to beta" på roadmappet.

**Status på roadmap-hubben (live 4/10)**
Alle fem faner er live med indhold og post-verificeret. Ikke verificeret: indlogget stemmeafgivning og "Affects me too" på et rigtigt hold. Roadbook-opslaget til Discord er skrevet som udkast i sessionen 4/10; jeg poster det selv.

**Sådan arbejder du**
Orkestrator: workers bygger, du verificerer mod prod og diffen. Én merge-kø. Merge kun på mit ordrette "merge". Prod-skrivninger: prøvekør i en transaktion, vis tal, vent på "kør"; afviser auto mode skrivningen, så giv mig kommandoen, og gå ikke uden om.
