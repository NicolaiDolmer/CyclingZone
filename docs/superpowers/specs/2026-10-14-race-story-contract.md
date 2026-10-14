# Løbshistorie-kontrakten (race story) — spor A for etapeside 2.0

> **Refs:** #6570 (etapeside 2.0, ejer design-go 14/10) · #6350 · #6234 · #6469 · #6512
> **Kode:** `backend/lib/raceStory.js` (ren funktion) · tests: `backend/lib/raceStory.test.js`
> **Status:** leveret i spor A. Spor B bygger siden imod denne kontrakt.

## 1. Formål

Etapeside 2.0 skal fortælle løbet med ÆGTE, KORREKT og REALISTISK information
(ejer-krav 14/10). Alt på siden der handler om forløbet, skal komme fra
etapens log (`race_stage_timelines.events`), aldrig fra en syntese eller et
gæt. `buildRaceStory` er den ene indgang: den læser loggen og giver siden

1. **afgørende øjeblikke** (`moments`): km, race-tid, tekst-nøgle og data,
2. **mellemtider pr. kontrolpunkt** (`checkpoints`): toppe, spurter og mål,
   med førerens tid, førergruppen og hullet for enhver gruppe og rytter,
3. **gruppepositioner over tid** (`snapshots` + `replayFrames`) til replay,
   inklusive de sidste 5 km.

Motoren og løbsudfaldet røres ikke. Historien er kun det der vises.

## 2. Hvor kommer tallene fra (motorens egen kodning)

