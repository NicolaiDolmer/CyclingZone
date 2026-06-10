# Cutover-sweep missede player-facing locale-copy (#1101 → PR #1203)

**Symptom:** Efter #1101-cutoveret (PR #1201, økonomi fra uci_points → base_value) forklarede finance.json-løn-hintet stadig lønnen som "uci_points × 4000" (internt feltnavn lækket til spillere), og help.json beskrev markedsværdi + Udviklings-fanen med den gamle uci-formel/-graf. 8 strenge (EN+DA) var faktuelt forkerte i prod.

**Rod-årsag:** Cutover-sweepet dækkede kode (`src/`, guard-grep, audit-script) og UI-komponenter, men IKKE `frontend/public/locales/`. Locale-JSON rammes ikke af grep efter kode-identifiers, fordi copy omtaler formlen i fritekst ("uci_points × 4000", "5 UCI points × 4,000 CZ$", "UCI-point over tid") — og i18n-keys-checket fanger kun manglende nøgler, ikke forældet indhold.

**Fix:** PR #1203 — omskrevet til den faktiske formel (`market_value = base_value + prize_earnings_bonus`, `salary = 10%` heraf; verificeret mod migration + GAME_INVARIANTS). "UCI points" om løbsscoring/præmier (points × 1.500) bevidst bevaret — det system er uændret.

**Forward-guard:** Ved enhver cutover/omdøbning af spil-mekanik: grep OGSÅ `frontend/public/locales/` (begge sprog) efter både feltnavnet OG fritekst-varianter af den gamle formel/mekanik (tal, "×"-udtryk, feature-beskrivelser). Hjælpetekster beskriver mekanikker i prosa og dukker ikke op i kode-greps.
