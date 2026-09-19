// #2401/#2208: "bid_received" (sælgers besked pr. bud på egen rytter) er en
// hyppig kilde til støjende/dobbelte bekræftelses-beskeder — en travl auktion
// kan generere mange bid_received-rækker for samme related_id (auktions-id).
// Samme mønster som auction_outbid: aggregér dem under auktionen ER aktiv, og
// skjul dem HELT når auktionen er afgjort (auction_won/auction_lost findes for
// samme related_id) — så sælgeren kun ser ÉN klar besked pr. hændelse (den
// endelige "solgt for X CZ$"), ikke bud-støjen der førte dertil.
//
// #4981: PR #5363 tilføjede "auction_proxy_outbid" — beskeden man får når ens
// EGET autobud måtte hæve sig for at beholde føringen. Den deler related_id
// (auktions-id) med auction_outbid og opstår i samme budkrig, så en aktiv
// byder fik én indbakke-linje pr. udfordring. De to typer lægges derfor i
// SAMME bøtte ("auction_bidding"): én linje pr. auktion, ikke én pr. type.
// Bøtten findes netop fordi nøglen ikke må være selve typen — så ville et
// tabt/genvundet føringsskifte splitte auktionen i to linjer igen.
// #5384: et afviklet løb kunne give manageren TO indbakkelinjer for SAMME
// løb — "Race result is in" (race_result/#1952 · stage_result/#2523) OG
// "Career milestone" (career_milestone/#3398, Maiden Win Engine) når en af
// managerens ryttere samtidig fik sin første sejr/podie/trøje. Alle tre
// deler related_id = race.id allerede (se notificationService.js/
// careerFirsts.js), så samme bøtte-mønster som #4981 (auction_bidding)
// samler dem til ÉN linje pr. løb uden at røre backendens notify-trin.
const AGGREGATE_GROUPS = {
  auction_outbid: "auction_bidding",
  auction_proxy_outbid: "auction_bidding",
  bid_received: "bid_received",
  race_result: "race_completed",
  stage_result: "race_completed",
  career_milestone: "race_completed",
};

// Reviewer-fund (#5384-followup): notificationService.js sætter relatedId:
// race.id for HVER etape i emitStageResultNotifications, så et 21-etapers
// grand tour deler related_id på tværs af alle sine mellem-etaper OG den
// afsluttende race_result. Uden en dags-dimension i nøglen ville hele løbets
// levetid kollapse til ÉN "race_completed"-linje — kun seneste etapes tekst
// vises, resten gemmer sig bag et tæller-tal, og #2523's formål (én
// notifikation PR. ETAPE, netop for at undgå flerdages-stilhed i indbakken)
// er tabt. Dags-nøglen (UTC-dato af created_at) holder hver etapes dag som
// sin egen bøtte, mens race_result + career_milestone på SAMME dag (den
// faktiske afslutningsdag) stadig samles — det er selve #5384-scenariet.
// Kun "race_completed" får denne ekstra dimension: auction_bidding/
// bid_received skal fortsat aggregere på tværs af dage indtil terminator.
const DAY_SCOPED_GROUPS = new Set(["race_completed"]);

// #5384-followup (ejer 19/9, "ret titlen først"): en race_completed-bøtte må
// IKKE bruge den nyeste besked som ansigt. Gjorde den det, hed linjen "Maiden
// win (×2)" med teksten om ÉN rytters første sejr — læsbart som to første
// sejre, og løbet (det der faktisk skete) forsvandt helt. Ansigtet er derfor
// RESULTATET når bøtten har et; milepælene vises som ekstra linjer under.
const RESULT_TYPES = new Set(["race_result", "stage_result"]);

/**
 * Løbets navn som STRUKTURERET data, aldrig parset ud af fritekst.
 *
 * Alle tre typer skriver det samme sted: notificationService.js sætter
 * metadata.messageParams.race for race_result/stage_result, og careerFirsts.js
 * gør det samme for career_milestone (buildNotificationCopy). To kendte
 * undtagelser hvor feltet mangler helt og vi ærligt degraderer til resultat-
 * beskedens egen titel: #3399-narrativ-grenen (metadata = { raceId, narrative:
 * true }) og klub-milepælen (messageParams = { rider, count }).
 */
function structuredRaceName(notification) {
  const race = notification?.metadata?.messageParams?.race;
  return typeof race === "string" && race.trim() !== "" ? race.trim() : null;
}

