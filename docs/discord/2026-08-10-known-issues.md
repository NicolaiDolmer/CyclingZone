# Known issues — udkast til #patch-notes (10/8)

**Status:** klar til at poste. **Ejeren poster selv** — dette er copy-paste-tekst, ikke en besked der må sendes af en agent.

**Kontekst:** ejeren skrev det oprindelige udkast 9/8, men nåede aldrig at sende det. Gennemgået 10/8 mod issue-tilstanden. Fire ændringer ift. originalen:

1. **Fighter-punktet var over-lovet.** Originalen sagde "fixed as of today" (9/8), men kun gc-delen var fikset — typerne gled tilbage igen, fordi klassifikationen var en løkke (type → lofter → type, hver nat). Løkken blev først lukket 10/8 (PR #3588, `98acbd73`), og første synlige effekt er 16/8. Puncheur/rouleur genkendes stadig kun 26 %/16 %.
2. **#3577 tilføjet** (åben): tilbagebetalingen dækkede ikke følgeomkostninger for spillere der tog lån/solgte ryttere for at byde.
3. **Tre manglende, spiller-rapporterede punkter tilføjet:** bjergtræning uden fremgang (#3450), tomt akademi vs. mail (#3576), signing fee 760k-1M (#3550).
4. **Datoen ændret** 7-9 → 7-10.

**To ejer-valg i teksten:** (a) linjen om at skrive til ejeren ved #3577-følgeomkostninger — ret hvis han vil håndtere det anderledes; (b) indrømmelsen af at fighter-fixet blev meldt for tidligt — kan skæres uden at resten falder.

**Før du poster:** tjek at intet er ændret siden 10/8 — særligt om reparationen af de eksisterende unge er blevet kørt (så skal afsnittet "One-time correction" omskrives fra kommende til udført).

---

```
Known issues and fixes (Aug 7-10)

Academy "super riders" (Aug 7-9, resolved): A generator bug created 374
academy prospects with wildly inflated abilities and values. The youth
auction was cancelled, the affected riders were removed, and the 4
managers who signed one were refunded in full. The generator was fixed
on Aug 9. If you took a loan or sold riders to bid on one of these
prospects, those knock-on costs are not covered by the refund yet —
message me and I'll sort it out individually.

Academy showed empty while the mail said a new class had arrived
(Aug 9, resolved for now): The class that the notification referred to
was among the riders removed in the cleanup above. A new class was
seeded the same evening. I'm still fixing the underlying issue so a
mail can never point at riders that no longer exist, and so an empty
academy tells you why it's empty.

Youth prospects starting slightly too weak (known, fix in progress):
The Aug 9 hotfix overcorrected, so current academy classes are born a
bit below the intended level. A full progression rework is designed and
underway. Your prospects' hidden potential is unaffected.

Too many fighters (root cause fixed Aug 10, visible from Aug 16):
Roughly 3 out of 4 player-owned youth riders were labelled fighters
regardless of their real profile, and stage racer (GC) talents could
never come out of an academy at all.

I want to be straight about this one, because I called it fixed on Aug 9
and it wasn't fully. GC talents did start coming through. But the deeper
problem was that a rider's type and his long-term ceilings were being
calculated from each other every night — so a rider's type could drift
back over a few nights no matter what we corrected. That's why your
climbers kept turning into fighters again after each fix.

That loop is now closed. From Aug 16, a new academy rider keeps the
profile he was born with. Two types (puncheur and rouleur) are still
recognised less reliably than the rest, and I'm working on those.

Climbing not improving in training (known, tied to the above): Several
of you reported that mountain training stopped producing progress after
the type change. This is the same root cause — a rider reclassified away
from climbing had his climbing ceiling lowered, so there was nothing
left to grow into. The one-time correction below is what restores it.

One-time correction for existing young riders (being prepared): Some
will change type and some will see their long-term ceiling adjusted, up
or down. No rider loses any current ability, and no market values change.
I'm deliberately not rushing this one — a correction that locks in the
wrong profile is worse than waiting a few days. I'll post before it runs.

Academy signing fees too high (known, not yet fixed): Signing fees of
760k-1M for 2-star prospects are out of line with what those riders are
worth. On the list.

Mid-season prize money (resolved): A scheduling bug delayed mid-season
payouts. Fixed Aug 9; all 191 teams have been paid.
```

---

## Kilder pr. påstand

| Påstand | Kilde | Verificeret |
|---|---|---|
| 374 defekte emner, auktion aflyst, 4 managere refunderet | #3561 (lukket) | ✓ |
| Følgeomkostninger ikke dækket | #3577 (åben) | ✓ |
| Tomt akademi + mail-divergens; nyt kuld samme aften 15:56 UTC | #3576 (åben) | ✓ |
| Ungdomsemner fødes under mål | #3564 spec §11.1 (`checkYouthBand2064.mjs` rapporterer UNDER MÅL) | ✓ |
| 3 ud af 4 spiller-ejede unge var baroudeur (76,7 %) | #3570, dateret snapshot 9/8 | ✓ |
| GC kom aldrig ud af akademiet (0/303) | `gcFunnel3570.mjs` 9/8 | ✓ |
| Løkken lukket 10/8 | PR #3588, merge `98acbd73` | ✓ |
| Puncheur 26 % / rouleur 16 % genfinding | `scorecard3570Phase2.mjs`, n=3.000 seed 2026 | ✓ |
| Ingen rytter mister evne; ingen markedsværdi ændres | Reparations-dry-run 9/8: 0/2.356 gulv-brud, 0 kr. flyttet | ✓ |
| Bjergtræning uden fremgang | #3450 (3 spillere 8/8) — symptom bekræftet, rodårsag er en velbegrundet, ikke bevist kobling | delvist |
| Signing fee 760k-1M | #3550 (åben, 2 rapporter) | ✓ |
| Midtvejspræmier, 191 hold | #3572 (lukket, prod-verificeret 9/8) | ✓ |
