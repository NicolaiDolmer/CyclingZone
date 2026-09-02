/**
 * #3514 S-M2a · "Personer med stemme" — det ENE beat-modul.
 * =========================================================================
 * Spec (ejer-godkendt 1/9-2026, grill-session):
 *   docs/superpowers/specs/2026-09-01-board-mandate-addendum-personer-med-stemme.md
 *   §"Stemme-kontrakten", punkt 3: "Ét beat-modul (faldgrube 3): nyt
 *   backend/lib/boardVoice.js = eneste sted en bestyrelses-hændelse bliver
 *   til (medlem, tone, citat-nøgle). De fire beat-stier (boardMidSeason,
 *   boardConsequences lag 3+, boardMandateEngine's chairman_beat_key-stub,
 *   boardMandate's modtilbud) kalder ind, ingen egen tekst-logik."
 *
 * KONTRAKT
 * --------
 * sampleVoiceLine({ beat, archetypeKey, seed, context }) →
 *   {
 *     member: { navn, initialer, archetype_key, label_key },
 *     quote_key,          // i18n-nøgle, board-namespace: "archetypes.<key>.reactions.<beat>.<idx>"
 *     quote_fallback_da,  // rå dansk tekst, samme fallback-mønster som resten af board.json-stien
 *   }
 *
 *   - `beat` er navnet på en reaktions-bucket i boardArchetypes.js (en af
 *     REACTION_BUCKETS eller MANDATE_VOICE_BUCKETS). Ukendt beat kaster.
 *   - `archetypeKey` er en BOARD_ARCHETYPE_KEYS-nøgle. Ukendt arketype kaster.
 *   - `seed` bruges til den deterministiske variant-udvælgelse (samme
 *     hash-mod-length-mønster som sampleReactionForFeedback/-Goal i
 *     boardMembers.js og momenterne i #2484/narrativ-spec'en). SAMME seed
 *     giver ALTID samme linje, uanset hvor mange gange den læses. Kaldere
 *     der viser en kvittering for en konkret hændelse (feed-række, milepæl,
 *     møde) SKAL seede pr. event-id, ikke pr. visning, så rækken har en
 *     stabil linje over tid (addendum punkt 3: "kvitterings-feedet seedes
 *     pr. event-id"). Udelades seed, falder funktionen tilbage til
 *     `archetypeKey:beat`, hvilket er deterministisk men IKKE varieret på
 *     tværs af flere hændelser af samme (arketype, beat) for samme team,
 *     så det er kun egnet til engangs-beats (fx formandsskifte).
 *   - `context` er fritstående data beat-kaldere sender med. Foruden
 *     `context.teamId` og `context.dnaKey` (navne-afledning via
 *     generateBoardMemberNames, S-M2a's "navne wires atomisk"-kontrakt)
 *     bruges `context.members` (#4586, faldgrube 2 i addendummet: "aldrig
 *     navn ét sted og andet et andet sted"): den FULDE, ordnede liste af
 *     bestyrelses-medlemmer for holdet (arketype-nøgle-strenge, eller
 *     objekter med `archetype_key`, samme form som `team_board_members`-
 *     rækker) — samme liste den kaldende side selv bruger til
 *     `generateBoardMemberNames`. `generateBoardMemberNames` afleder navne
 *     for HELE listen på én gang og lægger salt på ved kollision inden for
 *     holdet (`boardMandateNames.js`), så salten afhænger af de FOREGÅENDE
 *     medlemmer i listen. Kaldes funktionen for kun ÉT medlem ad gangen
 *     (uden `context.members`), er salten altid 0, hvilket kan give et
 *     ANDET navn end det samme medlem har i en samlet navngivning et andet
 *     sted på siden (fx Boardroom-sidens medlemskort) — se bug #4586.
 *     Sendes `context.members` med, OG den indeholder `archetypeKey`, slår
 *     funktionen navnet op i `generateBoardMemberNames`-resultatet for HELE
 *     listen i stedet, så salten matcher. Mangler/er tom listen, eller
 *     indeholder den ikke `archetypeKey`, falder funktionen tilbage til det
 *     gamle enkelt-medlems-kald (samme adfærd som før #4586, salt altid 0).
 *     Feltet er i øvrigt bevidst åbent, så fremtidige beats kan sende mere
 *     uden at ændre funktions-signaturen.
 *
 * TOM BUCKET = KAST, ALDRIG STILLE FALDBACK
 * ------------------------------------------
 * Alle 9 arketyper har i dag min. 4 varianter for hver af de 11 nye
 * Mandat-buckets (sponsoraten + ungdomsidealisten var de ejer-godkendte
 * referenceprøver 1/9, de øvrige 7 blev skrevet i samme kvalitet 1/9 efter
 * godkendelsen). Mekanismen i dette afsnit er alligevel PERMANENT, ikke en
 * overgangsforanstaltning: den næste gang en ny bucket tilføjes (endnu en
 * beat-type), vil den nødvendigvis starte tom for nogle eller alle
 * arketyper igen. At falde stille tilbage til fx chairman's egen bucket
 * eller en anden arketypes tekst ville betyde at spilleren læser den
 * FORKERTE person tale, hvilket er præcis den fejlklasse Mandatet skal
 * fjerne (#3514: "aldrig 'Bestyrelsen er utilfreds: -3'"). Derfor kaster
 * `sampleVoiceLine` en `BoardVoiceEmptyBucketError` når bucket'en for den
 * valgte (archetypeKey, beat)-kombination er tom, i stedet for at vælge et
 * andet medlem eller en anden bucket. Kaldere skal enten undgå at route til
 * arketyper uden indhold endnu (fx altid vise beats via formanden, indtil
 * dennes arketype har en tone-prøve), eller lade fejlen boble op så manglen
 * er synlig i test/Sentry i stedet for at blive maskeret som en tilfældig
 * anden stemme.
 *
 * GENERISK PERSON-STEMME-KONTRAKT (fremtidssikring, ingen implementering nu)
 * ----------------------------------------------------------------------
 * `archetypeKey` er i dag altid en bestyrelses-arketype, men parameteren er
 * konceptuelt en "speakerKey": en nøgle ind i ET ELLER ANDET register af
 * personer med en `reactions: { <bucket>: string[] }`-formet stemme-bank
 * (samme form som BOARD_ARCHETYPES). Spillet skal have ÉT person-stemme-
 * system, ikke ét pr. persongruppe. Når personale (trænere/scouts, findes
 * ikke endnu) får deres egen stemme, er den forventede udvidelse at
 * `sampleVoiceLine` (eller en tynd variant af den) slår `speakerKey` op i
 * det relevante register frem for at hardkode `getArchetypeByKey`, ikke at
 * der bygges et helt nyt parallelt boardVoice-for-staff-modul. Denne kommentar
 * er selve kontrakt-noten (ejer-krav 1/9); der er bevidst INGEN staff-kode
 * eller -registry i denne slice.
 *
 * DETERMINISME + MOMENT-VOKABULAR-PRINCIPPET
 * -------------------------------------------
 * Følger samme grundprincipper som narrativ-spec'en
 * (docs/superpowers/specs/2026-07-11-narrative-systems-design.md
 * §"Grundprincipper"): strukturerede momenter frem for frie strenge, al
 * variation seedet og deterministisk (ingen runtime-LLM-tekst), og ærlig
 * degradering frem for opdigtet indhold, en tom bucket viser INTET (kaster,
 * fanges af kalderen) frem for en gættet linje.
 */

