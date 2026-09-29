# Stall-watchdog: falsk præmie-alarm for ungdomsløb (29/9)

**Symptom:** Sentry CYCLINGZONE-2G "Stall-watchdog: prize stall (10)" regresserede efter S4 løbsdag 1 (28/9) og fyrede igen 29/9 kl. 02:05. Railway: "🚨 Stall-watchdog: 10 ny(e) tavs(e) stall(s)".

**Rod-årsag:** De 10 løb var alle U23-løb ("Klassieker van de Westhoek Beloften"). Ungdomsløb har bevidst ingen præmiepenge (YOUTH_RULES §7), så `race_results.prize_money` er 0 på alle rækker. Præmiemotoren (`getSeasonPrizePreview`) springer løb uden præmie-rækker over med warningen `no_prize_results` og sætter derfor aldrig `prize_paid_at`. Vagthunden så "completed + prize_paid_at NULL" og alarmerede, og ville gøre det hver dag for hvert nyt ungdomsløb.

**Fix:** `fetchWatchdogState` henter nu også `prize_money` og fjerner prize-kandidater der har resultater men ingen præmie-række. Løb helt uden resultater alarmerer stadig (ægte anomali). Ingen ændring i pengestien.

**Lære:** Når en ny løbsklasse indføres (ungdom), skal alle vagthunde der antager "completed løb har præmie" tjekkes. Nye kategorier bryder implicitte invarianter i overvågning, ikke kun i spillogik.

Refs #5893
