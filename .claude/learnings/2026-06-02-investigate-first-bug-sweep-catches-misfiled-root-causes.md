# 2026-06-02 — Undersøg-først-fase på bug-sweep fanger fejl-diagnosticerede root causes

## TL;DR
Pakke B+C multiagent-session (6 issues): en read-only undersøgelsesfase (5 parallelle agenter mod kode + live-db) FØR nogen kode, fandt at **2 af 6 "bugs" havde forkert diagnose**. Begge ville have ført til skadelige fixes hvis vi havde stolet på issue-teksten:
- **#914** "board giver 0% trods sejre" — den oplyste rod-årsag (tomme `stage_wins`/`gc_wins`) var modbevist mod prod (tallene matcher `race_results` 1:1). En "recount"-fix ville være no-op i bedste fald, dobbelt-tælling i værste.
- **#928** "REVOKE SECURITY DEFINER exposure" — `is_admin()` er load-bearing i 7 RLS-policies; en naiv REVOKE (præcis hvad issue-teksten foreslog) ville bryde RLS og stille degradere alle admins.

Læring: på en bug-sweep hvor issues er filed fra bruger-feedback, er issue-tekstens "verificeret rod-årsag" en **hypotese**, ikke en kendsgerning. En billig read-only verifikationsfase mod live-data + kode betaler sig — den forhindrer at man bygger et selvsikkert, forkert fix.

## Konkret kontekst
6 issues fordelt på 2 pakker (gameplay #914/#915/#913 + security #927/#928/#929). I stedet for at gå direkte til fix kørte jeg en `Workflow` med 5 parallelle undersøgelses-agenter med schema-output (rootCauseConfirmed, alreadyFixed, fixSpec, recommendedScope, needsDecision). Resultat efter fasen:
- **Ægte + fixet:** #915 (exploit bekræftet), #913 (trivielt), #927 (regression bekræftet).
- **Fejl-diagnose → lukket working-as-intended:** #914, #928.
- **Ikke-kode:** #929 (dashboard-toggle).

Hver beslutning der ændrede scope (#914, #928, #915-policy) blev præsenteret for brugeren før kode.

## Hvad der virkede
- **Read-only først, ingen git-mutation under fan-out.** Undgik race i delt worktree + holdt stop-gates intakte (jeg lovede at melde #914-scope + #928-REVOKE tilbage før handling).
- **Live-db-verifikation, ikke kun kodelæsning.** #914 så korrekt ud i koden *og* skulle bekræftes mod data — det var data-cross-check (Visma 11/3 osv.) der endeligt modbeviste diagnosen.
- **Adversarisk verify på exploit-fixet (#915).** En skeptisk agent greppede ALLE writers af `negotiation_status='pending'` + `current_goals` og bekræftede at `renew → sign` ikke var en omvej uden om guarden. Den fandt også at min progress-baserede guard lukkede et gap som investigatorens oprindelige `season_id`-forslag havde efterladt åbent i sæson 2+.

## #915-bonus-fund: "exploit" var en shippet UI-feature
"Forny plan"-knappen vises i dag KUN for ikke-udløbne (aktive) planer (`BoardPage.jsx:1238`). Mid-season-genforhandling var altså intenderet-udseende adfærd, ikke en ren bug → krævede en design-beslutning (brugeren valgte: samme lås som board-requests, ≥50% progress / sidste 5 race-days), ikke et gæt.

## Forward-guard (relateret regression i samme session)
#927 var en **regression**: `search_path` blev sat i phase-a (#525), men et senere `CREATE OR REPLACE` nulstillede per-funktion-config. Fix = ny ALTER-migration + `SET search_path` bagt ind i de 3 kilde-migrationer, så et re-run ikke regrederer igen. Mønster: når en hærdning kan vaskes væk af en senere `CREATE OR REPLACE`, hør guarden hjemme i selve kilden, ikke kun i en separat ALTER.

## Næste gang
- På bug-sweeps fra bruger-feedback: kør altid en kort undersøg-først-fase og behandl issue-tekstens root cause som hypotese.
- Verificér data-påstande mod live-db, ikke kun kode.
- Adversarisk verify af security/exploit-fixes inkluderer en grep efter ALLE skrive-veje til den beskyttede tilstand — ikke kun det ene endpoint issue'et nævner.