import { getArchetypeByKey, REACTION_BUCKETS, MANDATE_VOICE_BUCKETS } from "./boardArchetypes.js";
import { generateBoardMemberNames } from "./boardMandateNames.js";

// Alle kendte beat-navne (buckets) en kalder må bede om. Fladet ud til ét
// sæt så sampleVoiceLine kan validere "ukendt beat" uafhængigt af hvilken
// af de to lister (gamle 6 vs. nye 11 Mandat-buckets) beatet hører til.
const ALL_VOICE_BEATS = new Set([...REACTION_BUCKETS, ...MANDATE_VOICE_BUCKETS]);

export class BoardVoiceEmptyBucketError extends Error {
  constructor(archetypeKey, beat) {
    super(
      `boardVoice.sampleVoiceLine: arketypen "${archetypeKey}" har ingen tone-prøve for beat ` +
      `"${beat}" endnu (tom bucket, se TODO i boardArchetypes.js). Kaster bevidst i stedet for ` +
      `at falde stille tilbage til en anden persons stemme.`
    );
    this.name = "BoardVoiceEmptyBucketError";
    this.archetypeKey = archetypeKey;
    this.beat = beat;
  }
}

// Stabil 32-bit hash (FNV-1a). Samme algoritme som boardMandateNames.js'
// hashSeed (dupliceret bevidst, ikke exporteret der) — tegn-sum kolliderer
// for meget på strenge der kun adskiller sig i rækkefølge, og seed-strenge
// her er ofte "<eventId>:<archetypeKey>:<beat>", som ligner hinanden på
// tværs af beats for samme event.
function hashSeed(input) {
  let hash = 0x811c9dc5;
  const text = String(input ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Det ENE sted en bestyrelses-hændelse bliver til (medlem, tone, citat).
 *
 * @param {object} args
 * @param {string} args.beat - reaktions-bucket-navn, se REACTION_BUCKETS/MANDATE_VOICE_BUCKETS.
 * @param {string} args.archetypeKey - BOARD_ARCHETYPE_KEYS-nøgle ("speakerKey", se modul-header).
 * @param {string} [args.seed] - determinisme-seed. Seed PR. EVENT-ID for kvitteringer (stabil linje pr. række).
 * @param {{ teamId?: string, dnaKey?: string|null, members?: Array<string|{archetype_key: string}> }} [args.context] -
 *   navne-afledning. `members` (#4586) skal være den FULDE bestyrelses-liste
 *   (samme rækkefølge/form som kalderens `generateBoardMemberNames`-kald), så
 *   kollisions-salten matcher en samlet navngivning et andet sted. Mangler
 *   `members`, eller indeholder listen ikke `archetypeKey`, navngives kun
 *   det ene medlem (salt altid 0, se modul-header).
 * @returns {{ member: { navn: string, initialer: string, archetype_key: string, label_key: string }, quote_key: string, quote_fallback_da: string }}
 */
export function sampleVoiceLine({ beat, archetypeKey, seed = "", context = {} } = {}) {
  if (!beat || !ALL_VOICE_BEATS.has(beat)) {
    throw new Error(
      `boardVoice.sampleVoiceLine: ukendt beat "${beat}". Gyldige beats: ${[...ALL_VOICE_BEATS].join(", ")}`
    );
  }

  const archetype = getArchetypeByKey(archetypeKey);
  if (!archetype) {
    throw new Error(`boardVoice.sampleVoiceLine: ukendt archetypeKey "${archetypeKey}"`);
  }

  const templates = archetype.reactions?.[beat] || [];
  if (!templates.length) {
    throw new BoardVoiceEmptyBucketError(archetypeKey, beat);
  }

  const seedString = String(seed || `${archetypeKey}:${beat}`);
  const idx = hashSeed(seedString) % templates.length;

  // #4586 · navngiv via HELE bestyrelses-listen når kalderen sender den, så
  // kollisions-salten (boardMandateNames.js) matcher en samlet navngivning
  // et andet sted på siden (fx Boardroom-sidens medlemskort). Uden en liste
  // der rent faktisk indeholder denne arketype, falder vi tilbage til det
  // gamle enkelt-medlems-kald (salt altid 0, se modul-header og #4586).
  const membersList = Array.isArray(context?.members) ? context.members : [];
  const listHasArchetype = membersList.some(
    (m) => (typeof m === "string" ? m : m?.archetype_key) === archetypeKey
  );

  let namedMember;
  if (listHasArchetype) {
    const named = generateBoardMemberNames({
      teamId: context?.teamId ?? "",
      members: membersList,
      dnaKey: context?.dnaKey ?? null,
    });
    namedMember = named.find((m) => m.archetype_key === archetypeKey);
  } else {
    [namedMember] = generateBoardMemberNames({
      teamId: context?.teamId ?? "",
      members: [archetypeKey],
      dnaKey: context?.dnaKey ?? null,
    });
  }

  return {
    member: {
      navn: namedMember.full_name,
      initialer: namedMember.initials,
      archetype_key: archetypeKey,
      label_key: `archetypes.${archetypeKey}.label`,
    },
    quote_key: `archetypes.${archetypeKey}.reactions.${beat}.${idx}`,
    quote_fallback_da: templates[idx],
  };
}
