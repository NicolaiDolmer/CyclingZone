# Værdiskiftet: forum-opslag (EN) + plan 22/9

> Roadbook-teksten står i `2026-09-20-vaerdiskifte-udmelding-og-patch-note.md` (afsnit 1) og bruges uændret i #the-roadbook. Forum-versionen herunder er kortere og linker til Discord. Ejeren poster selv.

## Forum (kategori: announcements/feedback), EN

**Title:** Rider values get a proper fix this week

> Several of you showed me riders who improve week after week while their value stands still. You were right. The value and the rating on the rider card were built from different abilities, and some riders were still priced as the type they had in August.
>
> I have rebuilt it. From this week a rider's value is built from the same abilities as his rating, every rider is priced as the type he is today, and all riders are corrected in one go. Wages do not change in this update.
>
> Values move both ways. More riders go up than down. The ones who fall the most are specialists whose whole price rested on one ability. That is the price catching up with the rating you could already see, not a punishment.
>
> This runs once, outside the normal Sunday update, so you have time to look at your squad before the season change. I post in Discord the evening before it happens, and I check every team's before-and-after myself before I press the button.
>
> If a rider looks wrong afterwards, reply here. That is how we found this one.

## Plan (ejer-krav 22/9: forhåndsvisning i admin FØR kørslen; gamle admin-flader væk)

1. Ejeren poster roadbook-teksten i #the-roadbook + forum-opslaget nu.
2. Codex bygger (én PR, Refs #5443): tabel `value_transition_preview_5443` (rider_id, hold, type, gammel/ny værdi, diff, computed_at) · `valuationV5DryRun5443.mjs` upserter til tabellen · `GET /api/admin/value-transition-5443` (requireOwner) · T2-side `admin/value-transition-5443` med sortering/filter pr. hold og type, samlet før/efter pr. hold · fjerner den gamle `AdminValueTransitionPage.jsx` (+ shape, test), endpoints `/admin/market-value-level-correction/gate` og `/dry-run` (v3→v4-dæmpningen blev flippet 23/8, ingen fremtidig brug). Skærmbilleder 1440 + 390 i PR'en. Ejeren siger "merge".
3. Tørkørsel skriver til tabellen; ejeren gennemgår i admin; "aftenen før"-besked i Discord.
4. Næste dag (ikke søndag): flip `rider_valuation_model` → v5, tørkørsel igen, ejerens ordrette "kør", `-Apply`, post-verify (SQL: antal op/ned, samlet holdværdi, 0 lønændringer).
5. #5461 (patch note v7.294 + hjælpetekst) rebases og tone-rettes af Codex i dag, merges samme dag som kørslen med korrekt dato.