function dayOf(createdAt) {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// #3549: sælgerens "afsluttet"-besked skiftede type fra "auction_won" til
// "auction_sold" (sælgeren er selv ikke KØBER, så "won" var forkert delt type
// med køberens besked — se auctionFinalization.js). bid_received er
// SÆLGERENS aggregerede bud-støj, så dens terminator skal matche sælgerens
// faktiske afsluttet-type, ellers "hænger" bud-aggregatet uendeligt hos
// sælgeren efter et salg.
const TERMINATING_TYPES = {
  auction_bidding: new Set(["auction_won", "auction_lost"]),
  bid_received: new Set(["auction_won", "auction_lost", "auction_sold"]),
};

export function aggregateKey(type, relatedId, day) {
  return day != null ? `${type}|${relatedId}|${day}` : `${type}|${relatedId}`;
}

// Bøtten en type aggregeres under, eller null hvis typen aldrig aggregeres.
// Eksporteret så kalderen kan gruppere/teste uden at kende bøtte-tabellen.
export function aggregateGroup(type) {
  return AGGREGATE_GROUPS[type] ?? null;
}

export function groupNotifications(notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) return [];

  const terminated = new Map();
  for (const n of notifications) {
    if (!n.related_id) continue;
    for (const [group, terminators] of Object.entries(TERMINATING_TYPES)) {
      if (terminators.has(n.type)) {
        if (!terminated.has(group)) terminated.set(group, new Set());
        terminated.get(group).add(n.related_id);
      }
    }
  }

  const aggregates = new Map();
  const singles = [];

  for (const n of notifications) {
    const group = aggregateGroup(n.type);
    if (group && n.related_id) {
      if (terminated.get(group)?.has(n.related_id)) continue;
      const day = DAY_SCOPED_GROUPS.has(group) ? dayOf(n.created_at) : null;
      const key = aggregateKey(group, n.related_id, day);
      if (!aggregates.has(key)) {
        // `day` gemmes så resultatets `key`-felt (linje ~127) matcher PRÆCIS
        // den nøgle der faktisk bruges til bucketing — ellers ville to
        // forskellige dage af samme løb dele samme udadvendte `key` og give
        // React et duplikeret listenøgle.
        aggregates.set(key, { group, related_id: n.related_id, day, items: [] });
      }
      aggregates.get(key).items.push(n);
    } else {
      singles.push({ kind: "single", notification: n });
    }
  }

  const result = [...singles];
  for (const agg of aggregates.values()) {
    if (agg.items.length === 1) {
      result.push({ kind: "single", notification: agg.items[0] });
    } else {
      const sorted = [...agg.items].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      );
      const latest = sorted[0];
      const earliest = sorted[sorted.length - 1];
      // #4981: bøtten kan rumme flere typer (auction_outbid +
      // auction_proxy_outbid). `type` er DEN NYESTE beskeds type, så ikon,
      // farve, titel og tekst altid beskriver den aktuelle tilstand — et reelt
      // tab af føringen må aldrig gemme sig bag en "du fører stadig"-tekst.
      // `type_counts` lader kalderen sige sandheden om resten af bøtten.
      //
      // #5384-followup: race_completed er undtagelsen. Dér er rækkefølgen i
      // tid ligegyldig for hvad linjen HANDLER om — løbet er hændelsen, og
      // milepælen er en konsekvens af det. Ansigtet er derfor det nyeste
      // RESULTAT (race_result/stage_result) hvis bøtten har et; ellers (kun
      // milepæle, fx en gen-finalisering hvor resultatbeskeden er slettet)
      // falder vi tilbage til den nyeste milepæl, så linjen aldrig bliver tom.
      const resultItem = agg.group === "race_completed"
        ? sorted.find((i) => RESULT_TYPES.has(i.type))
        : null;
      const face = resultItem ?? latest;
      // Milepælene ud over ansigtet — kalderen viser dem som dæmpede linjer
      // UDEN at man skal folde ud, så "hvem gjorde hvad" ikke gemmer sig bag
      // en pil. Identitets-sammenligning (ikke id), så helpers i test ikke
      // behøver unikke id'er for at opføre sig som produktionsrækker.
      const extraItems = agg.group === "race_completed"
        ? sorted.filter((i) => i.type === "career_milestone" && i !== face)
        : [];
      // Sat KUN når bøtten har et resultat: "<løb>: resultatet er klar" må
      // ikke stå over en linje hvor intet resultat er kommet ind endnu.
      // Navnet tages fra resultatet selv, ellers fra en vilkårlig anden
      // besked i bøtten (milepælen bærer samme race-param).
      const raceName = resultItem
        ? (structuredRaceName(resultItem) ?? sorted.map(structuredRaceName).find(Boolean) ?? null)
        : null;
      const typeCounts = {};
      for (const item of sorted) {
        typeCounts[item.type] = (typeCounts[item.type] ?? 0) + 1;
      }
      result.push({
        kind: "aggregate",
        key: aggregateKey(agg.group, agg.related_id, agg.day),
        group: agg.group,
        type: face.type,
        type_counts: typeCounts,
        related_id: agg.related_id,
        items: sorted,
        count: sorted.length,
        latest_at: latest.created_at,
        earliest_at: earliest.created_at,
        any_unread: sorted.some((i) => !i.is_read),
        sample_title: face.title,
        sample_message: face.message,
        // #666: carry metadata so aggregate-rendering can use i18n via
        // renderBackendMessage. Falls back to title/message if absent.
        sample_metadata: face.metadata ?? null,
        // #5384-followup: løbsnavnet (struktureret) når linjens overskrift skal
        // være LØBET, og de milepæls-beskeder der vises som ekstra linjer.
        // Begge er tomme/null for alle andre bøtter, så kalderen kan rendere
        // ensartet uden at kende bøtte-tabellen.
        race_name: raceName,
        extra_items: extraItems,
      });
    }
  }

  result.sort((a, b) => {
    const aTs = a.kind === "single" ? a.notification.created_at : a.latest_at;
    const bTs = b.kind === "single" ? b.notification.created_at : b.latest_at;
    return new Date(bTs) - new Date(aTs);
  });

  return result;
}