Kun tidslinjer fra `official_times_v2` og nyere bærer præcise steder og tider
(`params.exact_km`, `params.exact_time`, #6199). Historien bruger tre fakta om
motorens log (engine/v4):

- `gap_update` udsendes pr. gruppe **bag** fronten på hvert tjekpunkt, og kun
  når gruppens hul har flyttet sig siden sidste melding. Fronten meldes aldrig
  (hul 0). En gruppe uden ny melding har altså stadig sit sidst meldte hul.
- `exact_time` er gruppens ankomsttid (sekunder siden start) på `exact_km`.
  Førerens tid på et tjekpunkt er derfor `exact_time - gap_seconds` for enhver
  melding på det km (`leader_line`).
- Mellem to tjekpunkter bevæger hver linje sig med konstant tempo (samme
  bevægelsesgrundlag som `exactPlace.ts`). Interpolation er derfor motorens
  egen model.

Gruppernes medlemmer findes ved at afspille loggen: feltet starter i
`peloton-0`; `breakaway_formed`, `peloton_splits`, `breakaway_dropped` og
`finale_attack` (med ryttere) flytter navngivne ryttere; `group_merged` slår
grupper sammen. Ryttere ingen hændelse har nævnt, kører i **resten**
(`includes_rest: true`, følger `peloton-0` gennem sammenlægninger), så
historien virker uden startliste. Et uheldsoffer kører i en `solo-m10-*`-gruppe
som uheldet ikke navngiver; rytteren knyttes til den første ukendte
`solo-m10-*`-gruppe loggen nævner efter uheldet (`members_inferred: true`).

**Verificeret mod motoren** (testen kører de frosne proxy-etaper på den aktuelle
revision): alle ryttere har samme sluttid i historien som i motorens resultat
(inden for 1 s), og hullet pr. rytter på hvert tjekpunkt matcher motorens egne
gruppe-snapshots for praktisk talt alle rytter-tjekpunkter (få afvigelser når
en gruppe bærer et lidt forældet hul).

## 3. API

To veje, samme output:

- **Server:** `GET /api/races/:raceId/timeline?stage=N&story=1` giver det
  sædvanlige svar plus `story`. Uden `story=1` er svaret uændret.
- **Klient:** `buildRaceStory` er ren og kan importeres direkte i frontend (som
  `raceParticipationHistory.ts` allerede gøres), fx når siden også vil give
  `results` med.

```js
import { buildRaceStory, checkpointGapForRider, replayFrames, leaderTimeAt } from "backend/lib/raceStory.js";

const story = buildRaceStory({
  events,            // race_stage_timelines.events
  timelineVersion,   // race_stage_timelines.timeline_version
  results,           // valgfri: [{ rider_id, rank }] fra race_results (etapen)
  startlist,         // valgfri: rider_id-liste (bruges af udbruds-projektionen)
});
```

### 3.1 `story`

| Felt | Type | Betydning |
|---|---|---|
| `version` | `1` | Kontraktversion. |
| `timeline_version` | number\|null | Som gemt. |
| `distance_km` | number\|null | Fra `stage_start`, ellers mål-km. |
| `field_count` | number\|null | Startfeltets størrelse. |
| `precise_times` | boolean | `true` når loggen har `exact_time` (official_times_v2+). Ved `false` findes kun km (og ærlige km-spænd), ingen tider. |
| `time_trial` | boolean | Enkeltstart/holdtidskørsel: ingen grupper. Mellem- og sluttider står i `race_results`, ikke her. |
| `leader_line` | `[{km, time}]` | Førerens tid pr. kendt km. |
| `moments` | `Moment[]` | Se 3.2. km-sorteret. |
| `checkpoints` | `Checkpoint[]` | Se 3.3. |
| `snapshots` | `Snapshot[]` | Se 3.4. |
| `breakaway` | `{morning_rider_ids, outcomes}`\|null | Dagens udbryderes udfald (`caught`/`dropped`/`survived`/null), samme projektion som mærkerne og de gemte flag (`raceParticipationHistory.ts`). Med `results` afgøres de mod målresultatet. |

### 3.2 `Moment`

```ts
{
  type: string,            // motorens event-type, eller "gap_change" (afledt, #6469)
  key: string,             // tekst-nøgle, "story.<...>" (se 3.5)
  km: number,              // hændelsens sande km (exact_km), eller spændets start
  km_span?: {from, to},    // kun når loggen ikke kender det præcise sted
  recorded_km?: number,    // motorens tjekpunkt-km, når km er flyttet
  race_time_s: number|null,// sekunder siden start; null når loggen ikke kender den
  time_source: "event" | "leader_line" | null,
  importance: "key" | "detail",
  data: object,            // eventets params (fog-gate-renset), eller gap_change-data
}
```

- `race_time_s` er eventets egen `exact_time` (`time_source: "event"`). Har
  eventet ingen (fx en top eller spurt), er det førerens tid på stedet
  (`"leader_line"`). Et km-spænd får aldrig en opdigtet tid.
- `importance: "key"` er de linjer der bærer løbet (dannelse, indhentning,
  holder hjem, angreb, splits fra fronten/feltet, uheld med tidstab, store
  toppe, afgørelse, mål, uforklarede huller mellem front og første jagt).
  `"detail"` er resten. Siden vælger selv hvor mange den viser.
- Bogføring i motoren vises aldrig: `gap_update`, `gc_context`,
  `ttt_team_result`, finalens placerings-sammenlægninger (`finale-*`) og
  `finale_attack` uden ryttere (`stage_decided`/`placement_gap`/`gap_survived`).

### 3.3 `Checkpoint`

```ts
{
  kind: "climb" | "sprint" | "finish",
  km: number, name: string|null, category: string|null,
  top: [{ rider_id, points, bonus_seconds? }],   // passagens point, som i loggen
  leader_time_s: number|null,
  leader_group_id: string|null, leader_rider_ids: string[],
  groups: GroupAt[],          // som i Snapshot, med time_s på kontrolpunktet
  groups_from_km: number|null,// snapshot-km grupperne er taget fra
  interpolated: boolean,      // true når kontrolpunktet ikke selv er et tjekpunkt
}
```

`checkpointGapForRider(checkpoint, riderId)` giver
`{ group_id, gap_s, time_s, in_front, via_rest } | null` (null: udgået, eller
gruppen er ukendt).

### 3.4 `Snapshot` og replay

```ts
Snapshot = { km, leader_time_s, groups: GroupAt[] }
GroupAt  = {
  group_id, rider_ids,         // eksplicitte medlemmer (sorteret)
  size: number|null,           // inkl. resten for rest-gruppen
  includes_rest: boolean, members_inferred: boolean,
  gap_s, time_s,
  gap_source: "reported" | "carried" | "front",
}
```

`gap_source`: `reported` = meldt på netop dette km; `carried` = sidst meldte
hul (motoren melder kun ændringer); `front` = gruppen kører forrest.

`replayFrames(story, { finaleKm = 5, stepKm = 1 })` giver
`[{ km, leader_time_s, groups: [{group_id, size, includes_rest, gap_s, km_behind}] }]`
på hvert tjekpunkt og pr. km over de sidste 5 km. Mellem tjekpunkter
interpoleres hullet lineært; `km_behind` er hullet omregnet med førerens fart
på stedet. En gruppe der opstår inde i et interval vises fra det tjekpunkt
loggen kender den.

### 3.5 Tekst-nøgler

`story.<event_type>` for motorens egne typer, med disse undtagelser:

| Nøgle | Hvornår |
|---|---|
| `story.breakaway_caught` | Dagens udbrydere ender i en gruppe med ryttere uden for udbruddet. |
| `story.breakaway_regrouped` | Et afsat stykke af udbruddet (kun udbrydere) lukker hullet: en samling, ikke en indhentning (#6234). |
| `story.group_caught` | To grupper uden udbrydere mødes (motoren kalder det `breakaway_caught`). Aldrig "udbruddet er hentet" (#6234). |
| `story.split` | `peloton_splits`. |
| `story.groups_joined` | `group_merged` på vejen. |
| `story.gap_grew` / `story.gap_shrank` | Afledt (#6469), se 4. |

Copy (EN først, DA under) skrives i spor B efter `docs/TONE_OF_VOICE.md`.

## 4. Forklarede huller (#6469)

Flytter en gruppes hul sig mere end en visningstærskel (konstant i
`raceStory.js`) mellem to meldinger, og har loggen ingen hændelse i det vindue
der rører gruppen eller fronten (split, angreb, indhentning, sammenlægning,
afsat, uheld), får historien en linje `gap_change`:

```ts
data: {
  group_id, group_size, includes_rest,
  gap_before_s, gap_after_s, delta_s,   // delta > 0: hullet voksede
  front_group_ids: string[],
  terrain: [{ type: "kom_passage"|"intermediate_sprint", km, name, category }],
}
```

med `km_span` = de to meldingers km. Linjen siger kun hvad loggen viser (hvor,
hvor meget, hvilket terræn). Hvem der satte tempoet, står ikke i loggen og
opfindes ikke.

## 5. Endagsløb (#6512)

Endagsløb gemmer en tidslinje som etape 1 (verificeret i prod: alle endagsløb
siden event-loggen har en række). Historien virker uændret for dem. Det der
mangler i dag, er at resultatvisningen for endagsløb ikke viser løbsfilmen
(`RaceDetailPage.jsx` henter `oneDayTimeline`, men renderer kun recap'en). Det
hører til siden (spor B).

## 6. Hvad historien ikke kan

- Etaper før `official_times_v2` har ingen tider i loggen: `precise_times:
  false`, kun km og ærlige km-spænd (samme som filmen i dag).
- Enkeltstart/holdtidskørsel: ingen gruppehistorie; brug resultatet.
- Et hul mellem to tjekpunkter er motorens lineære bevægelse. Finere opløsning
  kræver at motoren logger tættere (ikke en del af denne kontrakt).
