# Natbølge 2026-09-02 (pengeplan-natten)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 19:50 → 23:21 (3 t 31 min) |
| Agenter launched / fuldført / døde | 10 workers + 4 fix-up/recovery-agenter / 13 fuldført / 1 stoppet (hang på `cd`, sporet reddet af recovery-agent) |
| PR'er åbnet / merged | 10 åbnet (#4652 #4653 #4654 #4655 #4656 #4657 #4659 #4661 #4662 #4663) + #4608 rebaset / 3 merged (#4652 #4653 #4655) |
| Issues → claude:done | #4644, #4648, #2816 |
| gh-401-retries (preflight-probe + bølge) | 0 observeret (OAuth-token-advarsel i preflight, ingen fejl) |
| Recoveries (type) | 0 (to tunge workers pushede først efter 55-65 min, men leverede; ingen stall) |
| Preflight | GO kl. 18:40 (.codex.local/night-wave-preflight.json) |

## Spor og resultat

| Spor | PR | Tilstand | Note |
|---|---|---|---|
| Pro backend (#4648 #4646 #2816 #4555 #4645) | #4655 | **merged 21:30** | webhook nested-felter + reconcile-for-team + 24 t respit; checkout_started/completed; 409 already_subscribed; periode-rul-vagt; check-pro-prices |
| Crons (#4644) | #4653 | **merged 21:17** | boot-run growth snapshot + global-rank-uge; forward-guard-test. Growth snapshot verificeret kl. 21:31 |
| Win-back consent-audit (#2760) | #4652 | **merged 21:17** | gate = `email_marketing`; fund: retention-loopet tjekkede aldrig samtykke |
| Mail v2 (#2853 #4650) | #4654 | draft, ejer-go | Dolmer-stemme, hybrid-layout, digest kun til fraværende + samtykke-gate (fix-up 21:00). 4 renderede HTML-filer i PR |
| Årsmøde backend (S-M2c a+b) | #4656 | draft, ejer-GO (migration) | tørkørsel 21:20: 237 hold, 0 fejl i måltal, 13 uden bestyrelsesmedlemmer, **S4 findes ikke i `seasons`** |
| Design-kit (#4625) | #4657 | draft, ejer-go | EmptyState/FilterBar/Tabs/DataTable + Dashboard/Indbakke; dev-throws blødgjort til console.error (fix-up 22:20) |
| Pro-fordele (#4649) | #4662 | draft, ejer-go | Founder-mærke, evnehistorik, gemte filtre, ønskeliste-loft; 2 migrationer (apply efter merge); 3 ejer-spørgsmål i PR |
| Årsmøde frontend (S-M2c c) | #4661 | draft, ejer-go | /board/meeting per mockup, 4/4 spec-tests, 8 screenshots |
| Tilmeld-knap + parkering (#4592 #452) | #4663 | draft, ejer-go | første worker hang 40 min på et `cd X &&`-Bash-kald; workflow stoppet, recovery-agent i SAMME worktree fandt og rettede en fejlplaceret parkerings-kald (kun i else-grenen), leverede API + Dashboard-kort + 2 migrationer (ikke applied) + dry-run-script; kortet kræver ejer-sign-off (fold-reglen) |
| SEO fase 1 (#4067) | #4659 | draft, ejer-go | 50 filer: how-it-works, PCM-sammenligning, /da/ + hreflang, sitemap/robots, cookie-consent; build + lint grøn; Vercel-opsætning beskrevet i PR |
| #4608 EUR-checkout | #4608 | rebaset 22:00, MERGEABLE | holdes til nøgleblokken (#4616); patch note renummereres til 7.238 ved merge (7.237 brugt i nat) |

## Afvigelser/læringer

- Branch-reglerne kræver review; auto-merge landede aldrig. Orkestratoren merger grønne PR'er med `gh pr merge --squash --admin` EFTER alle checks er grønne. Skal ind i runbooken.
- To tunge workers holdt ikke 30-min-push-kadencen (første push efter 55-65 min) men leverede. Workflow-agenter kan ikke nudges via SendMessage; kadencen skal ligge i prompten OG i worker-status-tjek.
- Workers må ikke spawne chips til ejeren (én gjorde det, ejeren startede den). Skriv forbuddet eksplicit i COMMON-preamblen.
- `scripts/probe-railway-keys.ps1` fejler ved 0 træf (#4651); `guard-commit-branch.sh` tjekker kun cwd (#4658).
- Dev-only throws i delte primitiver bryder andre spors dev-servere; blødgør til console.error indtil migrationen er gjort.
- To nye Founders købte i aften uden at nogen rørte noget: MRR 113,87 → 188,40 kr, 3 → 5 abonnementer. Reconcile-lag var 22-55 min før #4655; nu sekunder.
