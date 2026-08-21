# Taktik-ordrer v1 (race engine v4) — design-spor, ejer-besluttet 21/8

> Barn af [2026-08-20-race-engine-v4-intra-stage-design.md](2026-08-20-race-engine-v4-intra-stage-design.md) (§7 "Taktik-UI/UX", ejer-krav 20/8: spillerne skal kunne påvirke OG føle det; bounded bidrag). Beslutningerne her låser ordre-modellen som F3-mekanikkerne (M5/M6/M12/M14) bygger imod. Refs #4030 #3855.

## Ejer-beslutninger (designsession 21/8, mockups set)

| # | Spørgsmål | Beslutning |
|---|---|---|
| T1 | Placering i Race Hub | **Separat taktik-kort pr. etape UNDER lineup-kortet** (variant B). Lineup forbliver ren udtagelse. Kortet bærer hold-plan-narrativ + udbrud + effort og har plads til F3-ordrer (sprint-tog m.m.). Eget "Save tactics" (sekundær — lineupens gem beholder guld-primæren, én guld pr. view). |
| T2 | Låsning | **Ordrer låses ved etapestart** (kl. 11-slottet). Mid-race-ordrer kommer først med live-reveal (beslutning 19-opfølgning), IKKE i v1. Kortet viser lock-tidspunkt ("Locks Tue 11:00"). |
| T3 | Udbruds-ordre | **Begge halvdele:** hold-stance (Chase it down / Neutral / Let it go) + per-rytter-flag "Try the break". Flaget ØGER sandsynligheden bounded — garanterer aldrig (fog-gate: sandsynligheder vises ikke). |
| T4 | Defaults | **Neutrale:** ingen ordrer = roller fra lineup, effort Normal, udbrud Neutral, ingen break-flag. Passivitet straffes ikke; M14-AI-taktik gælder KUN AI-hold, aldrig autopilot for menneskehold. |

## Ordre-kontrakten (fryses ind i engine v4 `types.ts` — F3 bygger imod denne)

```ts
type TeamOrder = {
  team_id: string
  breakaway_stance: "chase" | "neutral" | "let_go"      // T3, default "neutral"
  riders: Array<{
    rider_id: string
    effort: "protect" | "normal" | "save"                // M12, default "normal"
    try_break: boolean                                    // T3, default false, bounded bidrag
    // F3-udvidelser (additive): leadout_for (M6 sprint-tog), fri rolle-ordrer (M14-paritet)
  }>
}
```

- Adapteren oversætter fraværende ordrer til neutrale defaults (T4) — kernen kræver aldrig ordrer.
- AI-hold (M14) genererer `TeamOrder` gennem PRÆCIS samme type — ingen side-kanaler.
- Persistering: ordrer gemmes pr. (team, race, stage), snapshotes ved lock (T2) og stemples ind i `StageInput.orders`; efter-lock-ændringer afvises af API'et.

## UI-anatomi (variant B, jf. mockup i sessionen)

- T2-kort under lineup: titel "Tactics", data-font lock-meta højre.
- Tre oversigtsfelter øverst: Team plan (afledt tekst, ikke et input i v1) · Breakaway (stance) · Effort (fordeling).
- Rytter-rækker: navn + rolle + effort-segmented (Protect/Normal/Save) + "Try the break"-pill (guld-outline, ikke fill).
- Copy EN-først, kort på fladen; forklaringer bor i help.json (en+da) ved ship.

## Afgrænsning

- Bygges som del af F3-bølgen (UI-delen kan lande sammen med eller lige efter motor-mekanikkerne; flag-gated til v4-flippet).
- Why-rapporten bør efter flip kunne referere ordrer ("sad i udbruddet på din ordre") — føles-det-kravet; hører til F3's M5-leverance.
