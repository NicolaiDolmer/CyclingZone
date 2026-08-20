# KVALITETSSESSION 2 — 18/8 (masterplan-sporet, frisk session)

Ejer-designet og godkendt 18/8 middag. Kør som formiddagssessionen: arkitekt i hovedtråden,
sonnet-workers i worktrees, beslutninger stilles ENKELTVIST med anbefaling. Jeg er tilgængelig.

LÆS FØRST: docs/NOW.md + docs/MASTERPLAN.md (opdateret 18/8 middag — hold den opdateret ved
close-out; slet færdige punkter). Claim dig i NOW.md. Formiddagens fulde kontekst:
docs/audits/night-wave-2026-08-18-morgenoplaeg.md + git-log 18/8.

## HÅRDE REGLER (bindende, læringer fra i dag)
- DISPATCH-FORFILTER FØR HVER WORKER: gh issue view N --json state + tjek om en merged PR
  allerede dækker scopet (#3682-spildet i dag: masterplanen var stale, issuet lukket for 3 dage
  siden). Masterplan-linjer er kilder, ikke facts.
- Merge-politik: type:bug uden migration og uden spillersynlig UI → ready + auto-merge ved grøn
  CI + done-flip STRAKS. UI merges ALDRIG uden mit visuelle go. Migrationer: SQL vises, apply
  post-merge med post-verify (#2642). Enkeltkommandoer, ikke batch-loops (classifier).
- Efter HVER merge-salve: verificér at NÆSTE production-deploy går READY (Vercel), og at
  warning-budget/feature-liveness-gaterne stadig er grønne på main — begge knækkede i dag.
- Prod-datamutationer: dry-run → tal fremvist → mit eksplicitte go → apply → uafhængig
  post-verify (mønstret fra #3655/#3614 i dag).
- Løbende GitHub-hygiejne: done-flip + LUK verificerede issues med evidens undervejs
  (ejer-mandat 18/8) — aldrig "til sidst".

## PUNKTERNE (i rækkefølge)

1. SIKKERHED FØRST — 2 åbne CodeQL-alerts på main (ejer-krav 18/8, screenshot i chat):
   a) #185 (High): "Use of externally-controlled format string" i
      backend/lib/riderOwnershipAudit.js:96 (ny kode fra PR #3881 i dag).
   b) #184 (High): "Incomplete string escaping or encoding" i
      backend/scripts/dev/repair3570Apply.test.js:473 (en uge gammel).
   Fix begge korrekt (ikke suppress), verificér alerts lukker på main.

2. OPSAMLING FRA FORMIDDAGEN (kort):
   a) PR #3878 (sælger-gulv) + PR #3893 (Race Centre): tjek om rebase-agenternes push er landet
      og auto-merge har lukket dem. Race Centre merged → done-flip #3858 + patch note v7.140 +
      help.json-entry (en+da) + verificér på prod-preview.
   b) #3671 (scout-gulvet): en worker var i gang ved handoff — tjek gh pr list for dens PR
      (branch fix/3671-scout-gulv) eller worktree-rester; færdiggør/merge.
   c) #3684 (pixel-maskering): fix ligger klar i worktree fix-3684-pixel-maskering
      (fixtures.js ændret, snapshot-refresh muligvis kørt færdig som løsreven proces) —
      tjek git status i worktree'et, refresh evt. snapshots (serial e2e-slot!), PR, merge.
   d) TIMELINE-BEVISET: første etape i dag kørte efter kl. ~11. Verificér
      race_stage_timelines har rows (read-only SELECT). Rows → fjern Detector A-suppressionen
      (find den i driftMonitor/feature-liveness-koden) + notér på #2410-sporet. Ingen rows
      trods kørte etaper → NU er det en ægte bug: grav i persist-stien (flag læses, men
      console.warn er eneste fejlkanal — tilføj Sentry-capture uanset).

