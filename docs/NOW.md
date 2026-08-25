# NOW — Aktuel arbejdsstatus

> **Kompas:** [Living World Doctrine](superpowers/specs/2026-06-08-living-world-product-doctrine-design.md) · **Rækkefølge-SSOT:** [MASTERPLAN.md](MASTERPLAN.md) · **Kalender-SSOT:** [CALENDAR_RULES.md](CALENDAR_RULES.md) · Hard rules 24-28 i AGENTS.md.

## Aktiv styring

> **🎯 Next action:** **Tænd motoren fredag 28/8** — `stage_scheduler_enabled` står på `off` og er ejer-only. Sæson 3 er aktiv, kalenderen skrevet (531 løb, 31 løbsdage 28/8-27/9), spænd-bindingen live. Derefter: **#4220** enkeltstarter (kræver research + ejer-godkendte tal), **#4206** 965 ryttere med identiske stats, **#4174** hvor højt inaktive trupper fyldes op.

> **🤖 Ingen aktiv session.**

> **🚨 HÆNDELSE 25/8 — fire timer uden aktiv sæson ([#4229](https://github.com/NicolaiDolmer/CyclingZone/issues/4229)):** kalender-regenereringen kræver `status='upcoming'`, sæson 3 blev sat tilbage kl. ~07:30 og aldrig sat til `active` igen. Alder, rangliste, daglig træning og akademi-flytning lå nede for ALLE spillere. Tre spillere meldte det inden for halvanden time; nattevagten ville have rapporteret grønt, fordi alle fire kalender-invarianter svarer *"ingen aktiv sæson at kontrollere"*. **Genoprettet kl. 11:49** (ejer-go): standings bootstrappet 0→362, status→active. `processSeasonStart` blev bevidst IKKE kørt igen — den har ingen idempotens-spærre og var allerede kørt 23/8. Postmortem: `.claude/learnings/2026-08-25-interregnum-ingen-aktiv-saeson.md`.

> **⚠️ Prod-tilstand 25/8:** sæson 3 **aktiv**, start_date 28/8, 0 løbsdage kørt. `stage_scheduler_enabled` + `auto_entry_generator_enabled` = **off**. Spænd-binding kørt: 7 auto-udtagelser ryddet (0 manuelle), 20 dag-rækker backfillet, **0 dobbeltbookinger**. Backup: `backup_4227_seasons_2026_08_25`.

## Standing context (forever-relaunch)

- **Liga:** 4-divisions-pyramide 1/2/4/8; S3: D1 = top 24 rigtige hold. **Styrke straffes ALDRIG; balance = struktur** (ejer 4/8).
- **S3:** 28/8 (fre) → 27/9 (søn), **31 løbsdage**, løb hver kalenderdag i alle divisioner. Alle udtagelser ryddet — alle udtager forfra. Overlap intended; 1 rytter = 1 løb pr. **løbsdag**, og et etapeløb binder **hele spændet**.
- **Sikkerhed:** kun [#691](https://github.com/NicolaiDolmer/CyclingZone/issues/691) åben. **Spiller-kommunikation:** MAN uge-note · ONS ét spørgsmål · SØN ugens øjeblik ([#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428)).
- **Collab-gate:** `main` kræver ejer-review — men **kun for andres arbejde**. Ejerens egne PR'er merges uden (ejer 25/8). Script klar: `bash scripts/setup-main-ruleset.sh` (opretter to rulesets + slet klassisk protection manuelt, jf. #4241).

> **📮 Klar til at poste:** `docs/discord/2026-08-25-udkast-saesonstart-udskudt.md` — rettet, ejeren poster selv.

> **⏳ Venter på ejeren:** #4220 enkeltstarter (tal) · brosten 6 %-målet · nedkørsels-finale-loft · #4174 opfyldnings-niveau · #4189 collaborators og `@claude` · #4231 om flere i18n-namespaces må koste et loader-blink.

_Historik i git-log, issue-tråde + docs/audits/._
