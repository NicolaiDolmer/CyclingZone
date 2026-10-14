# Løbshistorie-kontrakten (race story) — spor A for etapeside 2.0

> **Refs:** #6570 (etapeside 2.0, ejer design-go 14/10) · #6350 · #6234 · #6469 · #6512
> **SSOT:** [`docs/RACE_ENGINE_RULES.md`](../../RACE_ENGINE_RULES.md), afsnittet "Løbshistorien" (race-motor, ruter og taktik). Reglerne står dér; denne kontrakt beskriver felterne. Ved uenighed vinder SSOT'en.
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
`finale_attack` (med ryttere i `rider_ids` eller `rider_id`, som et rigtigt
sent angreb fra `lateAttack.ts`) flytter navngivne ryttere; `group_merged` slår
grupper sammen. Ryttere ingen hændelse har nævnt, kører i **resten**
(`includes_rest: true`, følger `peloton-0` gennem sammenlægninger), så
historien virker uden startliste. Et uheldsoffer kører i en `solo-m10-*`-gruppe
som uheldet ikke navngiver; rytteren udledes af gruppe-id'ets segment og seq
med motorens egen navngivning (`incidents.ts`: segmentets uheld i rider_id-
orden, udgåelser tæller med), aldrig af rækkefølgen grupperne nævnes i
(`members_inferred: true`). Et uheld fra en anden mekanik (`cause`) får ingen
`solo-m10-*`-gruppe.
Indtil da står rytteren i `pending_rider_ids` og er ikke i resten (hullet er
ukendt). En udgået rytter (`incident` med `outcome: "abandoned"`, eller
`outside_time_limit`) er fra det km aldrig i resten, venter ikke på en
solo-gruppe og står i `out_rider_ids`.

**Verificeret mod motoren** (testen kører de frosne proxy-etaper på den aktuelle
revision): alle ryttere har samme sluttid i historien som i motorens resultat
(inden for 1 s), og hullet pr. rytter på hvert tjekpunkt matcher motorens egne
gruppe-snapshots for praktisk talt alle rytter-tjekpunkter (få afvigelser når
en gruppe bærer et lidt forældet hul).

## 3. API

To veje, samme output:

- **Server:** `GET /api/races/:raceId/timeline?stage=N&story=1` giver det
  sædvanlige svar plus `story`. Uden `story=1` er svaret uændret. Serveren
  giver etapens målresultat og startliste med (`storyInputsFromResults` over
  `race_results`: etapens `stage`-rækker, for et endagsløb uden dem
  `gc`-rækkerne, samme valg som mærkerne på etapesiden), så `story.breakaway`
  er afgjort som mærkerne. Fejler opslaget, udelades `story` (tidslinjen
  svares stadig).
- **Klient:** `buildRaceStory` er ren og kan importeres direkte i frontend (som
  `raceParticipationHistory.ts` allerede gøres). Giv `results` og `startlist`
  med (`storyInputsFromResults(rows, stage)`), ellers er udbrydernes udfald
  uafgjort mod målresultatet.

```js
import { buildRaceStory, checkpointGapForRider, replayFrames, leaderTimeAt, storyInputsFromResults } from "backend/lib/raceStory.js";

const story = buildRaceStory({
  events,            // race_stage_timelines.events
  timelineVersion,   // race_stage_timelines.timeline_version
  ...storyInputsFromResults(raceResultRows, stage),
  // = results:   [{ rider_id, rank }] (etapens målresultat)
  //   startlist: rider_id-liste (bruges af udbruds-projektionen)
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
| `group_spans` | `[{group_id, from_km, to_km, source_group_id, into_group_id, rider_ids}]` | Gruppernes levetid på vejen: fra dannelse/split (`source_group_id` = gruppen den kom fra) til sammenlægning (`into_group_id`), på hændelsens sande km. `rider_ids` = gruppens eksplicitte medlemmer lige efter dannelsen (tom for resten). `to_km: null` = gruppen findes stadig ved mål; `to_km` er aldrig mindre end `from_km`. Tom for enkeltstart. |
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
  groups_from_km: number|null,// km for tilstanden grupperne er taget fra
  interpolated: boolean,      // true når passagens km ikke har en gap_update (hullerne er båret)
  out_rider_ids: string[],    // udgået til og med passagen
  pending_rider_ids: string[],// uheldsofre uden kendt solo-gruppe endnu
}
```

Grupperne er tilstanden **på passagen**: et snapshot på samme km, ellers
grupperne efter loggen til og med passagens km med de sidst meldte huller
(`gap_source: "carried"`). "Til og med" gælder hændelsens sande km
(`exact_km`): en strukturel hændelse stemplet ved segmentets slut, men med
`exact_km` før passagen, er sket på passagen. En gruppe dannet siden sidste
melding får sin egen måling (`exact_time` på `exact_km`) eller hullet fra
gruppen den kom fra (også `carried`). Et senere snapshot bruges aldrig
(fremtidige huller og splits hører ikke til passagen).

`checkpointGapForRider(checkpoint, riderId)` giver
`{ group_id, gap_s, time_s, in_front, via_rest } | null` (null: udgået, dvs.
i `out_rider_ids`; uheldsoffer i `pending_rider_ids`; eller gruppen er
ukendt). Hverken en udgået rytter eller et uheldsoffer uden kendt gruppe får
restgruppens tid.

### 3.4 `Snapshot` og replay

```ts
Snapshot = { km, leader_time_s, groups: GroupAt[], out_rider_ids: string[], pending_rider_ids: string[] }
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
på stedet. Frame-medlemskabet bygges fra tilstanden før frame'en og
`group_spans`, aldrig ved at projicere næste snapshot baglæns: en gruppe der
smelter sammen inde i et interval, er på vejen til sit merge-punkt og lukker
lineært ind på gruppen den smelter ind i; en gruppe der splitter sig ud inde i
et interval, er på vejen fra sit split-punkt og starter i gruppen den kom fra.
En gruppe der både opstår og forsvinder mellem to snapshots, er på vejen i hele
sin levetid (`group_spans` med `rider_ids`), og hver rytter tæller i præcis én
gruppe: en sammenlægning flytter rytterne ind i gruppen de smelter ind i.
En gruppe uden registreret split/merge vises kun hvor loggen kender den.

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