3. KVALITETS-OFFENSIVEN (ejer-valg: målingen afgør — sessionens hovedret):
   Adversariel gennemgang af kerne-loopet: dashboard → rytterprofil → marked/auktioner →
   træning. Mål hver flade mod docs/design/PAGE_TEMPLATES.md + anti-slop-reglerne (hairline,
   5px radius, tabular figures, stroke-ikoner, én gold-knap, EN/DA-paritet) OG mod barren
   "verdens bedste managerspil" (doktrin: docs/superpowers/specs/2026-06-08-living-world-*).
   Leverance: rangeret defektliste med screenshots (Playwright headless, IKKE Browser-panen)
   → ejeren dømmer top-punkterne ENKELTVIST → ship de godkendte samme dag (UI = draft +
   screenshots + visuelt go før merge).

4. #3592 caps-formningen (B-sporet, sidste åbne kode-punkt før trin 7): fire typepar
   matematisk uadskillelige. classifierWeights er FROSSET (klassificerer nul ryttere) —
   kun caps-formningen. Forfilter: verificér mod koden hvad PR #3739 allerede løste.

5. #3733 SØNDAGS-KVITTERINGEN — design-lås: mockup blev fremvist 18/8 middag (to varianter:
   marked-med-signal + ærlig "No signal"-tom-tilstand med "He is not getting worse as a rider").
   Ejeren mangler at dømme: (a) to-linje-splitten udvikling/marked, (b) "No signal"-formuleringen,
   (c) placering (foreslået: rytterprofilens værdi-sektion + én samlet søndags-notifikation).
   Stil de tre domme, dokumentér det låste design på issuet. BYGGES IKKE før #3729 er besluttet
   (værdi-sporet) — det står på issuet.

6. #3719/#3720 PRÆMIE-MULTIPLIKATOREN (parkeret A/B fra 14/8, forudsætning for værdi-sporet):
   Præsentér målingerne (præmien 3,7-6,6× fra kalibrering; D3 mangler +18 %, D4 +30 %) og
   A/B'en (A: multiplikator pr. division, anbefalet · B: åbn klasse-whitelist, kræver
   regenerering). Ejer-dom → byg A hvis valgt (simulér-før-ship: dry-run-scorecard først).

7. #3066 (priority:high, 12 spillere ramt): auktions-indgangene (fuld trup + minimumsloft),
   call-sites useAuctionBidding.js:181/195, acceptkriterie = player_events-query. Fix + verify.

8. #3661 KVALITETSPROCESSEN → AGENTS.MD: destillér dagens/nattens læringer til ~5 KONKRETE
   regler (forslag: 1. aldrig skip-logik på prod-deploy-grenen, 2. deploy-verify er del af
   merge-handlingen, 3. per-agent-timeout dimensioneres efter samtidighed, 4. dispatch-forfilter
   før hver spawn, 5. post-merge guard-tjek af main). Vis mig reglerne før commit.

9. HYGIEJNE-BLOKKE (fletning mellem punkterne):
   a) Won't-do-bundterne fra docs/audits/night-wave-2026-08-18-housekeeping.md til mine domme
      (15-20 ad gangen, én linjes begrundelse pr. issue).
   b) #3614-rest: ~60 ungdomsryttere i auktion + 2 efterslæb — kør opfølgnings-reparationen
      når deres auktioner er afgjort (samme script, --status=expired, dry-run → go → apply).
   c) Masterplan + NOW ajourføres løbende; NOW/MASTERPLAN er over token-budget — trim dem
      MED mig (#3753-resten, 10 min).

## IKKE I DENNE SESSION (gated andetsteds)
Kalender-pakken #3862 + regenerering (kalender-session) · Trin 7 #3798 + frie-agent-backfill
(ons/tor, ejer-planlagt) · #3393+#2840 løn-design (egen fælles session FØR søndag — book den!) ·
#3449/#3729/#3732/#3756 (værdi-sporets beslutninger) · race-day-flip/cutover-flader (søndag).

## CLOSE-OUT
Session-audit i docs/audits/ · done-flips verificeret · patch note-udkast for dagens merges ·
NOW.md: Working agent nulstilles, 🎯 → løn-design-session + ons/tor trin 7 · masterplan
opdateret (slet færdige!) · token-hygiejne-scriptet kørt.
