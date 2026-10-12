# 11/10 aften: aftenspidsens rodårsag (GIN-indeks) + endagsløb gemmes som 'gc'

## 1. Aftenspidsen (#6184 → #6490)
- **Symptom:** 10/10 kl. 20:05-20:10 blev alt langsomt i 1-2 min; enkeltkald til `commit_training_date_tick` tog 24-45 s.
- **Rodårsag:** GIN-indekset `idx_training_day_runs_report_riders` (`report->'riders'`, jsonb_path_ops, #5928) fylder ~800 MB mod 14 MB heap. Det bruges kun til "er rytteren nogensinde trænet?". Hver afregning skriver ~1 MB WAL; pending-list-flush midt i et tilfældigt kald + full-page-writes efter checkpoint giver 20-45 s kald og op til 45 MB WAL for ét lille hold.
- **Live-måling 11/10 19:57-20:25:** 903 kald, 900 MB WAL, 3,4 GB indekslæsning, max 45,5 s; spillervendt 0 × 5xx. Lukningen tog 30 min (20:04-20:34) mod mål < 2 min.
- **Lære:** mål WAL pr. kald (`pg_stat_statements.wal_bytes`) og indeks-I/O (`pg_statio_user_indexes`), før man gætter på matview/locks. Et indeks, der er større end sine data og næsten aldrig bruges, er et rødt flag.

## 2. Endagsløb har ingen 'stage'-rækker
- `race_results` for `races.race_type='single'` gemmes som `result_type='gc'` (+ `team`), aldrig `stage`. Fx U23 S4: 3.725 `gc`, 0 `stage`.
- Bed 2x i aften: (a) min egen prod-efterkontrol af #5881 så ud som "ingen U23-resultater"; (b) #6499's løbsdag-tælling talte kun `stage` og ville have givet alle endagsløbs-ryttere for stort fald. Fanget af reviewer + issue-kommentar før merge.
- **Lære:** tæl løbsdage via `race_stage_schedule` eller `stage` + (`gc` på `single`). Skriv det i briefen til enhver lane, der tæller løb.

## 3. Mindre
- `selectInChunks` findes i 4 kopier med forskellig adfærd (#6497); kun én havde retry/paginering → CYCLINGZONE-9A.
- `POST /riders/:id/release` registrerer intet ejerskifte (#6504); frigivne ryttere giver falsk `needs_reconciliation` (CYCLINGZONE-7X).
- Merge-køen hang ikke i aften: den markerer nu lange cron-kadencer som "afventer check-in" og fortsætter.
